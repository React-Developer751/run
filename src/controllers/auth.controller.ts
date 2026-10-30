import type { Ctx } from '../utils/http.js';
import { HttpError } from '../utils/http.js';
import { RateLimiter } from '../utils/rateLimit.js';
import { validateEmail, validatePassword, validatePersonName } from '../utils/validator.js';
import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { AuthService } from '../services/auth.service.js';
import { AccountService } from '../services/account.service.js';
import { CaptchaService } from '../services/captcha.service.js';
import { MailService } from '../services/mail.service.js';
import { SessionService } from '../services/session.service.js';
import { Store, type User } from '../services/store.service.js';

const limiter = new RateLimiter(20, 15 * 60 * 1000);
const emailLimiter = new RateLimiter(10, 15 * 60 * 1000);
// Outgoing emails cost money and can be used to spam someone's inbox: keep them rare.
const mailLimiter = new RateLimiter(3, 60 * 60 * 1000, 'Too many emails requested. Please wait an hour and try again.');
const forgotLimiter = new RateLimiter(10, 15 * 60 * 1000);

const VERIFY_TTL_MS = 24 * 60 * 60 * 1000;
const RESET_TTL_MS = 60 * 60 * 1000;
const sha256 = (s: string) => crypto.createHash('sha256').update(s).digest('hex');

/** Creates a single-use token for an email link and returns the raw value (only its hash is stored). */
async function issueToken(user: User, kind: 'verify-email' | 'reset-password', ttlMs: number): Promise<string> {
  const raw = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  await Store.addToken({
    id: Store.newId('t'),
    userId: user.id,
    kind,
    hash: sha256(raw),
    createdAt: new Date(now).toISOString(),
    expiresAt: new Date(now + ttlMs).toISOString(),
    usedAt: null,
  });
  return raw;
}

async function sendVerification(user: User): Promise<void> {
  const token = await issueToken(user, 'verify-email', VERIFY_TTL_MS);
  await MailService.verifyEmail(user.email, user.name, `${config.dashboardUrl}/verify-email?token=${token}`);
}

function tokenFrom(value: unknown): string {
  if (typeof value !== 'string' || !/^[A-Za-z0-9_-]{20,100}$/.test(value)) throw new HttpError(400, 'This link is invalid or has expired');
  return value;
}
// Hash of a throwaway password, verified when the email is unknown so response time does not reveal which emails exist.
const DUMMY_HASH = await AuthService.hashPassword('hostx-dummy-password');

const publicUser = (u: User) => ({
  id: u.id,
  name: u.name,
  email: u.email,
  role: u.role,
  emailVerified: u.emailVerifiedAt !== null,
  // Lets the dashboard show the "confirm your email" banner only when it actually blocks deploys.
  verificationRequired: config.requireVerifiedEmail,
  github: u.github ? { login: u.github.login } : null,
  createdAt: u.createdAt,
});

export class AuthController {
  static async register(ctx: Ctx) {
    const firstAccount = Store.allUsers().length === 0;
    if (!firstAccount && !(Store.settings().allowSignup ?? config.allowSignup)) throw new HttpError(403, 'Sign-ups are disabled on this server');
    limiter.hit(`register:${ctx.ip}`);
    const body = await ctx.json();
    const name = validatePersonName(body.name);
    const email = validateEmail(body.email);
    const password = validatePassword(body.password);
    if (body.acceptTerms !== true) throw new HttpError(400, 'Please accept the Terms of Service and Privacy Policy to create an account');
    if (!firstAccount) await CaptchaService.require(body.captcha, ctx.ip);

    if (Store.getUserByEmail(email)) throw new HttpError(409, 'An account with this email already exists');

    const passwordHash = await AuthService.hashPassword(password);
    const user = await Store.addUser({
      id: Store.newId('u'),
      name,
      email,
      passwordHash,
      role: firstAccount || email === config.adminEmail ? 'admin' : 'user',
      suspended: false,
      maxProjects: null,
      lastLoginAt: new Date().toISOString(),
      passwordChangedAt: null,
      // The very first account (the platform owner) must never be locked out by a mail misconfiguration.
      emailVerifiedAt: firstAccount ? new Date().toISOString() : null,
      github: null,
      plan: 'free',
      termsAcceptedAt: new Date().toISOString(),
      termsVersion: config.termsVersion,
      subscription: null,
      createdAt: new Date().toISOString(),
    }).catch((err: Error) => {
      if (err.message === 'EMAIL_TAKEN') throw new HttpError(409, 'An account with this email already exists');
      throw err;
    });
    if (!user.emailVerifiedAt) void sendVerification(user).catch(() => undefined);
    await SessionService.start(user, ctx.req, ctx.res);
    ctx.status = 201;
    return { user: publicUser(user) };
  }

  static async login(ctx: Ctx) {
    limiter.hit(`login:${ctx.ip}`);
    const body = await ctx.json();
    const email = validateEmail(body.email);
    const password = typeof body.password === 'string' ? body.password : '';

    emailLimiter.hit(`login:${email}`);
    const user = Store.getUserByEmail(email);
    const valid = await AuthService.verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !valid) throw new HttpError(401, 'Invalid email or password');
    if (user.suspended) throw new HttpError(403, 'This account has been suspended. Contact your administrator.');
    await Store.updateUser(user.id, { lastLoginAt: new Date().toISOString() });

