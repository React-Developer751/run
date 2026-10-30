import http from 'node:http';
import net from 'node:net';
import fs from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import { clientIp } from '../utils/http.js';
import { logger } from '../utils/logger.js';
import { InactivityService } from './inactivity.service.js';
import { Store, siteName, type Project } from './store.service.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.map': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.avif': 'image/avif',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain; charset=utf-8',
  '.xml': 'application/xml',
  '.woff': 'font/woff',
  '.woff2': 'font/woff2',
  '.ttf': 'font/ttf',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.pdf': 'application/pdf',
  '.wasm': 'application/wasm',
};

const escapeHtml = (s: string) => s.replace(/[&<>"']/g, (c) => `&#${c.charCodeAt(0)};`);

function statusPage(res: http.ServerResponse, status: number, title: string, message: string): void {
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${escapeHtml(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:radial-gradient(900px 500px at 50% -120px,rgba(124,92,255,.22),transparent 70%),radial-gradient(700px 460px at 100% 10%,rgba(236,72,153,.14),transparent 70%),#f4f2ff;color:#1b1646;font-family:ui-sans-serif,system-ui,sans-serif}
main{text-align:center;padding:24px}h1{font-size:72px;margin:0;background:linear-gradient(135deg,#5b4bf0,#8b5cf6 48%,#ec4899);-webkit-background-clip:text;background-clip:text;color:transparent}
h2{margin:6px 0 10px}p{color:#58547f;max-width:420px;line-height:1.6;margin:0 auto 22px}small{color:#8681ad;letter-spacing:.2em;text-transform:uppercase;font-size:11px}</style></head>
<body><main><h1>${status}</h1><h2>${escapeHtml(title)}</h2><p>${escapeHtml(message)}</p><small>Hosted on ${escapeHtml(siteName())}</small></main></body></html>`;
  res.writeHead(status, { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
  res.end(html);
}

// RFC 7230 hop-by-hop headers belong to one connection and must not be forwarded.
const HOP_BY_HOP = ['connection', 'keep-alive', 'proxy-connection', 'te', 'trailer', 'transfer-encoding', 'upgrade', 'proxy-authorization', 'proxy-authenticate'];

function withoutHopByHop(headers: http.IncomingHttpHeaders): http.IncomingHttpHeaders {
  const out = { ...headers };
  // Headers named in Connection: are hop-by-hop too.
  for (const name of String(headers.connection ?? '').split(',')) delete out[name.trim().toLowerCase()];
  for (const name of HOP_BY_HOP) delete out[name];
  return out;
}

/** A redeploy keeps the previous version running (blue-green), so it keeps serving until the switch. */
const isServing = (p: Project) => p.status === 'live' || (p.status === 'deploying' && p.runtime !== null);

function resolveProject(hostHeader: string | undefined): Project | null {
  if (!hostHeader) return null;
  const hostname = (hostHeader.split(':')[0] ?? '').toLowerCase().replace(/\.$/, '');
  const suffix = `.${config.baseDomain}`;
  // Anything outside the apps domain can only be a verified custom domain.
  if (!hostname.endsWith(suffix)) return Store.getProjectByDomain(hostname) ?? null;
  const slug = hostname.slice(0, -suffix.length);
  if (!slug || slug.includes('.')) return null;
  return Store.getProjectBySlug(slug) ?? null;
}

function serveStatic(project: Project, req: http.IncomingMessage, res: http.ServerResponse): void {
  const root = path.join(config.staticDir, project.id);
  let pathname: string;
  try {
    pathname = decodeURIComponent((req.url ?? '/').split('?')[0] ?? '/');
  } catch {
    return statusPage(res, 400, 'Bad request', 'The URL is malformed.');
  }
  if (pathname.includes('\0')) return statusPage(res, 400, 'Bad request', 'The URL is malformed.');
  const file = path.join(root, pathname);

  if (file !== root && !file.startsWith(root + path.sep)) {
    return statusPage(res, 403, 'Forbidden', 'That path is not allowed.');
  }

  const send = (target: string, isFallback: boolean) => {
    fs.stat(target, (err, stat) => {
      if (!err && stat.isDirectory()) return send(path.join(target, 'index.html'), isFallback);
      if (err || !stat.isFile()) {
        const looksLikeAsset = path.extname(pathname) !== '';
        if (!isFallback && !looksLikeAsset) return send(path.join(root, 'index.html'), true); // SPA fallback
        return statusPage(res, 404, 'Page not found', 'This file does not exist on the site.');
      }
      const ext = path.extname(target).toLowerCase();
      res.writeHead(200, {
        'Content-Type': MIME[ext] ?? 'application/octet-stream',
        'Content-Length': stat.size,
        'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
        'X-Content-Type-Options': 'nosniff',
      });
      if (req.method === 'HEAD') return res.end();
      fs.createReadStream(target).pipe(res);
    });
  };
  send(file, false);
}

export class ProxyService {
  /** Host-header based reverse proxy built on node:http only. Handles HTTP, streaming and WebSocket upgrades. */
  public static createProxyServer(): http.Server {
    const server = http.createServer((req, res) => {
      // yourapps.app and www.yourapps.app have no app of their own: send visitors to the dashboard.
      const hostname = (req.headers.host ?? '').split(':')[0]?.toLowerCase();
      if (config.webOrigins[0] && (hostname === config.baseDomain || hostname === `www.${config.baseDomain}`)) {
        res.writeHead(302, { Location: config.webOrigins[0], 'Cache-Control': 'no-store' });
        return res.end();
      }
      const project = resolveProject(req.headers.host);
      if (!project) return statusPage(res, 404, 'App not found', 'No deployment exists at this address.');
      // Paused apps are not woken up by visits (the owner resumes them), so only serving apps count as visited.
      if (isServing(project)) InactivityService.touch(project.id);
      if (!isServing(project)) {
        const msg =
          project.status === 'deploying'
            ? 'This app is being deployed right now. Refresh in a moment.'
            : project.status === 'stopped'
              ? 'This app has been stopped by its owner.'
              : project.status === 'crashed'
                ? 'This app crashed. Its owner has been notified.'
                : project.status === 'paused'
                  ? `This app is paused because it had no visitors for a while. Its owner can resume it from the ${siteName()} dashboard in one click.`
                  : project.status === 'archived'
                    ? `This app was archived after a long time without visitors. Its owner can redeploy it from the ${siteName()} dashboard.`
                    : 'The last deployment of this app failed.';
        return statusPage(res, 503, 'App unavailable', msg);
      }
      if (project.runtime === 'static') return serveStatic(project, req, res);

      const proxyReq = http.request(
        {
          host: '127.0.0.1',
          port: project.port,
          path: req.url,
          method: req.method,
          timeout: 120_000,
          headers: {
            ...withoutHopByHop(req.headers),
            'x-forwarded-for': clientIp(req),
            'x-forwarded-host': req.headers.host ?? '',
            'x-forwarded-proto': config.publicScheme,
          },
        },
        (proxyRes) => {
          // Server-sent events and long polls are quiet on purpose: no idle timeout once such a response started.
          if (String(proxyRes.headers['content-type'] ?? '').startsWith('text/event-stream')) proxyReq.setTimeout(0);
          // If the app dies mid-response (e.g. its old version is retired), end the client's request instead of hanging.
          proxyRes.on('aborted', () => res.destroy());
          proxyRes.on('error', () => res.destroy());
          res.writeHead(proxyRes.statusCode ?? 502, withoutHopByHop(proxyRes.headers));
          proxyRes.pipe(res);
        },
      );

      proxyReq.on('timeout', () => proxyReq.destroy(new Error('upstream timeout')));
      proxyReq.on('error', (err) => {
        logger.warn(`Proxy error for ${project.slug}: ${err.message}`);
        if (!res.headersSent) statusPage(res, 502, 'Bad gateway', 'The app is registered but is not responding.');
        else res.destroy();
      });
      res.on('close', () => proxyReq.destroy());
      req.pipe(proxyReq);
    });

    // WebSocket / HMR: replay the upgrade request to the app and pipe the raw sockets together.
    server.on('upgrade', (req, socket, head) => {
      const project = resolveProject(req.headers.host);
      if (!project || !isServing(project) || project.runtime === 'static') return socket.destroy();

      const upstream = net.connect(project.port, '127.0.0.1', () => {
        // Client-supplied X-Forwarded-* are replaced by ours, as for normal requests (socket.io reads them).
        const kept = req.rawHeaders.reduce((acc, cur, i, all) => {
          if (i % 2 === 1) return acc;
          return /^x-forwarded-(for|host|proto)$/i.test(cur) ? acc : `${acc}${cur}: ${all[i + 1]}\r\n`;
        }, '');
        const headers = `${kept}X-Forwarded-For: ${clientIp(req)}\r\nX-Forwarded-Host: ${req.headers.host ?? ''}\r\nX-Forwarded-Proto: ${config.publicScheme}\r\n`;
        upstream.write(`${req.method} ${req.url} HTTP/1.1\r\n${headers}\r\n`);
        if (head.length > 0) upstream.write(head);
        socket.pipe(upstream).pipe(socket);
      });
      upstream.on('error', () => socket.destroy());
      socket.on('error', () => upstream.destroy());
    });

    return server;
  }
}
