import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Projects',
  description: 'All projects deployed on this server.',
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
