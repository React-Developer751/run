import type { Metadata } from 'next';
import type { ReactNode } from 'react';
import { AdminShell } from '@/components/AdminShell';
import { getSiteName } from '@/lib/brand';

export async function generateMetadata(): Promise<Metadata> {
  const name = await getSiteName();
  return {
    title: { default: 'Admin overview', template: `%s · Admin · ${name}` },
    description: `Platform overview for the ${name} administrator.`,
    robots: { index: false, follow: false },
  };
}

export default function AdminLayout({ children }: { children: ReactNode }) {
  return <AdminShell>{children}</AdminShell>;
}
