import { config } from '../config/index.js';
import { getPlan, isPlanId, paymentSettings, upiActive } from '../config/plans.js';
import { HttpError } from '../utils/http.js';
import { logger } from '../utils/logger.js';
import { AdminAlertService } from './admin-alert.service.js';
import { BillingService } from './billing.service.js';
import { MailService } from './mail.service.js';
import { Store, type UpiPayment, type User } from './store.service.js';

const DAY = 24 * 60 * 60 * 1000;
/** One UPI payment buys this many days of the plan. */
export const UPI_PERIOD_DAYS = 30;
const REMIND_DAYS = 3;
const CHECK_MS = 60 * 60 * 1000;
/** UPI reference number (UTR / RRN) as shown by every UPI app: 12 digits. */
const UTR = /^\d{12}$/;

const RAZORPAY_LIVE = ['created', 'active', 'pending', 'cancelling'];
const billingUrl = () => `${config.dashboardUrl}/billing`;

/**
 * Direct UPI payments, next to Razorpay: the user pays the plan price to the admin's UPI ID, enters the UTR, and an
 * admin checks the bank statement and approves it. One approval = one month of the plan; no automatic renewal, so the
 * user is reminded before the end and moved to Free when the period runs out (nothing is deleted).
 */
export class UpiService {
  private static running = false;

  static start(): void {
    setTimeout(() => void this.tick().catch((err) => logger.warn('UPI plan check failed', err)), 30_000).unref();
    setInterval(() => void this.tick().catch((err) => logger.warn('UPI plan check failed', err)), CHECK_MS).unref();
  }

  /** What the billing page shows to pay: UPI ID, payee, note. Null when UPI is switched off. */
  static details() {
    if (!upiActive()) return null;
    const { vpa, payeeName, note } = paymentSettings().upi;
    return { vpa, payeeName, note };
  }

  static pendingOf(userId: string): UpiPayment | undefined {
    return Store.allUpiPayments().find((p) => p.userId === userId && p.status === 'pending');
  }

  static async submit(user: User, plan: unknown, utrRaw: unknown): Promise<UpiPayment> {
    if (!upiActive()) throw new HttpError(503, 'UPI payments are not enabled');
    if (!isPlanId(plan) || plan === 'free') throw new HttpError(400, 'Choose a paid plan');
    const price = getPlan(plan).priceInr;
    if (price <= 0) throw new HttpError(400, 'That plan has no price');
    if (user.subscription && RAZORPAY_LIVE.includes(user.subscription.status)) {
      throw new HttpError(409, 'You have a Razorpay subscription. Cancel it (or let it end) before paying by UPI.');
    }
    if (this.pendingOf(user.id)) throw new HttpError(409, 'Your previous UPI payment is still being verified. Please wait for it.');
    const utr = typeof utrRaw === 'string' ? utrRaw.replace(/\s+/g, '') : '';
    if (!UTR.test(utr)) throw new HttpError(400, 'Enter the 12-digit UPI reference number (UTR) from your UPI app');
    if (Store.allUpiPayments().some((p) => p.utr === utr && p.status !== 'rejected')) {
      throw new HttpError(409, 'This UTR was already submitted. Each payment can be used once.');
    }
    const payment = await Store.putUpiPayment({
      id: Store.newId('up'),
      userId: user.id,
      plan,
      amountInr: price,
      utr,
      status: 'pending',
      reason: null,
      createdAt: new Date().toISOString(),
      decidedAt: null,
      decidedBy: null,
      paidUntil: null,
    });
    await AdminAlertService.notify({
      kind: 'upi-payment',
      severity: 'warning',
      title: `UPI payment to verify: ₹${price} for ${getPlan(plan).name}`,
      message: `${user.email} paid ₹${price} (${getPlan(plan).name}) by UPI. UTR ${utr}. Check your bank statement and approve or reject it.`,
      userId: user.id,
      emailKey: `upi:${payment.id}`,
      link: '/admin/payments',
      linkLabel: 'Open payments',
    });
    return payment;
  }

