import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AdminShell } from '@/components/AdminShell';

export const metadata: Metadata = {
  title: { default: 'Admin overview', template: '%s · Admin · HostX' },
  description: 'Platform overview for the HostX administrator.',
  robots: { index: false, follow: false },
};

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
