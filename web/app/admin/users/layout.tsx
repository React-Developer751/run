import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Users',
  description: 'Manage HostX accounts, roles and limits.',
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