  static async approve(id: string, admin: User): Promise<UpiPayment> {
    const payment = Store.getUpiPayment(id);
    if (!payment) throw new HttpError(404, 'Payment not found');
    if (payment.status !== 'pending') throw new HttpError(409, `This payment was already ${payment.status}`);
    const user = Store.getUserById(payment.userId);
    if (!user) throw new HttpError(409, 'The account no longer exists. Refund the payment manually.');
    if (user.subscription && RAZORPAY_LIVE.includes(user.subscription.status)) {
      throw new HttpError(409, 'This user now has a Razorpay subscription. Reject this payment and refund it.');
    }
    // Paying again for the same plan before it ends extends it; any other case starts a fresh month today.
    const now = Date.now();
    const current = user.manualPlanUntil ? new Date(user.manualPlanUntil).getTime() : 0;
    const from = user.plan === payment.plan && current > now ? current : now;
    const paidUntil = new Date(from + UPI_PERIOD_DAYS * DAY).toISOString();
    await BillingService.setPlan(user, payment.plan, `UPI payment ${payment.utr} approved by ${admin.email}`);
    await Store.updateUser(user.id, { manualPlanUntil: paidUntil, manualPlanRemindedAt: null });
    const done = await Store.putUpiPayment({ ...payment, status: 'approved', decidedAt: new Date().toISOString(), decidedBy: admin.email, paidUntil });
    await Store.addAudit(admin, 'payment.approve', user.email, `${payment.plan} ₹${payment.amountInr} UTR ${payment.utr} until ${paidUntil.slice(0, 10)}`);
    void MailService.billingNotice(
      user.email,
      user.name,
      `Payment received: ${getPlan(payment.plan).name} is active`,
      `we received your UPI payment of ₹${payment.amountInr} (UTR ${payment.utr}). Your ${getPlan(payment.plan).name} plan is active until ${new Date(paidUntil).toDateString()}. UPI payments do not renew automatically: pay again before that date to continue.`,
      billingUrl(),
    );
    return done;
  }

  static async reject(id: string, admin: User, reasonRaw: unknown): Promise<UpiPayment> {
    const payment = Store.getUpiPayment(id);
    if (!payment) throw new HttpError(404, 'Payment not found');
    if (payment.status !== 'pending') throw new HttpError(409, `This payment was already ${payment.status}`);
    const reason = typeof reasonRaw === 'string' ? reasonRaw.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '';
    if (reason.length < 5 || reason.length > 300) throw new HttpError(400, 'Give a reason the user will see (5-300 characters)');
    const done = await Store.putUpiPayment({ ...payment, status: 'rejected', reason, decidedAt: new Date().toISOString(), decidedBy: admin.email });
    const user = Store.getUserById(payment.userId);
    await Store.addAudit(admin, 'payment.reject', user?.email ?? payment.userId, `UTR ${payment.utr}: ${reason}`);
    if (user) {
      void MailService.billingNotice(
        user.email,
        user.name,
        'UPI payment could not be verified',
        `we could not verify your UPI payment of ₹${payment.amountInr} (UTR ${payment.utr}). Reason: ${reason}. If money left your account, reply via Support with a screenshot of the payment and we will sort it out.`,
        billingUrl(),
      );
    }
    return done;
  }

  /** Hourly: remind before a UPI-paid period ends, and move users whose period ended back to Free. */
  static async tick(now = Date.now()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const user of [...Store.allUsers()]) {
        if (!user.manualPlanUntil) continue;
        const until = new Date(user.manualPlanUntil).getTime();
        if (until <= now) {
          const plan = getPlan(user.plan).name;
          if (!(user.subscription && RAZORPAY_LIVE.includes(user.subscription.status))) {
            await BillingService.setPlan(user, 'free', 'UPI period ended');
          }
          await Store.updateUser(user.id, { manualPlanUntil: null, manualPlanRemindedAt: null });
          void MailService.billingNotice(
            user.email,
            user.name,
            `Your ${plan} plan has ended`,
            `the ${plan} period you paid by UPI has ended, so your account is on the Free plan now. Nothing was deleted; apps above the Free limits keep their settings. Pay again from the Billing page to get ${plan} back.`,
            billingUrl(),
          );
        } else if (until - now <= REMIND_DAYS * DAY && !user.manualPlanRemindedAt) {
          await Store.updateUser(user.id, { manualPlanRemindedAt: new Date(now).toISOString() });
          void MailService.billingNotice(
            user.email,
            user.name,
            `Your ${getPlan(user.plan).name} plan ends on ${new Date(until).toDateString()}`,
            `UPI payments do not renew automatically. Pay again from the Billing page before ${new Date(until).toDateString()} to keep ${getPlan(user.plan).name}; the new month starts when the current one ends.`,
            billingUrl(),
          );
        }
      }
    } finally {
      this.running = false;
    }
  }

  /** The user's own payments (newest first) for the billing page. */
  static historyOf(userId: string, limit = 10): UpiPayment[] {
    return Store.allUpiPayments().filter((p) => p.userId === userId).slice(0, limit);
  }

  static planIsPaidByUpi(user: User): boolean {
    return Boolean(user.manualPlanUntil && new Date(user.manualPlanUntil).getTime() > Date.now());
  }
}
