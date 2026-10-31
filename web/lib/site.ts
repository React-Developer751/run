/** Public origin of the dashboard, used for canonical URLs, sitemap and social cards. Set NEXT_PUBLIC_SITE_URL in production. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL || 'http://localhost:3000').replace(/\/+$/, '');
/** Name used until the admin picks another one in Admin → Settings (the engine's DEFAULT_SITE_NAME). */
export const DEFAULT_SITE_NAME = 'HostX';
/** Lower-case tag of the name (build-log lines, example URLs): "DeployKaro Cloud" -> "deploykaro-cloud". Same rule as the engine. */
export const brandSlug = (name: string) => name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '') || 'platform';
export const siteTitle = (name: string) => `${name} — Deploy your MERN app from GitHub in minutes`;
export const SITE_DESCRIPTION =
  'Host your MERN app like on Render: connect GitHub, plug in your MongoDB Atlas database, get free HTTPS and custom domains. No cold starts. Free plan, paid plans from ₹299/month.';

/**
 * Full metadata for a public page. A page-level `openGraph` replaces the root one entirely in Next.js, so every
 * public page goes through this to keep the image, site name, locale and URL.
 */
export function pageMetadata({ title, description, path, name, absoluteTitle = false }: { title: string; description: string; path: string; name: string; absoluteTitle?: boolean }) {
  const fullTitle = absoluteTitle ? title : `${title} · ${name}`;
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    openGraph: { type: 'website' as const, siteName: name, locale: 'en_US', url: path, title: fullTitle, description, images: ['/opengraph-image'] },
    twitter: { card: 'summary_large_image' as const, title: fullTitle, description, images: ['/opengraph-image'] },
  };
}

/**
 * Business details shown on the legal and contact pages (Razorpay and Indian law need real ones).
 * Set them at build time; anything left unset shows a visible [placeholder] so it cannot go live unnoticed.
 */
/** Business details the admin can set in Admin → Settings (each optional). */
export interface BusinessDetails {
  company?: string;
  address?: string;
  email?: string;
  phone?: string;
  abuseEmail?: string;
  grievanceOfficer?: string;
  grievanceEmail?: string;
  jurisdiction?: string;
}

const pick = (placeholder: string, ...values: Array<string | undefined>) => {
  const v = values.find((x) => x && x.trim());
  return v ? v.trim() : `[${placeholder}]`;
};

/**
 * Business details shown on the legal and contact pages and the footer (Razorpay and Indian law need real ones).
 * Order: what the admin saved in Admin → Settings, then the NEXT_PUBLIC_LEGAL_* build values, then a visible
 * [placeholder] so a missing value cannot go live unnoticed.
 */
export function legalFrom(b: BusinessDetails = {}) {
  // Written out as process.env.NEXT_PUBLIC_… so Next.js also inlines them into browser code.
  return {
    company: pick('Registered business name', b.company, process.env.NEXT_PUBLIC_LEGAL_COMPANY),
    address: pick('Registered address, City, State, PIN, India', b.address, process.env.NEXT_PUBLIC_LEGAL_ADDRESS),
    email: pick('support@yourdomain.com', b.email, process.env.NEXT_PUBLIC_LEGAL_EMAIL),
    phone: pick('+91 phone number', b.phone, process.env.NEXT_PUBLIC_LEGAL_PHONE),
    abuseEmail: pick('abuse@yourdomain.com', b.abuseEmail, process.env.NEXT_PUBLIC_LEGAL_ABUSE_EMAIL, b.email, process.env.NEXT_PUBLIC_LEGAL_EMAIL),
    grievanceOfficer: pick('Grievance Officer name', b.grievanceOfficer, process.env.NEXT_PUBLIC_LEGAL_GRIEVANCE_OFFICER),
    grievanceEmail: pick('grievance@yourdomain.com', b.grievanceEmail, process.env.NEXT_PUBLIC_LEGAL_GRIEVANCE_EMAIL, b.email, process.env.NEXT_PUBLIC_LEGAL_EMAIL),
    jurisdiction: pick('City, State', b.jurisdiction, process.env.NEXT_PUBLIC_LEGAL_JURISDICTION),
    /** Keep in sync with HOSTX_TERMS_VERSION on the engine. */
    updated: process.env.NEXT_PUBLIC_LEGAL_UPDATED || '30 October 2026',
  };
}
export type Legal = ReturnType<typeof legalFrom>;

/** Build-time values only (sitemap dates); pages use getLegal() / useLegal() to include the admin's values. */
export const LEGAL = legalFrom();

export const LEGAL_PAGES = [
  { href: '/terms', label: 'Terms of Service' },
  { href: '/privacy', label: 'Privacy Policy' },
  { href: '/acceptable-use', label: 'Acceptable Use' },
  { href: '/refund-policy', label: 'Cancellation & Refunds' },
  { href: '/shipping-policy', label: 'Delivery Policy' },
  { href: '/contact', label: 'Contact' },
];
