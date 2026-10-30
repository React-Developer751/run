import path from 'node:path';
import { fileURLToPath } from 'node:url';

const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
// Cloudflare Turnstile (CAPTCHA) is only allowed when a site key is configured.
const turnstile = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY ? ' https://challenges.cloudflare.com' : '';

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
      "script-src 'self' 'unsafe-inline'" + turnstile + (process.env.NODE_ENV === 'production' ? '' : " 'unsafe-eval'"),
      `frame-src 'self'${turnstile}`,
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
