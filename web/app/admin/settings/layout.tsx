import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Settings',
  description: 'Platform settings for this HostX server.',
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
