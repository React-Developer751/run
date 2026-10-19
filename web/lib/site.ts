/** Public origin of the dashboard, used for canonical URLs, sitemap and social cards. Set NEXT_PUBLIC_SITE_URL in production. */
export const SITE_URL = (process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000').replace(/\/+$/, '');
export const SITE_NAME = 'HostX';
export const SITE_TITLE = 'HostX — Deploy React & Node.js apps from a GitHub link';
export const SITE_DESCRIPTION =
  'HostX is a free, self-hosted mini Render. Paste a GitHub repo, pick a folder, and get your React frontend and Node.js backend live on their own subdomain with real build logs and auto-deploys.';
