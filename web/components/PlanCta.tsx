'use client';

import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import type { Plan } from '@/lib/types';

/**
 * Plan button on public pages. Everyone sees every plan; buying needs an account: guests go to sign-up first and come
 * back to Billing, signed-in users go straight to Billing.
 */
export function PlanCta({ plan, featured }: { plan: Plan; featured?: boolean }) {
  const { user, loading } = useAuth();
  const free = plan.priceInr === 0;
  const href = user ? (free ? '/dashboard' : '/billing') : free ? '/register' : `/register?next=${encodeURIComponent('/billing')}`;
  const label = user ? (free ? 'Go to dashboard' : `Upgrade to ${plan.name}`) : free ? 'Start for free' : `Get ${plan.name}`;
  return (
    <div className="stack" style={{ gap: 6, width: '100%' }}>
      <Link className={`btn ${featured ? 'btn-primary' : ''}`} style={{ width: '100%', justifyContent: 'center', visibility: loading ? 'hidden' : undefined }} href={href}>
        {label}
      </Link>
      {!user && !loading && !free && <small className="dim" style={{ textAlign: 'center' }}>Free account needed to buy · <Link href={`/login?next=${encodeURIComponent('/billing')}`}>sign in</Link></small>}
    </div>
  );
}
