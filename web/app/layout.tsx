import type { Metadata, Viewport } from 'next';
import type { ReactNode } from 'react';
import { BrandProvider } from '@/components/BrandProvider';
import { AuthProvider } from '@/lib/auth';
import { getBusiness, getSiteName } from '@/lib/brand';
import { SITE_DESCRIPTION, SITE_URL, siteTitle } from '@/lib/site';
import './globals.css';

// The platform name comes from Admin → Settings (cached 60 s, refreshed at once when the admin renames it).
export async function generateMetadata(): Promise<Metadata> {
  const name = await getSiteName();
  return {
    metadataBase: new URL(SITE_URL),
    title: { default: siteTitle(name), template: `%s · ${name}` },
    description: SITE_DESCRIPTION,
    applicationName: name,
    keywords: ['deploy React app', 'deploy Node.js app', 'free hosting', 'Render alternative', 'self-hosted PaaS', 'MERN deployment', 'GitHub deploy'],
    authors: [{ name }],
    robots: { index: true, follow: true },
    openGraph: { type: 'website', siteName: name, locale: 'en_US' },
    twitter: { card: 'summary_large_image' },
  };
}

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f2ff' },
    { media: '(prefers-color-scheme: dark)', color: '#100d2e' },
  ],
};

// Applies the saved theme (cookie) before first paint. Done in a tiny inline script instead of reading cookies() on the
// server, which would make every page dynamic and stop marketing/legal pages from being served statically.
const THEME_SCRIPT = `try{if(/(?:^|; )hostx_theme=dark/.test(document.cookie))document.documentElement.dataset.theme='dark'}catch(e){}`;

export default async function RootLayout({ children }: { children: ReactNode }) {
  const [name, business] = await Promise.all([getSiteName(), getBusiness()]);
  return (
    <html lang="en" data-scroll-behavior="smooth" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <BrandProvider initial={name} business={business}>
          <AuthProvider>{children}</AuthProvider>
        </BrandProvider>
      </body>
    </html>
  );
}
