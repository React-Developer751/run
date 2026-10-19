import http from 'node:http';
import { config } from '../config/index.js';
import { logger } from './logger.js';
import { RateLimiter } from './rateLimit.js';
import type { User } from '../services/store.service.js';

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? '').split(';')) {
    const i = part.indexOf('=');
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

export class HttpError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export interface Ctx {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  params: Record<string, string>;
  query: URLSearchParams;
  /** Status code used for a successful reply. Handlers may change it (e.g. 201). */
  status: number;
  user: User | null;
  ip: string;
  json: () => Promise<Record<string, unknown>>;
  /** Unparsed request body (needed to verify webhook signatures). */
  raw: () => Promise<Buffer>;
  headers: http.IncomingHttpHeaders;
}

export type Handler = (ctx: Ctx) => Promise<unknown> | unknown;

interface Route {
  method: string;
  segments: string[];
  handler: Handler;
}

export class Router {
  private routes: Route[] = [];

  add(method: string, pattern: string, handler: Handler): void {
    this.routes.push({ method, segments: pattern.split('/').filter(Boolean), handler });
  }
  get = (p: string, h: Handler) => this.add('GET', p, h);
  post = (p: string, h: Handler) => this.add('POST', p, h);
  patch = (p: string, h: Handler) => this.add('PATCH', p, h);
  delete = (p: string, h: Handler) => this.add('DELETE', p, h);

  match(method: string, pathname: string): { handler: Handler; params: Record<string, string> } | 'method' | null {
    const parts = pathname.split('/').filter(Boolean);
    let pathMatched = false;
    for (const route of this.routes) {
      if (route.segments.length !== parts.length) continue;
      const params: Record<string, string> = {};
      let ok = true;
      route.segments.forEach((seg, i) => {
        const part = parts[i] as string;
        if (seg.startsWith(':')) params[seg.slice(1)] = decodeURIComponent(part);
        else if (seg !== part) ok = false;
      });
      if (!ok) continue;
      pathMatched = true;
      if (route.method === method) return { handler: route.handler, params };
    }
    return pathMatched ? 'method' : null;
  }
}

const MAX_BODY = 1024 * 1024;
const apiLimiter = new RateLimiter(600, 60 * 1000, 'Too many requests. Slow down and try again shortly.');

/**
 * Behind a trusted reverse proxy the socket address is the proxy itself, which would make every user share one
 * rate-limit bucket. The proxy appends the real client as the LAST X-Forwarded-For entry; earlier entries are client-controlled.
 */
export function clientIp(req: http.IncomingMessage): string {
  if (config.trustProxy) {
    const forwarded = req.headers['x-forwarded-for'];
    const last = (Array.isArray(forwarded) ? forwarded.join(',') : forwarded ?? '').split(',').pop()?.trim();
    if (last) return last;
  }
  return req.socket.remoteAddress ?? 'unknown';
}

function readRaw(req: http.IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, 'Request body too large'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function parseJsonObject(buffer: Buffer): Record<string, unknown> {
  if (buffer.length === 0) return {};
  try {
    const parsed: unknown = JSON.parse(buffer.toString('utf8'));
    if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) throw new HttpError(400, 'JSON body must be an object');
    return parsed as Record<string, unknown>;
  } catch (err) {
    if (err instanceof HttpError) throw err;
    throw new HttpError(400, 'Invalid JSON body');
  }
}

function applyCors(req: http.IncomingMessage, res: http.ServerResponse): void {
  const origin = req.headers.origin;
  if (origin && config.webOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
    res.setHeader('Access-Control-Max-Age', '600');
  }
}

/**
 * CSRF defence for cookie auth. SameSite=Lax already blocks cross-site requests, but sibling subdomains
 * (users' apps live on *.yourdomain) are same-site, so state-changing requests must also come from our dashboard origin.
 */
function enforceOrigin(req: http.IncomingMessage): void {
  const method = req.method ?? 'GET';
  if (method === 'GET' || method === 'HEAD' || method === 'OPTIONS') return;
  const cookies = parseCookies(req.headers.cookie);
  if (!cookies[config.accessCookie] && !cookies[config.refreshCookie]) return; // no ambient credentials to abuse
  let origin = req.headers.origin;
  if (!origin && req.headers.referer) {
    try {
      origin = new URL(req.headers.referer).origin;
    } catch {
      /* ignore */
    }
  }
  if (!origin || !config.webOrigins.includes(origin)) throw new HttpError(403, 'Cross-site request blocked');
}

function send(res: http.ServerResponse, status: number, body: unknown): void {
  if (res.headersSent) return;
  const payload = JSON.stringify(body);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(payload),
    'Cache-Control': 'no-store',
  });
  res.end(payload);
}

export function createApiServer(router: Router, authenticate: (req: http.IncomingMessage) => Promise<User | null>) {
  return http.createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    applyCors(req, res);

    if (req.method === 'OPTIONS') {
      res.writeHead(204);
      return res.end();
    }

    const url = new URL(req.url ?? '/', 'http://hostx.internal');
    const matched = router.match(req.method ?? 'GET', url.pathname);
    if (matched === null) return send(res, 404, { error: 'Not found' });
    if (matched === 'method') return send(res, 405, { error: 'Method not allowed' });

    let rawPromise: Promise<Buffer> | undefined;
    try {
      apiLimiter.hit(`api:${clientIp(req)}`);
      enforceOrigin(req);
      const ctx: Ctx = {
        req,
        res,
        params: matched.params,
        query: url.searchParams,
        status: 200,
        user: await authenticate(req),
        ip: clientIp(req),
        headers: req.headers,
        raw: () => (rawPromise ??= readRaw(req)),
        json: async () => parseJsonObject(await (rawPromise ??= readRaw(req))),
      };
      const result = await matched.handler(ctx);
      send(res, ctx.status, result ?? { ok: true });
    } catch (err) {
      if (err instanceof HttpError) return send(res, err.status, { error: err.message });
      logger.error(`Unhandled error on ${req.method} ${url.pathname}`, err);
      send(res, 500, { error: 'Internal server error' });
    }
  });
}
