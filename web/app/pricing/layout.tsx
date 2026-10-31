import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { pageMetadata } from '@/lib/site';
import { getSiteName } from '@/lib/brand';

export async function generateMetadata(): Promise<Metadata> {
  const siteName = await getSiteName();
  return pageMetadata({
    title: 'Pricing',
    description: 'Simple monthly plans for hosting MERN apps: a free plan, always-on apps, MongoDB Atlas support, custom domains and GitHub auto-deploys. From ₹299/month.',
    path: '/pricing',
    name: siteName,
  });
}

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
