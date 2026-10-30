import './env.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';

const root = process.cwd();
const env = process.env;

const num = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) ? n : fallback;
};

const proxyPort = num(env.HOSTX_PROXY_PORT, 8080);
const webOrigins = (env.HOSTX_WEB_ORIGIN ?? 'http://localhost:3000').split(',').map((s) => s.trim());
const smtpUrl = env.HOSTX_SMTP_URL || null;

/** PEM from HOSTX_GITHUB_PRIVATE_KEY (literal "\n" allowed, for one-line .env files) or HOSTX_GITHUB_PRIVATE_KEY_FILE. */
function githubPrivateKey(): string | null {
  if (env.HOSTX_GITHUB_PRIVATE_KEY) return env.HOSTX_GITHUB_PRIVATE_KEY.replace(/\\n/g, '\n');
  if (env.HOSTX_GITHUB_PRIVATE_KEY_FILE) {
    try {
      return readFileSync(env.HOSTX_GITHUB_PRIVATE_KEY_FILE, 'utf8');
    } catch {
      return null;
    }
  }
  return null;
}
const publicScheme: 'http' | 'https' = env.HOSTX_PUBLIC_SCHEME === 'https' ? 'https' : 'http';
const publicPort = num(env.HOSTX_PUBLIC_PORT, proxyPort);

export const config = {
  rootDir: root,
  appsDir: path.join(root, 'apps'),
  dataDir: path.join(root, 'data'),
  dbFile: path.join(root, 'data', 'db.json'),
  secretFile: path.join(root, 'data', 'secret.key'),
  logsDir: path.join(root, 'data', 'logs'),
  staticDir: path.join(root, 'data', 'static'),
  tmpDir: path.join(root, 'data', 'tmp'),
  envDir: path.join(root, 'data', 'env'),

  // API listens on loopback by default so containers (via the docker bridge) cannot reach it.
  apiHost: env.HOSTX_API_HOST ?? '127.0.0.1',
  apiPort: num(env.HOSTX_API_PORT, 4000),
  proxyPort,
  // Behind Caddy/nginx bind the app proxy to 127.0.0.1 too, so nobody can skip TLS by hitting :8080 directly.
  proxyHost: env.HOSTX_PROXY_HOST || undefined,

  // Apps are served on <slug>.<baseDomain>. "localhost" works out of the box in modern browsers.
  baseDomain: (env.HOSTX_BASE_DOMAIN ?? 'localhost').toLowerCase(),
  publicScheme,
  publicPort,

  // Comma separated list of dashboard origins allowed to call the API.
  webOrigins,
  // Links in emails and redirects after the GitHub connect flow point here.
  dashboardUrl: (env.HOSTX_DASHBOARD_URL ?? webOrigins[0] ?? 'http://localhost:3000').replace(/\/+$/, ''),

  // Outgoing email: smtps://user:pass@smtp.example.com:465 or smtp://user:pass@smtp.example.com:587 (STARTTLS).
  // Without it, emails are printed to the engine log in development and skipped in production.
  mail: {
    smtpUrl,
    from: env.HOSTX_MAIL_FROM ?? 'HostX <no-reply@localhost>',
  },
  // Unverified accounts may sign in but not deploy. Default: on whenever email can actually be sent.
  requireVerifiedEmail: env.HOSTX_REQUIRE_VERIFIED_EMAIL ? env.HOSTX_REQUIRE_VERIFIED_EMAIL === 'true' : Boolean(smtpUrl),
  // Cloudflare Turnstile secret: when set, sign-up and "forgot password" require a CAPTCHA.
  turnstileSecret: env.HOSTX_TURNSTILE_SECRET || null,

  // GitHub App (private repositories + one webhook for every repo). All fields are needed to turn it on.
  github: {
    appId: env.HOSTX_GITHUB_APP_ID ?? '',
    appSlug: env.HOSTX_GITHUB_APP_SLUG ?? '',
    clientId: env.HOSTX_GITHUB_CLIENT_ID ?? '',
    clientSecret: env.HOSTX_GITHUB_CLIENT_SECRET ?? '',
    webhookSecret: env.HOSTX_GITHUB_WEBHOOK_SECRET ?? '',
    privateKey: githubPrivateKey(),
  },

  // auto | docker | process
  runner: (env.HOSTX_RUNNER ?? 'auto').toLowerCase(),

  isProduction: env.NODE_ENV === 'production',
  allowUnsafeProcess: env.HOSTX_ALLOW_UNSAFE_PROCESS === '1',
  // Set true ONLY behind your own reverse proxy (Caddy/nginx): then the client IP is read from X-Forwarded-For.
  trustProxy: env.HOSTX_TRUST_PROXY === 'true',
  allowSignup: env.HOSTX_ALLOW_SIGNUP !== 'false',
  // This email always gets the admin role when it registers. The very first account is admin too.
  adminEmail: (env.HOSTX_ADMIN_EMAIL ?? '').trim().toLowerCase(),

  secretFromEnv: env.HOSTX_SECRET,
  // Short-lived access token + rotating refresh token, both in HttpOnly cookies (never visible to JavaScript).
  accessTtlSeconds: num(env.HOSTX_ACCESS_TTL_SECONDS, 15 * 60),
  refreshTtlSeconds: num(env.HOSTX_REFRESH_TTL_DAYS, 30) * 24 * 60 * 60,
  // true | false | auto (auto = Secure in production, or when a trusted proxy says the request was https).
  cookieSecure: (env.HOSTX_COOKIE_SECURE ?? 'auto').toLowerCase(),
  accessCookie: 'hostx_at',
  refreshCookie: 'hostx_rt',

  limits: {
    memory: env.HOSTX_APP_MEMORY ?? '300m',
    cpus: env.HOSTX_APP_CPUS ?? '0.5',
    pids: '256',
    maxProjectsPerUser: num(env.HOSTX_MAX_PROJECTS, 5),
    maxConcurrentBuilds: num(env.HOSTX_MAX_BUILDS, 2),
    buildTimeoutMs: 10 * 60 * 1000,
    cloneTimeoutMs: 2 * 60 * 1000,
    startTimeoutMs: 60 * 1000,
    deploymentsKept: 15,
    // Images of this many recent successful deployments are kept on disk for one-click rollback.
    rollbackImages: 3,
    maxLogBytes: 2 * 1024 * 1024,
  },

  // How often the engine checks GitHub for new commits (seconds). 0 disables polling.
  pollSeconds: num(env.HOSTX_POLL_SECONDS, 60),
  // Public URL of the API, shown to users as the GitHub webhook target.
  apiPublicUrl: (env.HOSTX_API_PUBLIC_URL ?? `http://localhost:${num(env.HOSTX_API_PORT, 4000)}`).replace(/\/+$/, ''),

  portRange: { min: 5001, max: 5999 },

  // Razorpay subscriptions. Billing (and plan limits) are on only when key, secret and webhook secret are set.
  razorpay: {
    keyId: env.HOSTX_RAZORPAY_KEY_ID ?? '',
    keySecret: env.HOSTX_RAZORPAY_KEY_SECRET ?? '',
    webhookSecret: env.HOSTX_RAZORPAY_WEBHOOK_SECRET ?? '',
    // Plan ids created in the Razorpay dashboard (Subscriptions -> Plans).
    planIds: { starter: env.HOSTX_RAZORPAY_PLAN_STARTER ?? '', pro: env.HOSTX_RAZORPAY_PLAN_PRO ?? '' },
  },

  // Custom domains: public IPv4 of this server, shown as the A record for apex domains (e.g. myshop.com).
  publicIp: env.HOSTX_PUBLIC_IP || null,
  // DNS servers used to verify custom domains (public resolvers see changes faster than a local cache).
  dnsServers: (env.HOSTX_DNS_SERVERS ?? '1.1.1.1,8.8.8.8').split(',').map((s) => s.trim()).filter(Boolean),

  // Bump when the Terms/Privacy change materially; recorded with each sign-up.
  termsVersion: env.HOSTX_TERMS_VERSION ?? '2026-10-30',

  // Users' apps must not share a registrable domain with the dashboard/API (see checkDomains). Escape hatch for old setups.
  allowSharedDomain: env.HOSTX_ALLOW_SHARED_DOMAIN === 'true',

  // Managed MongoDB add-on: one database + user per project, MONGODB_URI injected into the app.
  mongo: {
    enabled: (env.HOSTX_MONGO ?? 'on').toLowerCase() !== 'off',
    image: env.HOSTX_MONGO_IMAGE ?? 'mongo:8.0',
    memory: env.HOSTX_MONGO_MEMORY ?? '1g',
    cacheGb: /^\d+(\.\d+)?$/.test(env.HOSTX_MONGO_CACHE_GB ?? '') ? (env.HOSTX_MONGO_CACHE_GB as string) : '0.25',
    // Without Docker (or to use your own server): a mongodb:// URI of a user allowed to create users and databases.
    adminUri: env.HOSTX_MONGO_ADMIN_URI || null,
  },
} as const;

