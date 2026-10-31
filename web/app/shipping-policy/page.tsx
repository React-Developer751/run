import type { Metadata } from 'next';
import { LegalPage } from '@/components/LegalPage';
import { pageMetadata } from '@/lib/site';
import { getLegal, getSiteName } from '@/lib/brand';

export async function generateMetadata(): Promise<Metadata> {
  const siteName = await getSiteName();
  return pageMetadata({
    title: 'Delivery Policy',
    description: `${siteName} is an online service: how and when it is delivered.`,
    path: '/shipping-policy',
    name: siteName,
  });
}

export default async function ShippingPolicyPage() {
  const legal = await getLegal();
  const siteName = await getSiteName();
  return (
    <LegalPage title="Shipping & Delivery Policy">
      <p>
        {siteName} is a software-as-a-service product delivered entirely online. Nothing is shipped physically and there are no shipping charges.
      </p>
      <ul>
        <li>The Free plan is available immediately after you create an account.</li>
        <li>Paid plans are bought by signed-in users from the Billing page.</li>
        <li>Paid through Razorpay: the plan is activated automatically as soon as Razorpay confirms your payment, usually within a minute.</li>
        <li>Paid by direct UPI: the plan is activated after we verify the reference number (UTR) you entered, usually within a few hours and at the latest within 1 business day. You get an email either way.</li>
        <li>Plan limits apply to your account and running applications right away once active.</li>
        <li>If a paid plan is not active within these times after a successful payment, write to {legal.email} with your account email and the Razorpay payment id or UPI reference number, and we will activate it or refund you.</li>
      </ul>
    </LegalPage>
  );
}
