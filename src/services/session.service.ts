import crypto from 'node:crypto';
import type http from 'node:http';
import { config } from '../config/index.js';
import { HttpError, authCookieNames, clientIp, parseCookies, secureCookies } from '../utils/http.js';
import { AuthService } from './auth.service.js';
import { Store, type User } from './store.service.js';

/** A refresh token replayed within this window is a harmless race (two tabs refreshing at once), not theft. */
const REUSE_GRACE_MS = 10_000;

const hash = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

function cookie(name: string, value: string, maxAge: number, path: string, secure: boolean): string {
  return `${name}=${encodeURIComponent(value)}; Max-Age=${maxAge}; Path=${path}; HttpOnly; SameSite=Lax${secure ? '; Secure' : ''}`;
}

export class SessionService {
  private static setCookies(req: http.IncomingMessage, res: http.ServerResponse, access: string, refresh: string): void {
    const secure = secureCookies(req);
    const names = authCookieNames(req);
    res.setHeader('Set-Cookie', [
      cookie(names.access, access, config.accessTtlSeconds, '/', secure),
      // __Host- cookies must use Path=/; over plain http the refresh token is only ever sent to the auth endpoints.
      cookie(names.refresh, refresh, config.refreshTtlSeconds, secure ? '/' : '/api/auth', secure),
    ]);
  }

  static clearCookies(req: http.IncomingMessage, res: http.ServerResponse): void {
    const secure = secureCookies(req);
    const names = authCookieNames(req);
    res.setHeader('Set-Cookie', [cookie(names.access, '', 0, '/', secure), cookie(names.refresh, '', 0, secure ? '/' : '/api/auth', secure)]);
  }

  private static async issue(user: User, familyId: string, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const refresh = crypto.randomBytes(48).toString('base64url');
    const id = Store.newId('s');
    await Store.addSession({
      id,
      familyId,
      userId: user.id,
      tokenHash: hash(refresh),
      createdAt: new Date().toISOString(),
      expiresAt: new Date(Date.now() + config.refreshTtlSeconds * 1000).toISOString(),
      rotatedAt: null,
      revokedAt: null,
      ip: clientIp(req),
      userAgent: String(req.headers['user-agent'] ?? '').slice(0, 200),
    });
    this.setCookies(req, res, AuthService.signToken(user.id, id), refresh);
  }

  /** New login: a new family of refresh tokens. */
  static async start(user: User, req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    await this.issue(user, Store.newId('f'), req, res);
  }

  /** Exchanges the refresh cookie for a new access + refresh pair (rotation with reuse detection). */
  static async refresh(req: http.IncomingMessage, res: http.ServerResponse): Promise<User> {
    const fail = (message: string): never => {
      this.clearCookies(req, res);
      throw new HttpError(401, message);
    };
    const raw = parseCookies(req.headers.cookie)[authCookieNames(req).refresh];
    if (!raw) return fail('Please sign in to continue');

    const row = Store.findSessionByHash(hash(raw));
    if (!row || row.revokedAt || new Date(row.expiresAt).getTime() <= Date.now()) return fail('Your session has expired. Please sign in again.');

    const user = Store.getUserById(row.userId);
    if (!user || user.suspended) return fail('This account is not available.');
    if (user.passwordChangedAt && new Date(user.passwordChangedAt).getTime() > new Date(row.createdAt).getTime()) {
      await Store.revokeFamily(row.familyId);
      return fail('Your password was changed. Please sign in again.');
    }

    if (row.rotatedAt) {
      if (Date.now() - new Date(row.rotatedAt).getTime() > REUSE_GRACE_MS) {
        // A token that was already exchanged is being replayed: it was probably stolen. Kill the whole login.
        await Store.revokeFamily(row.familyId);
        return fail('Your session is no longer valid. Please sign in again.');
      }
    } else {
      await Store.updateSession(row.id, { rotatedAt: new Date().toISOString() });
    }

    await this.issue(user, row.familyId, req, res);
    return user;
  }

  /** Logout of this browser. */
  static async end(req: http.IncomingMessage, res: http.ServerResponse): Promise<void> {
    const raw = parseCookies(req.headers.cookie)[authCookieNames(req).refresh];
    const row = raw ? Store.findSessionByHash(hash(raw)) : undefined;
    if (row) await Store.revokeFamily(row.familyId);
    this.clearCookies(req, res);
  }

  static async endAll(userId: string): Promise<void> {
    await Store.revokeUserSessions(userId);
  }
}
