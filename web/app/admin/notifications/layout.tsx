import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Notifications',
  description: 'Failed deployments and storage alerts on this HostX server.',
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
