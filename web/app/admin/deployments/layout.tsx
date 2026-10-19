import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Deployments',
  description: 'Latest deployments across the HostX platform.',
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
