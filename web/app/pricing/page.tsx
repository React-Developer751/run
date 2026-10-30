'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Nav } from '@/components/Nav';
import { PlanCards } from '@/components/PlanCards';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Plan } from '@/lib/types';

export default function PricingPage() {
  const { user } = useAuth();
  const [plans, setPlans] = useState<Plan[] | null>(null);
  const [error, setError] = useState('');

  useEffect(() => {
    api.billing.plans().then((r) => setPlans(r.plans)).catch((e: Error) => setError(e.message));
  }, []);

  return (
    <>
      <Nav variant="site" />
      <main className="container page">
        <div className="section-head" style={{ marginBottom: 40 }}>
          <span className="tag">Pricing</span>
          <h2>Start free. <span className="serif grad-text">Upgrade when it matters.</span></h2>
          <p>Pay monthly with UPI, cards or netbanking. Cancel any time — you keep your plan until the end of the paid month.</p>
        </div>
        {error && <div className="error-box">{error}</div>}
        {!plans && !error && <div className="center-screen" style={{ minHeight: 200 }}><span className="spinner" /></div>}
        {plans && (
          <PlanCards
            plans={plans.filter((p) => p.available)}
            action={(p) => (
              <Link className={`btn ${p.id === 'starter' ? 'btn-primary' : ''}`} style={{ width: '100%', justifyContent: 'center' }} href={user ? (p.id === 'free' ? '/dashboard' : '/billing') : '/register'}>
                {p.id === 'free' ? 'Start for free' : `Get ${p.name}`}
              </Link>
            )}
          />
        )}
        <p className="muted" style={{ textAlign: 'center', marginTop: 28, fontSize: 13.5 }}>Prices in INR, taxes as applicable. Payments are processed by Razorpay.</p>
      </main>
    </>
  );
}
