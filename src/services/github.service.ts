import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { HttpError } from '../utils/http.js';
import { logger } from '../utils/logger.js';
import { AuthService } from './auth.service.js';
import { Store, type User } from './store.service.js';

const API = 'https://api.github.com';
const STATE_TTL_MS = 15 * 60 * 1000;

export interface GitHubRepo {
  fullName: string;
  url: string;
  private: boolean;
  defaultBranch: string;
  installationId: number;
  pushedAt: string | null;
}

interface CachedToken {
  token: string;
  expiresAt: number;
}

const b64url = (v: object) => Buffer.from(JSON.stringify(v)).toString('base64url');

/**
 * GitHub App integration (like Render's): users install the app on their account/org and pick repositories.
 * HostX then clones with short-lived installation tokens (1 hour, only the chosen repos, read-only contents).
 * No GitHub SDK: JWT RS256 via node:crypto and plain fetch.
 */
export class GitHubService {
  private static tokens = new Map<number, CachedToken>();

  static enabled(): boolean {
    const g = config.github;
    return Boolean(g.appId && g.appSlug && g.clientId && g.clientSecret && g.privateKey);
  }

  private static requireEnabled(): void {
    if (!this.enabled()) throw new HttpError(503, 'GitHub integration is not configured on this server');
  }

  /** App JWT (max 10 minutes), used only to mint installation tokens. */
  private static appJwt(): string {
    const now = Math.floor(Date.now() / 1000);
    const head = `${b64url({ alg: 'RS256', typ: 'JWT' })}.${b64url({ iat: now - 60, exp: now + 540, iss: config.github.appId })}`;
    const signature = crypto.createSign('RSA-SHA256').update(head).sign(config.github.privateKey as string, 'base64url');
    return `${head}.${signature}`;
  }

  private static async request<T>(path: string, auth: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
    const res = await fetch(path.startsWith('http') ? path : `${API}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: auth,
        'User-Agent': 'HostX',
        'X-GitHub-Api-Version': '2022-11-28',
        ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      },
      ...(init.body ? { body: JSON.stringify(init.body) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      const err = new Error(`GitHub ${res.status} on ${path}: ${text.slice(0, 200)}`) as Error & { status?: number };
      err.status = res.status;
      throw err;
    }
    return (await res.json()) as T;
  }

  /** Short-lived token for one installation, cached until 5 minutes before it expires. */
  static async installationToken(installationId: number): Promise<string> {
    this.requireEnabled();
    const cached = this.tokens.get(installationId);
    if (cached && cached.expiresAt - Date.now() > 5 * 60 * 1000) return cached.token;
    try {
      const r = await this.request<{ token: string; expires_at: string }>(`/app/installations/${installationId}/access_tokens`, `Bearer ${this.appJwt()}`, {
        method: 'POST',
      });
      this.tokens.set(installationId, { token: r.token, expiresAt: new Date(r.expires_at).getTime() });
      return r.token;
    } catch (err) {
      if ((err as { status?: number }).status === 404) {
        throw new Error('HostX no longer has access to this repository on GitHub. Reinstall or reconfigure the HostX GitHub App.');
      }
      throw err;
    }
  }

  /**
   * Environment for git so it authenticates as the installation. The token travels in an HTTP header set through
   * GIT_CONFIG_* variables: it never appears in the clone URL, in .git/config, in `ps` output or in build logs.
   */
  static async gitEnv(installationId: number | null): Promise<NodeJS.ProcessEnv | undefined> {
    if (installationId === null) return undefined;
    const token = await this.installationToken(installationId);
    const basic = Buffer.from(`x-access-token:${token}`).toString('base64');
    return {
      ...process.env,
      GIT_CONFIG_COUNT: '1',
      GIT_CONFIG_KEY_0: 'http.https://github.com/.extraheader',
      GIT_CONFIG_VALUE_0: `AUTHORIZATION: basic ${basic}`,
    };
  }

  // ── connect flow ───────────────────────────────────────
  /** Signed, expiring state binding the GitHub round trip to the HostX user who started it. */
  private static state(userId: string): string {
    const payload = `${userId}.${Date.now() + STATE_TTL_MS}`;
    return `${payload}.${AuthService.signValue(`gh-state:${payload}`)}`;
  }

  static checkState(state: string, userId: string): boolean {
    const parts = state.split('.');
    if (parts.length !== 3) return false;
    const [uid, exp, sig] = parts as [string, string, string];
    const expected = Buffer.from(AuthService.signValue(`gh-state:${uid}.${exp}`));
    const given = Buffer.from(sig);
    return uid === userId && Number(exp) > Date.now() && expected.length === given.length && crypto.timingSafeEqual(expected, given);
  }

  static connectUrls(user: User): { installUrl: string; authorizeUrl: string } {
    this.requireEnabled();
    const state = encodeURIComponent(this.state(user.id));
    const redirect = encodeURIComponent(`${config.apiPublicUrl}/api/auth/github/callback`);
    return {
      // New install / pick repositories. With "Request user authorization during installation" enabled, GitHub comes back with ?code.
      installUrl: `https://github.com/apps/${config.github.appSlug}/installations/new?state=${state}`,
      // The app is already installed (e.g. by a teammate): just prove who you are.
      authorizeUrl: `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(config.github.clientId)}&state=${state}&redirect_uri=${redirect}`,
    };
  }

