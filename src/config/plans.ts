import { config } from './index.js';

export type PlanId = 'free' | 'starter' | 'pro';
export const PLAN_IDS: PlanId[] = ['free', 'starter', 'pro'];

export interface PlanLimits {
  /** All projects together (web services + static sites). */
  projects: number;
  /** Always-running servers (Express, Next.js ...): the expensive kind. */
  webServices: number;
  /** Built frontends served as files: cheap, so plans allow many. */
  staticSites: number;
  /** Free apps without a single visit for this many days are paused (RAM freed). null = never. */
  pauseAfterDays: number | null;
  /** Paused apps are archived after this many days without visits (image deleted, project kept). null = never. */
  archiveAfterDays: number | null;
  /** Images of the latest successful deploys kept for one-click rollback. */
  rollbackImages: number;
  /** Custom domains across all of the user's projects. */
  customDomains: number;
  /** Docker memory limit per app, e.g. "512m". */
  memory: string;
  /** Docker CPU share per app, e.g. "0.5". */
  cpus: string;
}

export interface Plan extends PlanLimits {
  id: PlanId;
  name: string;
  /** Monthly price in rupees (display only: Razorpay charges what its plan says). */
  priceInr: number;
}

const env = process.env;
const n = (v: string | undefined, d: number) => (v && Number.isFinite(Number(v)) ? Number(v) : d);

export const PLANS: Record<PlanId, Plan> = {
  free: {
    id: 'free',
    name: 'Free',
    priceInr: 0,
    webServices: n(env.HOSTX_FREE_WEB_SERVICES, 5),
    staticSites: n(env.HOSTX_FREE_STATIC_SITES, 10),
    projects: n(env.HOSTX_FREE_WEB_SERVICES, 5) + n(env.HOSTX_FREE_STATIC_SITES, 10),
    customDomains: n(env.HOSTX_FREE_DOMAINS, 1),
    pauseAfterDays: n(env.HOSTX_FREE_PAUSE_DAYS, 7),
    archiveAfterDays: n(env.HOSTX_FREE_ARCHIVE_DAYS, 90),
    rollbackImages: 1,
    // Enough for a typical Express + Mongoose API to run without slowdowns or out-of-memory crashes.
    memory: env.HOSTX_FREE_MEMORY ?? '512m',
    cpus: env.HOSTX_FREE_CPUS ?? '0.5',
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    priceInr: n(env.HOSTX_PRICE_STARTER, 299),
    webServices: n(env.HOSTX_STARTER_WEB_SERVICES, 15),
    staticSites: n(env.HOSTX_STARTER_STATIC_SITES, 50),
    projects: n(env.HOSTX_STARTER_WEB_SERVICES, 15) + n(env.HOSTX_STARTER_STATIC_SITES, 50),
    customDomains: n(env.HOSTX_STARTER_DOMAINS, 3),
    pauseAfterDays: null,
    archiveAfterDays: null,
    rollbackImages: 3,
    memory: env.HOSTX_STARTER_MEMORY ?? '1g',
    cpus: env.HOSTX_STARTER_CPUS ?? '1',
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceInr: n(env.HOSTX_PRICE_PRO, 999),
    webServices: n(env.HOSTX_PRO_WEB_SERVICES, 50),
    staticSites: n(env.HOSTX_PRO_STATIC_SITES, 150),
    projects: n(env.HOSTX_PRO_WEB_SERVICES, 50) + n(env.HOSTX_PRO_STATIC_SITES, 150),
    customDomains: n(env.HOSTX_PRO_DOMAINS, 10),
    pauseAfterDays: null,
    archiveAfterDays: null,
    rollbackImages: 3,
    memory: env.HOSTX_PRO_MEMORY ?? '2g',
    cpus: env.HOSTX_PRO_CPUS ?? '2',
  },
};

/** Fields an admin can change from the dashboard (Admin → Settings → Plans). `projects` is always web + static. */
export type EditablePlan = Omit<Plan, 'id' | 'projects'> & { razorpayPlanId: string };
export type PlanOverrides = Partial<Record<PlanId, Partial<EditablePlan>>>;

// Admin overrides from the database, applied over the env/default values above. Set by the Store on load and save.
let overrides: PlanOverrides = {};
export function setPlanOverrides(next: PlanOverrides | null | undefined): void {
  overrides = next ?? {};
}

/** The plan as it applies right now: defaults (env) + whatever the admin changed. */
export function getPlan(id: PlanId): Plan {
  const { razorpayPlanId: _ignored, ...custom } = overrides[id] ?? {};
  const plan = { ...PLANS[id], ...custom, id };
  return { ...plan, projects: plan.webServices + plan.staticSites };
}

/** Razorpay plan id that bills this plan (admin setting first, then HOSTX_RAZORPAY_PLAN_*). Free has none. */
export function razorpayPlanId(id: PlanId): string {
  if (id === 'free') return '';
  return overrides[id]?.razorpayPlanId || config.razorpay.planIds[id];
}

/** How users can pay. Admin → Settings → Payment methods; set by the Store on load and save. */
export interface PaymentSettings {
  /** Razorpay checkout offered (needs the keys and plan ids too). */
  razorpayEnabled: boolean;
  /** Direct UPI: user pays to this UPI ID, enters the UTR, an admin approves. */
  upi: { enabled: boolean; vpa: string; payeeName: string; note: string };
}
export const DEFAULT_PAYMENTS: PaymentSettings = { razorpayEnabled: true, upi: { enabled: false, vpa: '', payeeName: '', note: '' } };
let payments: PaymentSettings = DEFAULT_PAYMENTS;
export function setPaymentSettings(next: Partial<PaymentSettings> | null | undefined): void {
  payments = { ...DEFAULT_PAYMENTS, ...(next ?? {}), upi: { ...DEFAULT_PAYMENTS.upi, ...(next?.upi ?? {}) } };
}
export function paymentSettings(): PaymentSettings {
  return payments;
}

/** Razorpay keys, webhook secret and at least one plan id are configured on the server. */
export function razorpayReady(): boolean {
  const r = config.razorpay;
  return Boolean(r.keyId && r.keySecret && r.webhookSecret && (razorpayPlanId('starter') || razorpayPlanId('pro')));
}
/** Razorpay checkout is offered to users (configured and switched on by the admin). */
export function razorpayActive(): boolean {
  return payments.razorpayEnabled && razorpayReady();
}
/** Direct UPI payments are offered (switched on, with a UPI ID). */
export function upiActive(): boolean {
  return payments.upi.enabled && Boolean(payments.upi.vpa) && Boolean(payments.upi.payeeName);
}

/** Paid plans exist (some way to pay is on); otherwise a private self-hosted install has no plan limits. */
export function billingEnabled(): boolean {
  return razorpayActive() || upiActive();
}

export const isPlanId = (v: unknown): v is PlanId => typeof v === 'string' && (PLAN_IDS as string[]).includes(v);
