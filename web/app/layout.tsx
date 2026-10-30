import type { Metadata, Viewport } from 'next';
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

// Applies the saved theme (cookie) before first paint. Done in a tiny inline script instead of reading cookies() on the
// server, which would make every page dynamic and stop marketing/legal pages from being served statically.
const THEME_SCRIPT = `try{if(/(?:^|; )hostx_theme=dark/.test(document.cookie))document.documentElement.dataset.theme='dark'}catch(e){}`;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" data-scroll-behavior="smooth" data-theme="light" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_SCRIPT }} />
      </head>
      <body>
        <AuthProvider>{children}</AuthProvider>
      </body>
    </html>
  );
}
