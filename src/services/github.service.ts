import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { HttpError } from '../utils/http.js';
import { logger } from '../utils/logger.js';
import { AuthService } from './auth.service.js';
import { Store, siteName, type User } from './store.service.js';

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
        throw new Error(`${siteName()} no longer has access to this repository on GitHub. Reinstall or reconfigure the ${siteName()} GitHub App.`);
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

  // ── connect / sign-in flow ─────────────────────────────
  /**
   * Signed, expiring OAuth state. The subject is "<userId>" or "<userId>~new" (linking, bound to the signed-in user)
   * or "login~<nonce>" (sign-in, bound to a nonce cookie in the same browser). No dots in subjects.
   */
  private static state(subject: string): string {
    const payload = `${subject}.${Date.now() + STATE_TTL_MS}`;
    return `${payload}.${AuthService.signValue(`gh-state:${payload}`)}`;
  }

  /** The subject of a valid, unexpired state, or null. */
  static readState(state: string): string | null {
    const parts = state.split('.');
    if (parts.length !== 3) return null;
    const [subject, exp, sig] = parts as [string, string, string];
    const expected = Buffer.from(AuthService.signValue(`gh-state:${subject}.${exp}`));
    const given = Buffer.from(sig);
    if (!(Number(exp) > Date.now() && expected.length === given.length && crypto.timingSafeEqual(expected, given))) return null;
    return subject;
  }

  static checkState(state: string, userId: string): boolean {
    return this.readState(state)?.split('~')[0] === userId;
  }

  private static authorizeUrl(state: string): string {
    const redirect = encodeURIComponent(`${config.apiPublicUrl}/api/auth/github/callback`);
    return `https://github.com/login/oauth/authorize?client_id=${encodeURIComponent(config.github.clientId)}&state=${encodeURIComponent(state)}&redirect_uri=${redirect}`;
  }

  /** `returnTo: 'new'` brings the user back to the New deploy page after picking repositories. */
  static connectUrls(user: User, returnTo?: 'new'): { installUrl: string; authorizeUrl: string } {
    this.requireEnabled();
    const state = this.state(returnTo ? `${user.id}~${returnTo}` : user.id);
    return {
      // New install / pick repositories. With "Request user authorization during installation" enabled, GitHub comes back with ?code.
      installUrl: `https://github.com/apps/${config.github.appSlug}/installations/new?state=${encodeURIComponent(state)}`,
      // The app is already installed (e.g. by a teammate): just prove who you are.
      authorizeUrl: this.authorizeUrl(state),
    };
  }

  /** "Continue with GitHub" on the login/register page. `nonce` is also stored in a short-lived cookie. */
  static loginUrl(nonce: string): string {
    this.requireEnabled();
    return this.authorizeUrl(this.state(`login~${nonce}`));
  }

  /** Exchanges the OAuth code for a user token. The token is never stored: HostX acts through installation tokens. */
  private static async userAuth(code: string): Promise<string> {
    const oauth = await fetch('https://github.com/login/oauth/access_token', {
      method: 'POST',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json', 'User-Agent': 'HostX' },
      body: JSON.stringify({ client_id: config.github.clientId, client_secret: config.github.clientSecret, code }),
      signal: AbortSignal.timeout(15_000),
    }).then((r) => r.json() as Promise<{ access_token?: string; error_description?: string }>);
    if (!oauth.access_token) throw new HttpError(400, oauth.error_description ?? 'GitHub did not accept the sign-in. Please try again.');
    return `Bearer ${oauth.access_token}`;
  }

  private static async userInstallations(auth: string): Promise<number[]> {
    const ids: number[] = [];
    for (let page = 1; page <= 5; page++) {
      const r = await this.request<{ installations: Array<{ id: number }> }>(`/user/installations?per_page=100&page=${page}`, auth);
      ids.push(...r.installations.map((i) => i.id));
      if (r.installations.length < 100) break;
    }
    return [...new Set(ids)];
  }

  /**
   * Finishes the connect flow. Installation ids from the query string are NOT trusted (anyone could paste someone
   * else's): we exchange the OAuth code and ask GitHub which installations this GitHub user can actually access.
   */
  static async link(user: User, code: string): Promise<User> {
    this.requireEnabled();
    const auth = await this.userAuth(code);
    const me = await this.request<{ id: number; login: string }>('/user', auth);
    const other = Store.getUserByGithubId(me.id) ?? this.legacyLink(me.login, await this.userInstallations(auth));
    if (other && other.id !== user.id) throw new HttpError(409, `@${me.login} is already linked to another ${config.dashboardUrl} account`);
    return Store.updateUser(user.id, { github: { id: me.id, login: me.login, installationIds: await this.userInstallations(auth), linkedAt: new Date().toISOString() } });
  }

  /**
   * Links made before GitHub ids were stored only have the login. Match those by login AND a shared installation
   * (logins can be renamed and reused; installation ids cannot), so the user is backfilled instead of duplicated.
   */
  private static legacyLink(login: string, installationIds: number[]): User | undefined {
    return Store.allUsers().find(
      (u) => u.github && u.github.id === undefined && u.github.login.toLowerCase() === login.toLowerCase() && u.github.installationIds.some((i) => installationIds.includes(i)),
    );
  }

  /** The GitHub account's verified primary email (needs the app's "Email addresses: read" permission). */
  private static async verifiedEmail(auth: string, profileEmail: string | null): Promise<string | null> {
    try {
      const emails = await this.request<Array<{ email: string; primary: boolean; verified: boolean }>>('/user/emails', auth);
      return (emails.find((e) => e.primary && e.verified) ?? emails.find((e) => e.verified))?.email.toLowerCase() ?? null;
    } catch {
      // GitHub only lets users show a verified address publicly, so the profile email is a safe fallback.
      return profileEmail?.toLowerCase() ?? null;
    }
  }

  /**
   * "Continue with GitHub": signs in the HostX account linked to this GitHub user, or the account with the same
   * verified email (and links it), or creates one. Returns the user and whether it was just created.
   */
  static async signIn(code: string): Promise<{ user: User; created: boolean }> {
    this.requireEnabled();
    const auth = await this.userAuth(code);
    const me = await this.request<{ id: number; login: string; name: string | null; email: string | null }>('/user', auth);
    const installationIds = await this.userInstallations(auth);
    const github = { id: me.id, login: me.login, installationIds, linkedAt: new Date().toISOString() };

    const linked = Store.getUserByGithubId(me.id) ?? this.legacyLink(me.login, installationIds);
    if (linked) return { user: await Store.updateUser(linked.id, { github, lastLoginAt: new Date().toISOString() }), created: false };

    const email = await this.verifiedEmail(auth, me.email);
    if (!email) throw new HttpError(400, 'no-verified-email');
    const existing = Store.getUserByEmail(email);
    if (existing) {
      // GitHub has verified this address, so the GitHub user owns it. If the HostX account never proved the address,
      // somebody else may have registered it first ("pre-hijack"): their password and sessions must stop working.
      const now = new Date().toISOString();
      if (!existing.emailVerifiedAt) {
        await Store.updateUser(existing.id, { passwordHash: await AuthService.hashPassword(crypto.randomBytes(32).toString('base64url')), passwordChangedAt: now });
        await Store.revokeUserSessions(existing.id);
      }
      const user = await Store.updateUser(existing.id, { github, lastLoginAt: now, emailVerifiedAt: existing.emailVerifiedAt ?? now });
      return { user, created: false };
    }

    const firstAccount = Store.allUsers().length === 0;
    if (!firstAccount && !(Store.settings().allowSignup ?? config.allowSignup)) throw new HttpError(403, 'signup-closed');
    const now = new Date().toISOString();
    const name = (me.name?.trim() || me.login).slice(0, 60).padEnd(2, '_');
    // No password: GitHub sign-in only, until the user sets one with "Forgot password".
    const passwordHash = await AuthService.hashPassword(crypto.randomBytes(32).toString('base64url'));
    // Decided after the last await, right before the insert (see AuthController.register). Never while an admin exists.
    const owner = !Store.hasAdmin() && (Store.allUsers().length === 0 || (config.adminEmail !== '' && email === config.adminEmail));
    const user = await Store.addUser({
      id: Store.newId('u'),
      name,
      email,
      passwordHash,
      role: owner ? 'admin' : 'user',
      suspended: false,
      maxProjects: null,
      lastLoginAt: now,
      passwordChangedAt: null,
      emailVerifiedAt: now,
      github,
      plan: 'free',
      // The button says "By continuing you agree to the Terms and Privacy Policy".
      termsAcceptedAt: now,
      termsVersion: config.termsVersion,
      subscription: null,
      createdAt: now,
    });
    return { user, created: true };
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

  /** The user's installation that can read `repoUrl`, or null (then it is cloned as a public repository). */
  static async installationFor(user: User, repoUrl: string): Promise<number | null> {
    if (!this.enabled() || !user.github) return null;
    const fullName = /^https:\/\/github\.com\/(.+?)\.git$/.exec(repoUrl)?.[1]?.toLowerCase();
    for (const id of user.github.installationIds) {
      const repos = await this.installationRepos(id).catch(() => []);
      if (repos.some((r) => r.fullName.toLowerCase() === fullName)) return id;
    }
    return null;
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
      throw new HttpError(403, `The ${siteName()} GitHub App does not have access to this repository. Add it in the app settings on GitHub.`);
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
