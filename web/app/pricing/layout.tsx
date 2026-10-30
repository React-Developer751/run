import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { pageMetadata } from '@/lib/site';

export const metadata: Metadata = pageMetadata({
  title: 'Pricing',
  description: 'Simple monthly plans for hosting MERN apps: a free plan, always-on apps, MongoDB Atlas support, custom domains and GitHub auto-deploys. From ₹299/month.',
  path: '/pricing',
});

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
