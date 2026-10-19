import type { Ctx } from '../utils/http.js';
import { HttpError } from '../utils/http.js';
import { RateLimiter } from '../utils/rateLimit.js';
import { validateEmail, validatePassword, validatePersonName } from '../utils/validator.js';
import { config } from '../config/index.js';
import { AuthService } from '../services/auth.service.js';
import { SessionService } from '../services/session.service.js';
import { Store, type User } from '../services/store.service.js';

const limiter = new RateLimiter(20, 15 * 60 * 1000);
const emailLimiter = new RateLimiter(10, 15 * 60 * 1000);
// Hash of a throwaway password, verified when the email is unknown so response time does not reveal which emails exist.
const DUMMY_HASH = await AuthService.hashPassword('hostx-dummy-password');

const publicUser = (u: User) => ({ id: u.id, name: u.name, email: u.email, role: u.role, createdAt: u.createdAt });

export class AuthController {
  static async register(ctx: Ctx) {
    const firstAccount = Store.allUsers().length === 0;
    if (!firstAccount && !(Store.settings().allowSignup ?? config.allowSignup)) throw new HttpError(403, 'Sign-ups are disabled on this server');
    limiter.hit(`register:${ctx.ip}`);
    const body = await ctx.json();
    const name = validatePersonName(body.name);
    const email = validateEmail(body.email);
    const password = validatePassword(body.password);

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
      createdAt: new Date().toISOString(),
    }).catch((err: Error) => {
      if (err.message === 'EMAIL_TAKEN') throw new HttpError(409, 'An account with this email already exists');
      throw err;
    });
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

  static me(ctx: Ctx) {
    return { user: publicUser(AuthService.requireUser(ctx.user)) };
  }
}
