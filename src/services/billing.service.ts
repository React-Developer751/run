import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { billingEnabled, getPlan, razorpayActive, razorpayPlanId, type PlanId } from '../config/plans.js';
import { HttpError } from '../utils/http.js';
import { logger } from '../utils/logger.js';
import { RunnerService } from './runner.service.js';
import { Store, limitsFor, type Subscription, type User } from './store.service.js';

const API = 'https://api.razorpay.com/v1';

interface RazorpaySubscription {
  id: string;
  plan_id: string;
  status: string;
  current_end: number | null;
  short_url?: string;
  notes?: Record<string, string>;
}

/**
 * Razorpay Subscriptions (UPI autopay, cards, e-mandates). The user pays on Razorpay's hosted page; HostX only
 * trusts signed webhooks to change a plan. No SDK: plain fetch with HTTP basic auth.
 */
export class BillingService {
  static enabled(): boolean {
    return billingEnabled();
  }

  private static requireEnabled(): void {
    if (!razorpayActive()) throw new HttpError(503, 'Card / Razorpay payments are not enabled on this server');
  }

  private static async api<T>(path: string, method = 'GET', body?: unknown): Promise<T> {
    const auth = Buffer.from(`${config.razorpay.keyId}:${config.razorpay.keySecret}`).toString('base64');
    const res = await fetch(`${API}${path}`, {
      method,
      headers: { Authorization: `Basic ${auth}`, ...(body ? { 'Content-Type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(20_000),
    });
    const data = (await res.json().catch(() => ({}))) as T & { error?: { description?: string } };
    if (!res.ok) {
      logger.warn(`Razorpay ${method} ${path} -> ${res.status}: ${data.error?.description ?? ''}`);
      throw new HttpError(502, `Payment provider error: ${data.error?.description ?? 'please try again'}`);
    }
    return data;
  }

  private static planIdFor(plan: PlanId): string {
    return razorpayPlanId(plan);
  }

  private static planFromRazorpay(planId: string): PlanId | null {
    // Current ids first; then the env ids, so subscriptions created before an admin switched plan ids still map.
    for (const id of ['starter', 'pro'] as PlanId[]) if (planId && planId === razorpayPlanId(id)) return id;
    for (const id of ['starter', 'pro'] as const) if (planId && planId === config.razorpay.planIds[id]) return id;
    return null;
  }

  /** Paid plans that can be bought through Razorpay (switched on and with a Razorpay plan id). */
  static purchasable(): PlanId[] {
    if (!razorpayActive()) return [];
    return (['starter', 'pro'] as PlanId[]).filter((p) => this.planIdFor(p));
  }

  /** Starts (or switches) a subscription and returns the Razorpay payment page to send the user to. */
  static async subscribe(user: User, plan: PlanId): Promise<{ url: string | null; changed: boolean }> {
    this.requireEnabled();
    if (plan === 'free') throw new HttpError(400, 'To go back to Free, cancel your subscription');
    const planId = this.planIdFor(plan);
    if (!planId) throw new HttpError(400, 'That plan is not available');

    if (user.manualPlanUntil && new Date(user.manualPlanUntil).getTime() > Date.now()) {
      throw new HttpError(409, `Your plan is paid by UPI until ${new Date(user.manualPlanUntil).toDateString()}. You can switch to an automatic subscription after that.`);
    }
    const sub = user.subscription;
    if (sub?.status === 'cancelling') {
      // The paid period is still running on the old subscription; a second one would be billed in parallel.
      const until = sub.currentPeriodEnd ? ` until ${new Date(sub.currentPeriodEnd).toDateString()}` : '';
      throw new HttpError(409, `Your current plan stays active${until}. You can choose a new plan once it ends.`);
    }
    if (sub && ['active', 'pending'].includes(sub.status)) {
      if (sub.plan === plan) throw new HttpError(409, `You are already on ${getPlan(plan).name}`);
      // Switch an active subscription in place; Razorpay prorates and the webhook applies the new plan.
      await this.api(`/subscriptions/${sub.id}`, 'PATCH', { plan_id: planId, schedule_change_at: 'now', customer_notify: 1 });
      await this.saveSubscription(user, { ...sub, updatedAt: new Date().toISOString() });
      return { url: null, changed: true };
    }
    // An unpaid checkout for the same plan is reused instead of creating a new one on every click.
    if (sub && sub.status === 'created' && sub.plan === plan && sub.shortUrl) return { url: sub.shortUrl, changed: false };
    // A different, still unpaid checkout: cancel it on Razorpay first so its emailed payment link cannot be paid later.
    if (sub && sub.status === 'created') {
      await this.api(`/subscriptions/${sub.id}/cancel`, 'POST', { cancel_at_cycle_end: 0 });
      await this.saveSubscription(user, null);
    }

    const created = await this.api<RazorpaySubscription>('/subscriptions', 'POST', {
      plan_id: planId,
      total_count: 120, // monthly for up to 10 years; cancel any time
      customer_notify: 1,
      notes: { hostx_user_id: user.id, email: user.email },
    });
    await this.saveSubscription(user, {
      id: created.id,
      plan,
      status: 'created',
      currentPeriodEnd: null,
      shortUrl: created.short_url ?? null,
      updatedAt: new Date().toISOString(),
    });
    return { url: created.short_url ?? null, changed: false };
  }

  /** Cancels at the end of the paid period: the plan stays until then, then the webhook moves the user to Free. */
  /** Razorpay API keys present: enough to cancel, even if plans were switched off later. */
  static hasKeys(): boolean {
    return Boolean(config.razorpay.keyId && config.razorpay.keySecret);
  }

  static async cancel(user: User): Promise<void> {
    if (!this.hasKeys()) throw new HttpError(503, 'Billing is not configured on this server');
    const sub = user.subscription;
    if (!sub || !['active', 'pending', 'created'].includes(sub.status)) throw new HttpError(409, 'You have no active subscription');
    if (sub.status === 'created') {
      await this.api(`/subscriptions/${sub.id}/cancel`, 'POST', { cancel_at_cycle_end: 0 }).catch(() => undefined);
      await this.saveSubscription(user, null);
      return;
    }
    await this.api(`/subscriptions/${sub.id}/cancel`, 'POST', { cancel_at_cycle_end: 1 });
    await this.saveSubscription(user, { ...sub, status: 'cancelling', updatedAt: new Date().toISOString() });
  }

  /** Account deletion: stop charging right away (no further renewals), whatever state the subscription is in. */
  static async cancelNow(user: User): Promise<void> {
    const sub = user.subscription;
    if (!sub || !this.hasKeys() || !['created', 'active', 'pending', 'cancelling'].includes(sub.status)) return;
    await this.api(`/subscriptions/${sub.id}/cancel`, 'POST', { cancel_at_cycle_end: 0 });
    await this.saveSubscription(user, null);
  }

  private static async saveSubscription(user: User, sub: Subscription | null): Promise<void> {
    await Store.updateUser(user.id, { subscription: sub });
  }

  static verifyWebhook(body: Buffer, signature: string | undefined): boolean {
    if (!config.razorpay.webhookSecret || !signature) return false;
    const expected = Buffer.from(crypto.createHmac('sha256', config.razorpay.webhookSecret).update(body).digest('hex'));
    const given = Buffer.from(signature);
    return expected.length === given.length && crypto.timingSafeEqual(expected, given);
  }

  /** Applies one verified webhook. Unknown events and subscriptions are ignored. */
  static async handleEvent(eventName: string, payload: Record<string, unknown>): Promise<string> {
    let event = eventName;
    const entity = ((payload.payload as Record<string, { entity?: RazorpaySubscription }> | undefined)?.subscription?.entity ?? null) as RazorpaySubscription | null;
    if (!entity || !event.startsWith('subscription.')) return 'ignored';
    const user = Store.userBySubscription(entity.id) ?? (entity.notes?.hostx_user_id ? Store.getUserById(entity.notes.hostx_user_id) : undefined);
    if (!user) return 'unknown subscription';
    // A user who already started a newer subscription is not affected by events of an older one.
    if (user.subscription && user.subscription.id !== entity.id) return 'stale subscription';
    // Decide by the subscription's own state, not by the event name: deliveries can arrive late and out of order.
    const ended = ['cancelled', 'completed', 'halted', 'expired', 'paused'].includes(entity.status);
    const paying = entity.status === 'active' || entity.status === 'authenticated';
    // No subscription on file (never paid, or an admin granted the plan): only a live, paying one may attach.
    if (!user.subscription && !(paying && (event === 'subscription.activated' || event === 'subscription.charged'))) return 'no subscription on file';
    if (ended && !['subscription.halted', 'subscription.cancelled', 'subscription.completed', 'subscription.paused'].includes(event)) {
      // e.g. a delayed "charged" for a subscription that has since been cancelled: treat it as the end it really is.
      event = 'subscription.cancelled';
    }
    if (!ended && !paying && event !== 'subscription.pending') return `ignored (status ${entity.status})`;

    const plan = this.planFromRazorpay(entity.plan_id) ?? user.subscription?.plan ?? 'free';
    const periodEnd = entity.current_end ? new Date(entity.current_end * 1000).toISOString() : (user.subscription?.currentPeriodEnd ?? null);
    const base: Subscription = {
      id: entity.id,
      plan,
      status: 'active',
      currentPeriodEnd: periodEnd,
      shortUrl: user.subscription?.shortUrl ?? entity.short_url ?? null,
      updatedAt: new Date().toISOString(),
    };

    switch (event) {
      case 'subscription.activated':
      case 'subscription.charged':
      case 'subscription.resumed':
      case 'subscription.updated': {
        const status = user.subscription?.status === 'cancelling' && event !== 'subscription.resumed' ? 'cancelling' : 'active';
        await this.saveSubscription(user, { ...base, status });
        await this.setPlan(user, plan, `payment ${event.split('.')[1]}`);
        return `plan ${plan}`;
      }
      case 'subscription.pending':
        // Renewal failed; Razorpay retries for a few days. Keep the plan meanwhile.
        await this.saveSubscription(user, { ...base, status: 'pending' });
        return 'pending';
      case 'subscription.halted':
      case 'subscription.cancelled':
      case 'subscription.completed':
      case 'subscription.paused':
        await this.saveSubscription(user, null);
        await this.setPlan(user, 'free', event);
        return 'downgraded';
      default:
        return 'ignored';
    }
  }

  /** After an admin changed a plan's RAM/CPU: resize the running containers of everyone on that plan. */
  static async applyPlanLimits(plan: PlanId): Promise<number> {
    let resized = 0;
    for (const user of Store.allUsers()) {
      if (user.plan !== plan) continue;
      const limits = limitsFor(user);
      for (const p of Store.projectsOf(user.id)) {
        if (p.runtime !== 'docker') continue;
        await RunnerService.for(p).updateLimits?.(p, limits.memory, limits.cpus).catch((err) => logger.warn(`Could not resize ${p.slug}`, err));
        resized++;
      }
    }
    return resized;
  }

  /** Changes the plan and applies the new memory/CPU limits to running containers right away. */
  static async setPlan(user: User, plan: PlanId, reason: string): Promise<void> {
    if (user.plan === plan) return;
    logger.info(`Plan of ${user.email}: ${user.plan} -> ${plan} (${reason})`);
    const updated = await Store.updateUser(user.id, { plan });
    const limits = limitsFor(updated);
    for (const p of Store.projectsOf(user.id)) {
      if (p.runtime !== 'docker') continue;
      await RunnerService.for(p).updateLimits?.(p, limits.memory, limits.cpus).catch((err) => logger.warn(`Could not resize ${p.slug}`, err));
    }
  }
}
