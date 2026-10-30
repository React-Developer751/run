import type { MetadataRoute } from 'next';
import { SITE_URL } from '@/lib/site';

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [{ userAgent: '*', allow: '/', // Login, sign-up helpers and token pages are not blocked here: they carry noindex, which crawlers can only see if they may fetch them.
      disallow: ['/dashboard', '/new', '/projects/', '/admin', '/account', '/billing'] }],
    sitemap: `${SITE_URL}/sitemap.xml`,
    host: SITE_URL,
  };
}
