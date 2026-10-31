import crypto from 'node:crypto';
import { config } from '../config/index.js';
import type { Ctx } from '../utils/http.js';
import { HttpError, parseCookies, secureCookies } from '../utils/http.js';
import { logger } from '../utils/logger.js';
import { RateLimiter } from '../utils/rateLimit.js';
import { AuthService } from '../services/auth.service.js';
import { DeployService } from '../services/deploy.service.js';
import { GitHubService } from '../services/github.service.js';
import { SessionService } from '../services/session.service.js';
import { Store } from '../services/store.service.js';

const limiter = new RateLimiter(300, 60 * 1000);
const loginLimiter = new RateLimiter(30, 15 * 60 * 1000);

const NONCE_COOKIE = 'hostx_gh_login';
const nonceCookie = (ctx: Ctx, value: string, maxAge: number) =>
  `${NONCE_COOKIE}=${value}; Max-Age=${maxAge}; Path=/api/auth/github; HttpOnly; SameSite=Lax${secureCookies(ctx.req) ? '; Secure' : ''}`;
const repoLimiter = new RateLimiter(30, 60 * 1000, 'Too many requests to GitHub. Wait a moment.');

function redirect(ctx: Ctx, to: string): { ok: true } {
  ctx.res.writeHead(302, { Location: to, 'Cache-Control': 'no-store' });
  ctx.res.end();
  return { ok: true };
}

export class GitHubController {
  static status(ctx: Ctx) {
    const user = AuthService.requireUser(ctx.user);
    return {
      enabled: GitHubService.enabled(),
      connected: Boolean(user.github),
      login: user.github?.login ?? null,
      installations: user.github?.installationIds.length ?? 0,
      ...(GitHubService.enabled() ? GitHubService.connectUrls(user, ctx.query.get('return') === 'new' ? 'new' : undefined) : {}),
    };
  }

  /** Starts "Continue with GitHub". The nonce cookie ties the GitHub round trip to this browser (login CSRF). */
  static login(ctx: Ctx) {
    if (!GitHubService.enabled()) return redirect(ctx, `${config.dashboardUrl}/login?github=disabled`);
    try {
      loginLimiter.hit(`gh-login:${ctx.ipKey}`);
    } catch {
      return redirect(ctx, `${config.dashboardUrl}/login?github=rate-limited`);
    }
    const nonce = crypto.randomBytes(18).toString('base64url');
    ctx.res.setHeader('Set-Cookie', nonceCookie(ctx, nonce, 600));
    return redirect(ctx, GitHubService.loginUrl(nonce));
  }

  /**
   * GitHub sends the browser here after installing the app or authorizing it (top-level GET, so the Lax session
   * cookies come along). Two flows share it, told apart by the signed state:
   * - sign-in ("login~<nonce>"): the nonce must match this browser's cookie;
   * - linking ("<userId>"): the signed-in session must be that user. Otherwise an attacker could send a victim their
   *   own link and get the victim's GitHub installations linked to the attacker's account.
   * Lives under /api/auth so the refresh cookie is sent too (the 15-minute access token may expire while on GitHub).
   */
  static async callback(ctx: Ctx) {
    const code = ctx.query.get('code');
    const state = ctx.query.get('state') ?? '';
    const subject = GitHubService.readState(state);

    if (subject?.startsWith('login~')) {
      const fail = (reason: string) => {
        ctx.res.setHeader('Set-Cookie', nonceCookie(ctx, '', 0));
        return redirect(ctx, `${config.dashboardUrl}/login?github=${reason}`);
      };
      const cookieNonce = parseCookies(ctx.headers.cookie)[NONCE_COOKIE];
      if (!code || !cookieNonce || subject !== `login~${cookieNonce}`) return fail('expired');
      try {
        const { user, created } = await GitHubService.signIn(code);
        if (user.suspended) return fail('suspended');
        await SessionService.start(user, ctx.req, ctx.res);
        ctx.res.appendHeader('Set-Cookie', nonceCookie(ctx, '', 0));
        // New accounts, and accounts without projects yet, go straight to deploying.
        const next = created || Store.projectsOf(user.id).length === 0 ? '/new' : '/dashboard';
        return redirect(ctx, `${config.dashboardUrl}${next}`);
      } catch (err) {
        const message = (err as Error).message;
        logger.warn(`GitHub sign-in failed: ${message}`);
        return fail(['signup-closed', 'no-verified-email'].includes(message) ? message : 'failed');
      }
    }

    const user = ctx.user ?? (await SessionService.refresh(ctx.req, ctx.res).catch(() => null));
    if (!user || user.suspended) return redirect(ctx, `${config.dashboardUrl}/login`);
    const toNew = subject?.endsWith('~new');
    const back = (result: string) => redirect(ctx, `${config.dashboardUrl}${toNew ? '/new' : '/account'}?github=${result}`);
    if (!code) return back(ctx.query.get('setup_action') === 'request' ? 'requested' : 'missing-code');
    if (!GitHubService.checkState(state, user.id)) return back('expired');
    try {
      await GitHubService.link(user, code);
      return back('connected');
    } catch (err) {
      logger.warn(`GitHub connect for ${user.email} failed: ${(err as Error).message}`);
      return back((err as { status?: number }).status === 409 ? 'taken' : 'failed');
    }
  }

  static async repos(ctx: Ctx) {
    const user = AuthService.requireUser(ctx.user);
    repoLimiter.hit(user.id);
    if (!user.github) return { repos: [] };
    return { repos: await GitHubService.repos(user) };
  }

  static async unlink(ctx: Ctx) {
    const user = AuthService.requireUser(ctx.user);
    await GitHubService.unlink(user);
    return { ok: true };
  }

  /** The GitHub App's single webhook: pushes to any connected repo, and app uninstalls. */
  static async webhook(ctx: Ctx) {
    limiter.hit(`gh-webhook:${ctx.ipKey}`);
    const body = await ctx.raw();
    if (!GitHubService.verifyWebhook(body, ctx.headers['x-hub-signature-256'] as string | undefined)) {
      throw new HttpError(401, 'Invalid webhook signature');
    }
    const event = String(ctx.headers['x-github-event'] ?? '');
    const payload = await ctx.json();
    const installationId = Number((payload.installation as { id?: number } | undefined)?.id);

    if (event === 'installation' && payload.action === 'deleted') {
      for (const u of Store.allUsers()) {
        if (u.github?.installationIds.includes(installationId)) {
          await Store.updateUser(u.id, { github: { ...u.github, installationIds: u.github.installationIds.filter((i) => i !== installationId) } });
        }
      }
      return { ok: true };
    }
    if (event !== 'push') return { ok: true, ignored: event };

    const repo = (payload.repository ?? {}) as { full_name?: string; default_branch?: string };
    const repoUrl = `https://github.com/${repo.full_name ?? ''}.git`.toLowerCase();
    const started: string[] = [];
    for (const project of Store.allProjects()) {
      if (project.githubInstallationId !== installationId || project.repoUrl.toLowerCase() !== repoUrl) continue;
      if (payload.ref !== `refs/heads/${project.branch ?? repo.default_branch ?? 'main'}`) continue;
      if (!project.autoDeploy || project.status === 'deploying' || project.status === 'stopped' || project.status === 'suspended') continue;
      const deployment = await DeployService.deploy(project, 'auto').catch((err: Error) => {
        logger.warn(`Webhook deploy of ${project.slug} skipped: ${err.message}`);
        return null;
      });
      if (deployment) started.push(deployment.id);
    }
    ctx.status = started.length > 0 ? 202 : 200;
    return { ok: true, deployments: started };
  }
}
