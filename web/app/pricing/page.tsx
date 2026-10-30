import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { PlanCards } from '@/components/PlanCards';
import { SiteFooter } from '@/components/SiteFooter';
import { SITE_NAME, SITE_URL } from '@/lib/site';
import type { Plan } from '@/lib/types';

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';

// Rendered on the server (refreshed every 5 minutes) so the plans and prices are in the HTML search engines read.
export const revalidate = 300;

async function loadPlans(): Promise<Plan[] | null> {
  try {
    const r = await fetch(`${API}/api/billing/plans`, { next: { revalidate: 300 } });
    if (!r.ok) return null;
    return ((await r.json()) as { plans: Plan[] }).plans.filter((p) => p.available);
  } catch {
    return null;
  }
}

export default async function PricingPage() {
  const plans = await loadPlans();
  const jsonLd = plans && {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: `${SITE_NAME} hosting`,
    description: 'Hosting for MERN apps: GitHub deploys, MongoDB Atlas support, HTTPS and custom domains.',
    brand: { '@type': 'Brand', name: SITE_NAME },
    offers: plans.map((p) => ({ '@type': 'Offer', name: p.name, price: String(p.priceInr), priceCurrency: 'INR', url: `${SITE_URL}/pricing` })),
  };

  return (
    <>
      <Nav variant="site" />
      <main className="container page">
        <div className="section-head" style={{ marginBottom: 40 }}>
          <span className="tag">Pricing</span>
          <h1 style={{ fontSize: 'clamp(30px, 4.2vw, 48px)' }}>Start free. <span className="serif grad-text">Upgrade when it matters.</span></h1>
          <p>Every plan keeps your apps running 24/7 — nothing ever sleeps. Pay monthly with UPI, cards or netbanking and cancel any time.</p>
        </div>
        {plans ? (
          <PlanCards
            plans={plans}
            action={(p) => (
              <Link className={`btn ${p.id === 'starter' ? 'btn-primary' : ''}`} style={{ width: '100%', justifyContent: 'center' }} href={p.id === 'free' ? '/register' : '/billing'}>
                {p.id === 'free' ? 'Start for free' : `Get ${p.name}`}
              </Link>
            )}
          />
        ) : (
          <div className="notice-box">Plans could not be loaded right now. <Link href="/register">Create a free account</Link> to get started.</div>
        )}
        <p className="muted" style={{ textAlign: 'center', marginTop: 28, fontSize: 13.5 }}>
          Prices in INR, taxes as applicable. Payments are processed by Razorpay. See our <Link href="/refund-policy">Cancellation &amp; Refund Policy</Link>.
        </p>
      </main>
      <SiteFooter />
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />}
    </>
  );
}
