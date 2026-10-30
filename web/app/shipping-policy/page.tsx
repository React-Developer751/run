import type { Metadata } from 'next';
import { LegalPage } from '@/components/LegalPage';
import { LEGAL, SITE_NAME, pageMetadata } from '@/lib/site';

export const metadata: Metadata = pageMetadata({
  title: 'Delivery Policy',
  description: `${SITE_NAME} is an online service: how and when it is delivered.`,
  path: '/shipping-policy',
});

export default function ShippingPolicyPage() {
  return (
    <LegalPage title="Shipping & Delivery Policy">
      <p>
        {SITE_NAME} is a software-as-a-service product delivered entirely online. Nothing is shipped physically and there are no shipping charges.
      </p>
      <ul>
        <li>The Free plan is available immediately after you create an account.</li>
        <li>A paid plan is activated automatically as soon as Razorpay confirms your payment, usually within a minute. Its limits apply to your account and running applications right away.</li>
        <li>If a paid plan is not active within 30 minutes of a successful payment, write to {LEGAL.email} with your account email and payment id and we will fix it or refund you.</li>
      </ul>
    </LegalPage>
  );
}
