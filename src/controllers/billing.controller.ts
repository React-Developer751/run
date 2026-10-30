import { PLANS, PLAN_IDS, isPlanId } from '../config/plans.js';
import type { Ctx } from '../utils/http.js';
import { HttpError } from '../utils/http.js';
import { logger } from '../utils/logger.js';
import { RateLimiter } from '../utils/rateLimit.js';
import { AuthService } from '../services/auth.service.js';
import { BillingService } from '../services/billing.service.js';
import { Store, limitsFor } from '../services/store.service.js';

const limiter = new RateLimiter(10, 60 * 1000, 'Too many billing requests. Wait a moment.');
const webhookLimiter = new RateLimiter(600, 60 * 1000);

export class BillingController {
  /** Public (pricing page). */
  static plans() {
    const buyable = BillingService.purchasable();
    return {
      enabled: BillingService.enabled(),
      plans: PLAN_IDS.map((id) => ({ ...PLANS[id], available: id === 'free' || buyable.includes(id) })),
    };
  }

  static me(ctx: Ctx) {
    const user = AuthService.requireUser(ctx.user);
    const projects = Store.projectsOf(user.id);
    const sub = user.subscription;
    return {
      enabled: BillingService.enabled(),
      plan: user.plan,
      limits: limitsFor(user),
      usage: {
        projects: projects.length,
        databases: projects.filter((p) => p.database).length,
        customDomains: projects.reduce((n, p) => n + p.domains.length, 0),
      },
      subscription: sub ? { plan: sub.plan, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd, paymentUrl: sub.status === 'created' ? sub.shortUrl : null } : null,
    };
  }

  static async subscribe(ctx: Ctx) {
    const user = AuthService.requireVerified(ctx.user);
    limiter.hit(user.id);
    const body = await ctx.json();
    if (!isPlanId(body.plan)) throw new HttpError(400, 'Unknown plan');
    return BillingService.subscribe(user, body.plan);
  }

  static async cancel(ctx: Ctx) {
    const user = AuthService.requireUser(ctx.user);
    limiter.hit(user.id);
    await BillingService.cancel(user);
    return { ok: true };
  }

  /** Razorpay webhook (Settings -> Webhooks), signed with the webhook secret. */
  static async webhook(ctx: Ctx) {
    webhookLimiter.hit(`rzp:${ctx.ip}`);
    const body = await ctx.raw();
    if (!BillingService.verifyWebhook(body, ctx.headers['x-razorpay-signature'] as string | undefined)) {
      throw new HttpError(401, 'Invalid signature');
    }
    const eventId = String(ctx.headers['x-razorpay-event-id'] ?? '');
    if (eventId && Store.hasWebhookEvent(eventId)) return { ok: true, duplicate: true };
    const payload = await ctx.json();
    const result = await BillingService.handleEvent(String(payload.event ?? ''), payload);
    // Recorded only after it was applied: if handling fails we answer 500 and Razorpay's retry is processed normally.
    if (eventId) await Store.markWebhookEvent(eventId);
    logger.info(`Razorpay ${String(payload.event)} -> ${result}`);
    return { ok: true, result };
  }
}
