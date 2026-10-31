import type { Metadata } from 'next';
import type { ReactNode } from 'react';

export const metadata: Metadata = {
  title: 'Payments',
  description: 'Direct UPI payments to verify.',
};

export default function Layout({ children }: { children: ReactNode }) {
  return children;
}
