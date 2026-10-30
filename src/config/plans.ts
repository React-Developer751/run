import { config } from './index.js';

export type PlanId = 'free' | 'starter' | 'pro';
export const PLAN_IDS: PlanId[] = ['free', 'starter', 'pro'];

export interface PlanLimits {
  /** Projects (static sites and web services) the user may have. */
  projects: number;
  /** MongoDB add-on databases. */
  databases: number;
  /** Custom domains across all of the user's projects. */
  customDomains: number;
  /** Storage per MongoDB database in MB. Admins are alerted at 80% and 95%. */
  databaseMb: number;
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
    projects: n(env.HOSTX_FREE_PROJECTS, 2),
    databases: n(env.HOSTX_FREE_DATABASES, 1),
    customDomains: n(env.HOSTX_FREE_DOMAINS, 1),
    databaseMb: n(env.HOSTX_FREE_DATABASE_MB, 512),
    // Enough for a typical Express + Mongoose API to run without slowdowns or out-of-memory crashes.
    memory: env.HOSTX_FREE_MEMORY ?? '512m',
    cpus: env.HOSTX_FREE_CPUS ?? '0.5',
  },
  starter: {
    id: 'starter',
    name: 'Starter',
    priceInr: n(env.HOSTX_PRICE_STARTER, 299),
    projects: n(env.HOSTX_STARTER_PROJECTS, 5),
    databases: n(env.HOSTX_STARTER_DATABASES, 3),
    customDomains: n(env.HOSTX_STARTER_DOMAINS, 3),
    databaseMb: n(env.HOSTX_STARTER_DATABASE_MB, 2048),
    memory: env.HOSTX_STARTER_MEMORY ?? '1g',
    cpus: env.HOSTX_STARTER_CPUS ?? '1',
  },
  pro: {
    id: 'pro',
    name: 'Pro',
    priceInr: n(env.HOSTX_PRICE_PRO, 999),
    projects: n(env.HOSTX_PRO_PROJECTS, 15),
    databases: n(env.HOSTX_PRO_DATABASES, 10),
    customDomains: n(env.HOSTX_PRO_DOMAINS, 10),
    databaseMb: n(env.HOSTX_PRO_DATABASE_MB, 10240),
    memory: env.HOSTX_PRO_MEMORY ?? '2g',
    cpus: env.HOSTX_PRO_CPUS ?? '2',
  },
};

/** Plans and their limits apply only once Razorpay is configured; a private self-hosted install is unaffected. */
export function billingEnabled(): boolean {
  const r = config.razorpay;
  return Boolean(r.keyId && r.keySecret && r.webhookSecret && (r.planIds.starter || r.planIds.pro));
}

export const isPlanId = (v: unknown): v is PlanId => typeof v === 'string' && (PLAN_IDS as string[]).includes(v);
