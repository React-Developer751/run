import './env.js';
import path from 'node:path';

const root = process.cwd();
const env = process.env;

const num = (value: string | undefined, fallback: number): number => {
  const n = Number(value);
  return value !== undefined && value !== '' && Number.isFinite(n) ? n : fallback;
};

const proxyPort = num(env.HOSTX_PROXY_PORT, 8080);
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

  // Apps are served on <slug>.<baseDomain>. "localhost" works out of the box in modern browsers.
  baseDomain: (env.HOSTX_BASE_DOMAIN ?? 'localhost').toLowerCase(),
  publicScheme,
  publicPort,

  // Comma separated list of dashboard origins allowed to call the API.
  webOrigins: (env.HOSTX_WEB_ORIGIN ?? 'http://localhost:3000').split(',').map((s) => s.trim()),

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
    maxLogBytes: 2 * 1024 * 1024,
  },

  // How often the engine checks GitHub for new commits (seconds). 0 disables polling.
  pollSeconds: num(env.HOSTX_POLL_SECONDS, 60),
  // Public URL of the API, shown to users as the GitHub webhook target.
  apiPublicUrl: (env.HOSTX_API_PUBLIC_URL ?? `http://localhost:${num(env.HOSTX_API_PORT, 4000)}`).replace(/\/+$/, ''),

  portRange: { min: 5001, max: 5999 },
} as const;

/** Public URL for a deployed project, e.g. http://my-app.localhost:8080 */
export function projectUrl(slug: string): string {
  const defaultPort = config.publicScheme === 'https' ? 443 : 80;
  const suffix = config.publicPort === defaultPort ? '' : `:${config.publicPort}`;
  return `${config.publicScheme}://${slug}.${config.baseDomain}${suffix}`;
}
