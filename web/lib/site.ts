/** Public origin of the dashboard, used for canonical URLs, sitemap and social cards. Set NEXT_PUBLIC_SITE_URL in production. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
export const SITE_NAME = 'HostX';
export const SITE_TITLE = 'HostX — Deploy your MERN app from GitHub in minutes';
export const SITE_DESCRIPTION =
  'Host your MERN app like on Render: connect GitHub, get a managed MongoDB database, free HTTPS and custom domains. Apps never sleep. Free plan, paid plans from ₹299/month.';

/**
 * Full metadata for a public page. A page-level `openGraph` replaces the root one entirely in Next.js, so every
 * public page goes through this to keep the image, site name, locale and URL.
 */
export function pageMetadata({ title, description, path, absoluteTitle = false }: { title: string; description: string; path: string; absoluteTitle?: boolean }) {
  const fullTitle = absoluteTitle ? title : `${title} · ${SITE_NAME}`;
  return {
    title: absoluteTitle ? { absolute: title } : title,
    description,
    alternates: { canonical: path },
    openGraph: { type: 'website' as const, siteName: SITE_NAME, locale: 'en_US', url: path, title: fullTitle, description, images: ['/opengraph-image'] },
    twitter: { card: 'summary_large_image' as const, title: fullTitle, description, images: ['/opengraph-image'] },
  };
}

/**
 * Business details shown on the legal and contact pages (Razorpay and Indian law need real ones).
 * Set them at build time; anything left unset shows a visible [placeholder] so it cannot go live unnoticed.
 */
const env = (v: string | undefined, placeholder: string) => (v && v.trim() ? v.trim() : `[${placeholder}]`);
export const LEGAL = {
  company: env(process.env.NEXT_PUBLIC_LEGAL_COMPANY, 'Registered business name'),
  address: env(process.env.NEXT_PUBLIC_LEGAL_ADDRESS, 'Registered address, City, State, PIN, India'),
  email: env(process.env.NEXT_PUBLIC_LEGAL_EMAIL, 'support@yourdomain.com'),
  phone: env(process.env.NEXT_PUBLIC_LEGAL_PHONE, '+91 phone number'),
  abuseEmail: env(process.env.NEXT_PUBLIC_LEGAL_ABUSE_EMAIL ?? process.env.NEXT_PUBLIC_LEGAL_EMAIL, 'abuse@yourdomain.com'),
  grievanceOfficer: env(process.env.NEXT_PUBLIC_LEGAL_GRIEVANCE_OFFICER, 'Grievance Officer name'),
  grievanceEmail: env(process.env.NEXT_PUBLIC_LEGAL_GRIEVANCE_EMAIL ?? process.env.NEXT_PUBLIC_LEGAL_EMAIL, 'grievance@yourdomain.com'),
  jurisdiction: env(process.env.NEXT_PUBLIC_LEGAL_JURISDICTION, 'City, State'),
  /** Keep in sync with HOSTX_TERMS_VERSION on the engine. */
  updated: process.env.NEXT_PUBLIC_LEGAL_UPDATED ?? '30 October 2026',
};

export const LEGAL_PAGES = [
  { href: '/terms', label: 'Terms of Service' },
  { href: '/privacy', label: 'Privacy Policy' },
  { href: '/acceptable-use', label: 'Acceptable Use' },
  { href: '/refund-policy', label: 'Cancellation & Refunds' },
  { href: '/shipping-policy', label: 'Delivery Policy' },
  { href: '/contact', label: 'Contact' },
];
