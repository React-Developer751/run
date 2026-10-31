// Server-side only (uses Next's fetch cache).
import { DEFAULT_SITE_NAME, legalFrom, type BusinessDetails } from './site';
import type { Plan } from './types';

/** Engine address for server-side fetches (same machine in production; the public URL works too). */
const API = process.env.HOSTX_INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
/** Cache tag of everything the admin can change in Admin → Settings that public pages show (name, business details). */
export const SITE_NAME_TAG = 'site-name';

interface PublicInfo {
  siteName: string;
  urlTemplate: string;
  business: BusinessDetails;
}

const FALLBACK: PublicInfo = { siteName: DEFAULT_SITE_NAME, urlTemplate: 'http://{slug}.localhost:8080', business: {} };

function parse(raw: { siteName?: string; urlTemplate?: string; business?: BusinessDetails }): PublicInfo {
  return {
    siteName: raw.siteName?.trim() || DEFAULT_SITE_NAME,
    urlTemplate: raw.urlTemplate?.includes('{slug}') ? raw.urlTemplate : FALLBACK.urlTemplate,
    business: raw.business && typeof raw.business === 'object' ? raw.business : {},
  };
}

/**
 * Settings the admin controls that server-rendered pages show. Cached for 60 s and dropped immediately when the admin
 * saves (see app/actions.ts). If the engine cannot be reached (e.g. during `next build`) defaults are used.
 */
async function publicInfo(): Promise<PublicInfo> {
  try {
    const r = await fetch(`${API}/api/health`, { next: { revalidate: 60, tags: [SITE_NAME_TAG] } });
    return r.ok ? parse(await r.json()) : FALLBACK;
  } catch {
    return FALLBACK;
  }
}

/** The platform name chosen in Admin → Settings (titles, landing, legal pages). */
export async function getSiteName(): Promise<string> {
  return (await publicInfo()).siteName;
}

/** How app URLs look on this server, e.g. "https://{slug}.apps.deploykaro.com" (Render: {slug}.onrender.com). */
export async function getAppUrlTemplate(): Promise<string> {
  return (await publicInfo()).urlTemplate;
}

/** Raw business details the admin saved (missing fields = not set by the admin). */
export async function getBusiness(): Promise<BusinessDetails> {
  return (await publicInfo()).business;
}

/** Company, address, contacts for legal/contact pages: admin value, else env value, else a visible [placeholder]. */
export async function getLegal() {
  return legalFrom(await getBusiness());
}

export interface PlansInfo {
  /** Paid plans can be bought (some payment method is on). */
  enabled: boolean;
  methods: { razorpay: boolean; upi: boolean };
  /** Plans offered right now (free + paid ones with a way to pay). */
  plans: Plan[];
}

async function plansFrom(init: RequestInit & { next?: { revalidate: number; tags: string[] } }): Promise<PlansInfo | null> {
  try {
    const r = await fetch(`${API}/api/billing/plans`, init);
    if (!r.ok) return null;
    const d = (await r.json()) as { enabled: boolean; methods?: PlansInfo['methods']; plans: Array<Plan & { available: boolean }> };
    return { enabled: d.enabled, methods: d.methods ?? { razorpay: false, upi: false }, plans: d.plans.filter((p) => p.available) };
  } catch {
    return null;
  }
}

/** Plans and payment methods for the public pages (pricing, landing). Same cache and refresh as the name. */
export async function getPlansInfo(): Promise<PlansInfo | null> {
  return plansFrom({ next: { revalidate: 60, tags: [SITE_NAME_TAG] } });
}

/** "card, UPI AutoPay or netbanking (Razorpay) or direct UPI", or null when nothing can be bought. */
export function paymentWording(methods: PlansInfo['methods']): string | null {
  const parts = [methods.razorpay ? 'UPI AutoPay, cards or netbanking through Razorpay' : '', methods.upi ? 'a direct UPI transfer' : ''].filter(Boolean);
  return parts.length ? parts.join(', or ') : null;
}

/** Fingerprint of everything admin-controlled that public pages show, straight from the engine (no cache). */
export async function freshPublicInfo(): Promise<string | null> {
  try {
    const r = await fetch(`${API}/api/health`, { cache: 'no-store' });
    if (!r.ok) return null;
    const { siteName, business } = parse(await r.json());
    const plans = await plansFrom({ cache: 'no-store' });
    return JSON.stringify({ siteName, business, plans });
  } catch {
    return null;
  }
}

export async function cachedPublicInfo(): Promise<string> {
  const { siteName, business } = await publicInfo();
  return JSON.stringify({ siteName, business, plans: await getPlansInfo() });
}