  /**
   * Finishes the connect flow. Installation ids from the query string are NOT trusted (anyone could paste someone
   * else's): we exchange the OAuth code and ask GitHub which installations this GitHub user can actually access.
   */
  static async link(user: User, code: string): Promise<User> {
    this.requireEnabled();
    const oauth = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'HostX' },
      body: JSON.stringify({ client_id: config.github.clientId, client_secret: config.github.clientSecret, code }),
      signal: AbortSignal.timeout(15_000),
    }).then((r) => r.json() as Promise<{ access_token?: string; error_description?: string }>);
    if (!oauth.access_token) throw new HttpError(400, oauth.error_description ?? 'GitHub did not accept the sign-in. Please try again.');

    const auth = `Bearer ${oauth.access_token}`;
    const me = await this.request<{ login: string }>('/user', auth);
    const ids: number[] = [];
    for (let page = 1; page <= 5; page++) {
      const r = await this.request<{ installations: Array<{ id: number; app_slug?: string }> }>(`/user/installations?per_page=100&page=${page}`, auth);
      ids.push(...r.installations.map((i) => i.id));
      if (r.installations.length < 100) break;
    }
    // The user token is not stored: HostX only ever acts through installation tokens.
    return Store.updateUser(user.id, { github: { login: me.login, installationIds: [...new Set(ids)], linkedAt: new Date().toISOString() } });
  }

  static async unlink(user: User): Promise<User> {
    return Store.updateUser(user.id, { github: null });
  }

  /** Repositories the user can deploy, across all of their installations. Installations that are gone are dropped. */
  static async repos(user: User): Promise<GitHubRepo[]> {
    this.requireEnabled();
    const out: GitHubRepo[] = [];
    const alive: number[] = [];
    for (const id of user.github?.installationIds ?? []) {
      try {
        out.push(...(await this.installationRepos(id)));
        alive.push(id);
      } catch (err) {
        logger.warn(`GitHub installation ${id} of ${user.email} is not usable: ${(err as Error).message}`);
      }
    }
    if (user.github && alive.length !== user.github.installationIds.length) {
      await Store.updateUser(user.id, { github: { ...user.github, installationIds: alive } });
    }
    return out.sort((a, b) => (b.pushedAt ?? '').localeCompare(a.pushedAt ?? ''));
  }

  private static async installationRepos(installationId: number): Promise<GitHubRepo[]> {
    const auth = `token ${await this.installationToken(installationId)}`;
    const out: GitHubRepo[] = [];
    for (let page = 1; page <= 10; page++) {
      const r = await this.request<{
        repositories: Array<{ full_name: string; private: boolean; default_branch: string; pushed_at: string | null }>;
      }>(`/installation/repositories?per_page=100&page=${page}`, auth);
      out.push(
        ...r.repositories.map((x) => ({
          fullName: x.full_name,
          url: `https://github.com/${x.full_name}`,
          private: x.private,
          defaultBranch: x.default_branch,
          installationId,
          pushedAt: x.pushed_at,
        })),
      );
      if (r.repositories.length < 100) break;
    }
    return out;
  }

  /** Checks that `user` may deploy `repoUrl` through `installationId`. Returns the id to store on the project. */
  static async authorizeRepo(user: User, installationId: unknown, repoUrl: string): Promise<number | null> {
    if (installationId === undefined || installationId === null || installationId === '') return null;
    this.requireEnabled();
    const id = Number(installationId);
    if (!Number.isInteger(id) || !user.github?.installationIds.includes(id)) throw new HttpError(403, 'Connect this GitHub account first');
    const fullName = /^https:\/\/github\.com\/(.+?)\.git$/.exec(repoUrl)?.[1]?.toLowerCase();
    const repos = await this.installationRepos(id);
    if (!repos.some((r) => r.fullName.toLowerCase() === fullName)) {
      throw new HttpError(403, 'The HostX GitHub App does not have access to this repository. Add it in the app settings on GitHub.');
    }
    return id;
  }

  static verifyWebhook(body: Buffer, header: string | undefined): boolean {
    if (!config.github.webhookSecret || !header?.startsWith('sha256=')) return false;
    const expected = Buffer.from(crypto.createHmac('sha256', config.github.webhookSecret).update(body).digest('hex'));
    const given = Buffer.from(header.slice(7));
    return expected.length === given.length && crypto.timingSafeEqual(expected, given);
  }
}
