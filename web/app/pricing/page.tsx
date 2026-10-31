import Link from 'next/link';
import { Nav } from '@/components/Nav';
import { PlanCards } from '@/components/PlanCards';
import { PlanCta } from '@/components/PlanCta';
import { SiteFooter } from '@/components/SiteFooter';
import { getPlansInfo, getSiteName, paymentWording } from '@/lib/brand';
import { SITE_URL } from '@/lib/site';
import type { Plan } from '@/lib/types';

// Rendered on the server so the plans and prices are in the HTML search engines read; refreshed when the admin changes them.

export default async function PricingPage() {
  const [info, siteName] = await Promise.all([getPlansInfo(), getSiteName()]);
  const plans = info?.plans ?? null;
  const paying = info ? paymentWording(info.methods) : null;
  const jsonLd = plans && {
    '@context': 'https://schema.org',
    '@type': 'Product',
    name: `${siteName} hosting`,
    description: 'Hosting for MERN apps: GitHub deploys, MongoDB Atlas support, HTTPS and custom domains.',
    brand: { '@type': 'Brand', name: siteName },
    offers: plans.map((p) => ({ '@type': 'Offer', name: p.name, price: String(p.priceInr), priceCurrency: 'INR', url: `${SITE_URL}/pricing` })),
  };

  return (
    <>
      <Nav variant="site" />
      <main className="container page">
        <div className="section-head" style={{ marginBottom: 40 }}>
          <span className="tag">Pricing</span>
          <h1 style={{ fontSize: 'clamp(30px, 4.2vw, 48px)' }}>Start free. <span className="serif grad-text">Upgrade when it matters.</span></h1>
          <p>
            No 15-minute sleep and no cold starts on any plan. Free web services pause only after 7 days with zero visitors (one-click resume); static sites
            and paid apps never pause.{paying ? ` Pay with ${paying}.` : ''}
          </p>
        </div>
        {plans ? (
          <PlanCards
            plans={plans}
            action={(p) => <PlanCta plan={p} featured={p.id === 'starter'} />}
          />
        ) : (
          <div className="notice-box">Plans could not be loaded right now. <Link href="/register">Create a free account</Link> to get started.</div>
        )}
        <p className="muted" style={{ textAlign: 'center', marginTop: 28, fontSize: 13.5 }}>
          Prices in INR, taxes as applicable. Everyone can compare plans; buying one needs a free account.{' '}
          {info?.methods.razorpay ? 'Card and AutoPay payments are processed by Razorpay and renew monthly until cancelled. ' : ''}
          {info?.methods.upi ? 'Direct UPI payments cover one month, are verified by our team and do not renew automatically. ' : ''}
          See our <Link href="/refund-policy">Cancellation &amp; Refund Policy</Link>.
        </p>
      </main>
      <SiteFooter />
      {jsonLd && <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }} />}
    </>
  );
}