const SECOND_LEVEL = new Set(['co', 'com', 'org', 'net', 'gov', 'edu', 'ac', 'ltd', 'plc', 'gen', 'firm', 'ind', 'nic', 'res']);

/** Rough registrable domain ("eTLD+1") without the public suffix list: a.b.example.co.uk -> example.co.uk. */
export function siteOf(host: string): string {
  const labels = host.toLowerCase().replace(/\.$/, '').split('.');
  if (labels.length <= 2) return labels.join('.');
  const [sld, tld] = labels.slice(-2) as [string, string];
  const take = tld.length === 2 && SECOND_LEVEL.has(sld) ? 3 : 2; // co.uk, com.au, co.in, org.in ...
  return labels.slice(-take).join('.');
}

/**
 * Users' apps are untrusted. When they live under the same registrable domain as the dashboard/API they are "same-site":
 * they can set cookies for the whole domain, a single phishing app gets the entire domain blocklisted, and so on.
 * Render keeps apps on onrender.com for exactly this reason. Returns a description of the problem, or null.
 */
export function sharedDomainProblem(): string | null {
  if (config.baseDomain === 'localhost' || config.baseDomain.endsWith('.localhost')) return null;
  const appsSite = siteOf(config.baseDomain);
  const controlHosts = [...config.webOrigins, config.apiPublicUrl].flatMap((u) => {
    try {
      return [new URL(u).hostname];
    } catch {
      return [];
    }
  });
  const clash = controlHosts.find((h) => h !== 'localhost' && siteOf(h) === appsSite);
  return clash
    ? `Apps domain "${config.baseDomain}" shares the registrable domain "${appsSite}" with ${clash}. Put users' apps on a separate domain (e.g. HOSTX_BASE_DOMAIN=yourapps.app) or set HOSTX_ALLOW_SHARED_DOMAIN=true to accept the risk.`
    : null;
}

/** Public URL for a deployed project, e.g. http://my-app.localhost:8080 */
export function projectUrl(slug: string): string {
  const defaultPort = config.publicScheme === 'https' ? 443 : 80;
  const suffix = config.publicPort === defaultPort ? '' : `:${config.publicPort}`;
  return `${config.publicScheme}://${slug}.${config.baseDomain}${suffix}`;
}
