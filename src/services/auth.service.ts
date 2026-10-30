import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import type http from 'node:http';
import { promisify } from 'node:util';
import { config } from '../config/index.js';
import { HttpError, authCookieNames, parseCookies } from '../utils/http.js';
import { Store, type User } from './store.service.js';

const scrypt = promisify(crypto.scrypt) as (password: string, salt: Buffer, keylen: number) => Promise<Buffer>;

interface TokenPayload {
  sub: string;
  /** Session (refresh-token row) this access token belongs to; logout revokes it immediately. */
  sid: string;
  exp: number;
  iat: number;
  /** Millisecond issue time: second-level iat would let a token minted in the same second as a password reset survive it. */
  iatMs?: number;
}

export class AuthService {
  private static secret: Buffer = Buffer.alloc(0);

  /** Secret comes from HOSTX_SECRET, otherwise a random one is generated once and kept in data/secret.key. */
  static async init(): Promise<void> {
    if (config.secretFromEnv) {
      if (config.isProduction && config.secretFromEnv.length < 32) {
        throw new Error('HOSTX_SECRET must be at least 32 characters in production (try: openssl rand -hex 32).');
      }
      this.secret = Buffer.from(config.secretFromEnv);
      return;
    }
    try {
      this.secret = Buffer.from((await fs.readFile(config.secretFile, 'utf8')).trim(), 'hex');
    } catch {
      this.secret = crypto.randomBytes(48);
      await fs.mkdir(config.dataDir, { recursive: true });
      await fs.writeFile(config.secretFile, this.secret.toString('hex'), { mode: 0o600 });
    }
  }

  /** Independent key for a purpose (e.g. encrypting env vars), derived from the HostX secret. */
  static deriveKey(purpose: string): Buffer {
    return Buffer.from(crypto.hkdfSync('sha256', this.secret, Buffer.alloc(0), purpose, 32));
  }

  static async hashPassword(password: string): Promise<string> {
    const salt = crypto.randomBytes(16);
    const hash = await scrypt(password, salt, 64);
    return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
  }

  static async verifyPassword(password: string, stored: string): Promise<boolean> {
    const [scheme, saltB64, hashB64] = stored.split('$');
    if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
    const expected = Buffer.from(hashB64, 'base64');
    const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
    return crypto.timingSafeEqual(actual, expected);
  }

  private static sign(data: string): string {
    return crypto.createHmac('sha256', this.secret).update(data).digest('base64url');
  }

  /** Compact HS256 JWT built on node:crypto. */
  static signToken(userId: string, sessionId: string): string {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url');
    const now = Math.floor(Date.now() / 1000);
    const payload: TokenPayload = { sub: userId, sid: sessionId, iat: now, iatMs: Date.now(), exp: now + config.accessTtlSeconds };
    const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
    return `${header}.${body}.${this.sign(`${header}.${body}`)}`;
  }

  static verifyToken(token: string): TokenPayload | null {
    const [header, body, signature] = token.split('.');
    if (!header || !body || !signature) return null;
    const expected = Buffer.from(this.sign(`${header}.${body}`));
    const given = Buffer.from(signature);
    if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) return null;
    try {
      const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8')) as TokenPayload;
      return payload.exp > Date.now() / 1000 ? payload : null;
    } catch {
      return null;
    }
  }

  /** The access token comes only from the HttpOnly cookie. There is no Authorization-header login any more. */
  static async authenticate(req: http.IncomingMessage): Promise<User | null> {
    const token = parseCookies(req.headers.cookie)[authCookieNames(req).access];
    if (!token) return null;
    const payload = this.verifyToken(token);
    if (!payload) return null;
    const user = Store.getUserById(payload.sub);
    const session = Store.getSession(payload.sid);
    if (!user || !session || session.revokedAt || session.userId !== user.id) return null;
    // A password change/reset signs every older session out.
    if (user.passwordChangedAt && (payload.iatMs ?? payload.iat * 1000) < new Date(user.passwordChangedAt).getTime()) return null;
    return user;
  }

  static requireUser(user: User | null): User {
    if (!user) throw new HttpError(401, 'Please sign in to continue');
    // 401 (not 403) so the dashboard drops the session instead of showing a broken page.
    if (user.suspended) throw new HttpError(401, 'This account has been suspended. Contact your administrator.');
    return user;
  }

  /** Signed-in user whose email is confirmed (only enforced when HOSTX_REQUIRE_VERIFIED_EMAIL / SMTP is on). */
  static requireVerified(user: User | null): User {
    const u = this.requireUser(user);
    if (config.requireVerifiedEmail && !u.emailVerifiedAt && u.role !== 'admin') {
      throw new HttpError(403, 'Please confirm your email address first. Check your inbox, or resend the link from the dashboard.');
    }
    return u;
  }

  /** HMAC of a value with the HostX secret (for short-lived signed state, e.g. the GitHub connect flow). */
  static signValue(data: string): string {
    return this.sign(data);
  }

  static requireAdmin(user: User | null): User {
    const u = this.requireUser(user);
    if (u.role !== 'admin') throw new HttpError(403, 'Administrator access required');
    return u;
  }
}