    await SessionService.start(user, ctx.req, ctx.res);
    return { user: publicUser(user) };
  }

  /** Silent renewal: trades the refresh cookie for a fresh access + refresh pair. */
  static async refresh(ctx: Ctx) {
    const user = await SessionService.refresh(ctx.req, ctx.res);
    return { user: publicUser(user) };
  }

  static async logout(ctx: Ctx) {
    await SessionService.end(ctx.req, ctx.res);
    return { ok: true };
  }

  static async logoutAll(ctx: Ctx) {
    const user = AuthService.requireUser(ctx.user);
    await SessionService.endAll(user.id);
    SessionService.clearCookies(ctx.req, ctx.res);
    return { ok: true };
  }

  static async changePassword(ctx: Ctx) {
    const user = AuthService.requireUser(ctx.user);
    limiter.hit(`password:${ctx.ip}`);
    const body = await ctx.json();
    const current = typeof body.currentPassword === 'string' ? body.currentPassword : '';
    const next = validatePassword(body.newPassword);

    if (!(await AuthService.verifyPassword(current, user.passwordHash))) throw new HttpError(403, 'Your current password is not correct');
    if (current === next) throw new HttpError(400, 'Choose a password that is different from the current one');

    await Store.updateUser(user.id, { passwordHash: await AuthService.hashPassword(next), passwordChangedAt: new Date().toISOString() });
    // Every session (all devices) is revoked; this browser gets a fresh one.
    await SessionService.endAll(user.id);
    await SessionService.start(user, ctx.req, ctx.res);
    return { ok: true };
  }

  /** Opened from the email link. Works without being signed in (the link may be opened on another device). */
  static async verifyEmail(ctx: Ctx) {
    limiter.hit(`verify:${ctx.ip}`);
    const body = await ctx.json();
    const row = Store.findToken(sha256(tokenFrom(body.token)), 'verify-email');
    const user = row ? Store.getUserById(row.userId) : undefined;
    if (!row || !user) throw new HttpError(400, 'This link is invalid or has expired. Sign in and request a new one.');
    await Store.useToken(row.id);
    if (!user.emailVerifiedAt) await Store.updateUser(user.id, { emailVerifiedAt: new Date().toISOString() });
    return { ok: true };
  }

  static async resendVerification(ctx: Ctx) {
    const user = AuthService.requireUser(ctx.user);
    if (user.emailVerifiedAt) return { ok: true, alreadyVerified: true };
    mailLimiter.hit(`verify:${user.id}`);
    await sendVerification(user);
    return { ok: true };
  }

  /** Always answers the same way, so it cannot be used to find out which emails have accounts. */
  static async forgotPassword(ctx: Ctx) {
    forgotLimiter.hit(`forgot:${ctx.ip}`);
    const body = await ctx.json();
    const email = validateEmail(body.email);
    await CaptchaService.require(body.captcha, ctx.ip);
    const user = Store.getUserByEmail(email);
    if (user && !user.suspended) {
      try {
        mailLimiter.hit(`reset:${user.id}`);
        const token = await issueToken(user, 'reset-password', RESET_TTL_MS);
        void MailService.resetPassword(user.email, user.name, `${config.dashboardUrl}/reset-password?token=${token}`);
      } catch {
        /* rate limited: stay silent, same answer as for an unknown email */
      }
    }
    return { ok: true };
  }

  static async resetPassword(ctx: Ctx) {
    limiter.hit(`reset:${ctx.ip}`);
    const body = await ctx.json();
    const token = tokenFrom(body.token);
    const password = validatePassword(body.password);
    const row = Store.findToken(sha256(token), 'reset-password');
    const user = row ? Store.getUserById(row.userId) : undefined;
    if (!row || !user || user.suspended) throw new HttpError(400, 'This link is invalid or has expired. Request a new one.');
    await Store.useToken(row.id);
    const now = new Date().toISOString();
    await Store.updateUser(user.id, {
      passwordHash: await AuthService.hashPassword(password),
      passwordChangedAt: now,
      // Receiving the link proves the address.
      emailVerifiedAt: user.emailVerifiedAt ?? now,
    });
    await SessionService.endAll(user.id);
    return { ok: true };
  }

  /** Self-service account deletion (right to erasure). Needs the password, and the last admin cannot delete themself. */
  static async deleteAccount(ctx: Ctx) {
    const user = AuthService.requireUser(ctx.user);
    limiter.hit(`delete:${ctx.ip}`);
    const body = await ctx.json();
    const password = typeof body.password === 'string' ? body.password : '';
    if (!(await AuthService.verifyPassword(password, user.passwordHash))) throw new HttpError(403, 'Your password is not correct');
    if (user.role === 'admin' && !Store.allUsers().some((u) => u.id !== user.id && u.role === 'admin' && !u.suspended)) {
      throw new HttpError(400, 'You are the only administrator. Make someone else an admin first.');
    }
    await AccountService.delete(user);
    SessionService.clearCookies(ctx.req, ctx.res);
    return { ok: true };
  }

  static me(ctx: Ctx) {
    return { user: publicUser(AuthService.requireUser(ctx.user)) };
  }
}
