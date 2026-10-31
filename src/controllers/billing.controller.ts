import { PLAN_IDS, getPlan, isPlanId, razorpayActive, upiActive } from '../config/plans.js';
import type { Ctx } from '../utils/http.js';
import { HttpError } from '../utils/http.js';
import { logger } from '../utils/logger.js';
import { RateLimiter } from '../utils/rateLimit.js';
import { AuthService } from '../services/auth.service.js';
import { BillingService } from '../services/billing.service.js';
import { UpiService, UPI_PERIOD_DAYS } from '../services/upi.service.js';
import { Store, kindOf, limitsFor } from '../services/store.service.js';

const limiter = new RateLimiter(10, 60 * 1000, 'Too many billing requests. Wait a moment.');
const webhookLimiter = new RateLimiter(600, 60 * 1000);

export class BillingController {
  /** Public (pricing page). */
  static plans() {
    const buyable = BillingService.purchasable();
    const upi = upiActive();
    return {
      enabled: BillingService.enabled(),
      // Which ways to pay are on (pricing page wording); no UPI ID or keys here.
      methods: { razorpay: razorpayActive(), upi: upi },
      // A paid plan is offered when Razorpay can bill it, or (UPI on) when it has a price.
      plans: PLAN_IDS.map((id) => ({ ...getPlan(id), available: id === 'free' || buyable.includes(id) || (upi && getPlan(id).priceInr > 0) })),
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
        webServices: projects.filter((p) => kindOf(p) === 'node').length,
        staticSites: projects.filter((p) => kindOf(p) === 'static').length,
        paused: projects.filter((p) => p.status === 'paused' || p.status === 'archived').length,
        customDomains: projects.reduce((n, p) => n + p.domains.length, 0),
      },
      subscription: sub ? { plan: sub.plan, status: sub.status, currentPeriodEnd: sub.currentPeriodEnd, paymentUrl: sub.status === 'created' ? sub.shortUrl : null } : null,
      // Payment methods the admin switched on, and the user's direct UPI state.
      methods: { razorpay: razorpayActive(), razorpayPlans: BillingService.purchasable(), upi: UpiService.details() },
      upi: {
        paidUntil: UpiService.planIsPaidByUpi(user) ? user.manualPlanUntil : null,
        periodDays: UPI_PERIOD_DAYS,
        payments: UpiService.historyOf(user.id).map((p) => ({ id: p.id, plan: p.plan, amountInr: p.amountInr, utr: p.utr, status: p.status, reason: p.reason, createdAt: p.createdAt, paidUntil: p.paidUntil })),
      },
    };
  }

  static async subscribe(ctx: Ctx) {
    const user = AuthService.requireVerified(ctx.user);
    limiter.hit(user.id);
    const body = await ctx.json();
    if (!isPlanId(body.plan)) throw new HttpError(400, 'Unknown plan');
    return BillingService.subscribe(user, body.plan);
  }

  /** Direct UPI: the user paid the plan price to the admin's UPI ID and reports the UTR for an admin to verify. */
  static async payByUpi(ctx: Ctx) {
    const user = AuthService.requireVerified(ctx.user);
    limiter.hit(user.id);
    const body = await ctx.json();
    const p = await UpiService.submit(user, body.plan, body.utr);
    ctx.status = 201;
    return { payment: { id: p.id, plan: p.plan, amountInr: p.amountInr, utr: p.utr, status: p.status, createdAt: p.createdAt } };
  }

  static async cancel(ctx: Ctx) {
    const user = AuthService.requireUser(ctx.user);
    limiter.hit(user.id);
    await BillingService.cancel(user);
    return { ok: true };
  }

  /** Razorpay webhook (Settings -> Webhooks), signed with the webhook secret. */
  static async webhook(ctx: Ctx) {
    webhookLimiter.hit(`rzp:${ctx.ipKey}`);
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
