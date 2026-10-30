import path from 'node:path';
import { fileURLToPath } from 'node:url';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
if (process.env.NODE_ENV === 'production' && (!process.env.NEXT_PUBLIC_SITE_URL || !process.env.NEXT_PUBLIC_API_URL)) {
  // Canonical URLs, sitemap, social images and API calls would all point at localhost.
  console.warn('\n⚠  NEXT_PUBLIC_SITE_URL / NEXT_PUBLIC_API_URL are not set: this build uses localhost URLs. Set them in web/.env.local before a real deployment.\n');
}

const securityHeaders = [
  { key: 'X-Frame-Options', value: 'DENY' },
  ...(process.env.NODE_ENV === 'production' ? [{ key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains' }] : []),
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  {
    key: 'Content-Security-Policy',
    value: [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline'" + (process.env.NODE_ENV === 'production' ? '' : " 'unsafe-eval'"),
      "style-src 'self' 'unsafe-inline'",
      "img-src 'self' data:",
      `connect-src 'self' ${api}` + (process.env.NODE_ENV === 'production' ? '' : ' ws://localhost:3000'),
      "frame-ancestors 'none'",
      "base-uri 'self'",
      "form-action 'self'",
    ].join('; '),
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  turbopack: { root: path.dirname(fileURLToPath(import.meta.url)) },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
};
export default nextConfig;
