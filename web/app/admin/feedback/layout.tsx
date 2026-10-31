import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Feedback',
  description: 'User ratings and what to show on the landing page.',
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
