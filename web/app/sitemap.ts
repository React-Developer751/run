import type { MetadataRoute } from 'next';
import { LEGAL, SITE_URL } from '@/lib/site';

const updated = Number.isNaN(Date.parse(LEGAL.updated)) ? new Date() : new Date(LEGAL.updated);

// Only public marketing pages belong here; everything behind login is noindex.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, lastModified: updated, changeFrequency: 'monthly', priority: 1 },
    { url: `${SITE_URL}/pricing`, lastModified: updated, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE_URL}/register`, lastModified: updated, changeFrequency: 'yearly', priority: 0.7 },
    ...['/terms', '/privacy', '/acceptable-use', '/refund-policy', '/shipping-policy', '/contact'].map((path) => ({
      url: `${SITE_URL}${path}`,
      lastModified: updated,
      changeFrequency: 'yearly' as const,
      priority: 0.3,
    })),
  ];
}
