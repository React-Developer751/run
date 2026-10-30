import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Pricing',
  description: 'Simple monthly plans for hosting MERN apps: free tier, always-on services, MongoDB databases and GitHub auto-deploys.',
  alternates: { canonical: '/pricing' },
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
