import type { Ctx } from '../utils/http.js';
import { HttpError } from '../utils/http.js';
import { RateLimiter } from '../utils/rateLimit.js';
import { validateEmail, validatePassword, validatePersonName } from '../utils/validator.js';
import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { AuthService } from '../services/auth.service.js';
import { AccountService } from '../services/account.service.js';
import { MailService } from '../services/mail.service.js';
import { SessionService } from '../services/session.service.js';
import { Store, kindOf, limitsFor, type User } from '../services/store.service.js';
import { billingEnabled, getPlan } from '../config/plans.js';

const limiter = new RateLimiter(20, 15 * 60 * 1000);
// Sign-in requests per network. Wrong passwords are limited much tighter below (per email); this one only stops
// floods, and must allow a college or office where many people sign in from one IP.
const loginLimiter = new RateLimiter(100, 15 * 60 * 1000, 'Too many sign-in attempts from your network. Please wait a few minutes.');
// Only FAILED logins count, so nobody can lock a user out by spamming wrong passwords for their email from elsewhere:
// 10 failures per email+IP, and a generous 50 per email overall against distributed guessing.
const emailIpFailures = new RateLimiter(10, 15 * 60 * 1000);
const emailFailures = new RateLimiter(50, 15 * 60 * 1000);
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

/** HOSTX_ADMIN_EMAIL gets the admin role, but only after an emailed link proved the address belongs to them. */
/**
 * HOSTX_ADMIN_EMAIL becomes admin once its address is proven, but only while the platform has no admin at all:
 * once an admin exists, new admins are made only by an admin (Admin → Users) or on the server (npm run make-admin).
 */
