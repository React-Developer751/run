import type { Metadata, Viewport } from 'next';
import { cookies } from 'next/headers';
import type { ReactNode } from 'react';
import { AuthProvider } from '@/lib/auth';
import { SITE_DESCRIPTION, SITE_NAME, SITE_TITLE, SITE_URL } from '@/lib/site';
import './globals.css';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: SITE_TITLE, template: `%s · ${SITE_NAME}` },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: ['deploy React app', 'deploy Node.js app', 'free hosting', 'Render alternative', 'self-hosted PaaS', 'MERN deployment', 'GitHub deploy'],
  authors: [{ name: SITE_NAME }],
  robots: { index: true, follow: true },
  openGraph: { type: 'website', siteName: SITE_NAME, locale: 'en_US' },
  twitter: { card: 'summary_large_image' },
};

export const viewport: Viewport = {
  themeColor: [
    { media: '(prefers-color-scheme: light)', color: '#f4f2ff' },
    { media: '(prefers-color-scheme: dark)', color: '#100d2e' },
  ],
};

// The saved theme lives in a cookie, so the server renders the right one on first paint: no script, no flash.
export default async function RootLayout({ children }: { children: ReactNode }) {
  const saved = (await cookies()).get('hostx_theme')?.value;
  const theme = saved === 'dark' ? 'dark' : 'light';
  return (
    <html lang="en" data-scroll-behavior="smooth" data-theme={theme}>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
