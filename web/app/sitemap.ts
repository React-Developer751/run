import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

// Only public marketing pages belong here; everything behind login is noindex.
export default function sitemap(): MetadataRoute.Sitemap {
  return [
    { url: `${SITE_URL}/`, changeFrequency: 'monthly', priority: 1 },
    { url: `${SITE_URL}/pricing`, changeFrequency: 'monthly', priority: 0.8 },
    { url: `${SITE_URL}/register`, changeFrequency: 'yearly', priority: 0.7 },
  ];
}