async function promoteConfiguredAdmin(user: User): Promise<void> {
  if (config.adminEmail && user.email === config.adminEmail && user.role !== 'admin' && !Store.hasAdmin()) {
    await Store.updateUser(user.id, { role: 'admin' });
  }
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
    limiter.hit(`register:${ctx.ipKey}`);
    const body = await ctx.json();
    const name = validatePersonName(body.name);
    const email = validateEmail(body.email);
    const password = validatePassword(body.password);
    if (body.acceptTerms !== true) throw new HttpError(400, 'Please accept the Terms of Service and Privacy Policy to create an account');

    if (Store.getUserByEmail(email)) throw new HttpError(409, 'An account with this email already exists');

    const passwordHash = await AuthService.hashPassword(password);
    // Decided right before the (synchronous) insert, after every await: two sign-ups racing on a fresh server cannot
    // both see an empty platform. Only the very first account, and only while no admin exists, becomes admin.
    const owner = Store.allUsers().length === 0 && !Store.hasAdmin();
    const user = await Store.addUser({
      id: Store.newId('u'),
      name,
      email,
      passwordHash,
      // HOSTX_ADMIN_EMAIL becomes admin only once that address is confirmed (verifyEmail), never just by signing up with it.
      role: owner ? 'admin' : 'user',
      suspended: false,
      maxProjects: null,
      lastLoginAt: new Date().toISOString(),
      passwordChangedAt: null,
      // The very first account (the platform owner) must never be locked out by a mail misconfiguration.
      emailVerifiedAt: owner ? new Date().toISOString() : null,
      github: null,
      plan: 'free',
      termsAcceptedAt: new Date().toISOString(),
      termsVersion: config.termsVersion,
      subscription: null,
      manualPlanUntil: null,
      manualPlanRemindedAt: null,
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
    loginLimiter.hit(`login:${ctx.ipKey}`);
    const body = await ctx.json();
    const email = validateEmail(body.email);
    const password = typeof body.password === 'string' ? body.password : '';

    emailIpFailures.check(`${email}|${ctx.ipKey}`);
    emailFailures.check(email);
    const user = Store.getUserByEmail(email);
    const valid = await AuthService.verifyPassword(password, user?.passwordHash ?? DUMMY_HASH);
    if (!user || !valid) {
      emailIpFailures.hit(`${email}|${ctx.ipKey}`);
      emailFailures.hit(email);
      throw new HttpError(401, 'Invalid email or password');
    }
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
    limiter.hit(`password:${ctx.ipKey}`);
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
    limiter.hit(`verify:${ctx.ipKey}`);
    const body = await ctx.json();
    const row = Store.findToken(sha256(tokenFrom(body.token)), 'verify-email');
    const user = row ? Store.getUserById(row.userId) : undefined;
    if (!row || !user) throw new HttpError(400, 'This link is invalid or has expired. Sign in and request a new one.');
    await Store.useToken(row.id);
    if (!user.emailVerifiedAt) await Store.updateUser(user.id, { emailVerifiedAt: new Date().toISOString() });
    await promoteConfiguredAdmin(user);
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
    forgotLimiter.hit(`forgot:${ctx.ipKey}`);
    const body = await ctx.json();
    const email = validateEmail(body.email);
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
    limiter.hit(`reset:${ctx.ipKey}`);
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
    await promoteConfiguredAdmin(user);
    return { ok: true };
  }

  /** Self-service account deletion (right to erasure). Needs the password, and the last admin cannot delete themself. */
  static async deleteAccount(ctx: Ctx) {
    const user = AuthService.requireUser(ctx.user);
    limiter.hit(`delete:${ctx.ipKey}`);
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

  /** Everything the Profile page shows about the signed-in user: plan, sign-in methods, usage, activity. */
  static profile(ctx: Ctx) {
    const user = AuthService.requireUser(ctx.user);
    const projects = Store.projectsOf(user.id);
    const sub = user.subscription;
    const subLive = Boolean(sub && ['active', 'pending', 'cancelling'].includes(sub.status));
    const upiUntil = user.manualPlanUntil && new Date(user.manualPlanUntil).getTime() > Date.now() ? user.manualPlanUntil : null;
    const limits = limitsFor(user);
    const plan = getPlan(user.plan);
    return {
      user: { ...publicUser(user), lastLoginAt: user.lastLoginAt, passwordChangedAt: user.passwordChangedAt, emailVerifiedAt: user.emailVerifiedAt },
      plan: {
        id: user.plan,
        name: plan.name,
        priceInr: plan.priceInr,
        paidPlansOffered: billingEnabled(),
        // How the current plan is paid: razorpay subscription, direct UPI (until a date), set by an admin, or free.
        source: subLive ? 'razorpay' : upiUntil ? 'upi' : user.plan === 'free' ? 'free' : 'admin',
        renewsOn: subLive && sub?.status !== 'cancelling' ? sub?.currentPeriodEnd ?? null : null,
        endsOn: sub?.status === 'cancelling' ? sub.currentPeriodEnd : upiUntil,
        subscriptionStatus: sub?.status ?? null,
      },
      limits: { webServices: limits.webServices, staticSites: limits.staticSites, customDomains: limits.customDomains, memory: limits.memory, cpus: limits.cpus },
      usage: {
        projects: projects.length,
        live: projects.filter((p) => p.status === 'live').length,
        webServices: projects.filter((p) => kindOf(p) === 'node').length,
        staticSites: projects.filter((p) => kindOf(p) === 'static').length,
        customDomains: projects.reduce((n, p) => n + p.domains.length, 0),
      },
      signIn: { email: true, github: user.github ? { login: user.github.login, linkedAt: user.github.linkedAt } : null, activeSessions: Store.activeSessionsOf(user.id).length },
      support: { open: Store.ticketsOf(user.id).filter((t) => t.status !== 'closed').length, unread: Store.ticketsOf(user.id).filter((t) => t.userUnread).length },
    };
  }

  /** Profile: change the display name. */
  static async updateMe(ctx: Ctx) {
    const user = AuthService.requireUser(ctx.user);
    limiter.hit(`profile:${user.id}`);
    const body = await ctx.json();
    const name = validatePersonName(body.name);
    const updated = await Store.updateUser(user.id, { name });
    return { user: publicUser(updated) };
  }

  static me(ctx: Ctx) {
    return { user: publicUser(AuthService.requireUser(ctx.user)) };
  }
}
