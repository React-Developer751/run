import type { Metadata } from 'next';
import { LegalPage } from '@/components/LegalPage';
import { pageMetadata } from '@/lib/site';
import { getLegal, getSiteName } from '@/lib/brand';

export async function generateMetadata(): Promise<Metadata> {
  const siteName = await getSiteName();
  return pageMetadata({
    title: 'Cancellation & Refund Policy',
    description: `How to cancel a ${siteName} subscription and when refunds are given.`,
    path: '/refund-policy',
    name: siteName,
  });
}

export default async function RefundPolicyPage() {
  const legal = await getLegal();
  return (
    <LegalPage title="Cancellation & Refund Policy">
      <h2>Cancelling</h2>
      <ul>
        <li>Paid plans are monthly subscriptions. Cancel any time from <b>Billing → Cancel subscription</b> in the dashboard; no email or call is needed.</li>
        <li>After cancelling you keep your plan until the end of the period you already paid for. Then your account moves to the Free plan; nothing is charged again.</li>
        <li>Switching between paid plans takes effect immediately; Razorpay adjusts the amount for the remaining period.</li>
        <li>Deleting your account cancels the subscription immediately.</li>
        <li>
          Plans paid by direct UPI (where offered) cover one month from activation and do not renew automatically, so there is nothing to cancel: if
          you do not pay again, your account moves to the Free plan when the month ends. We email you a few days before.
        </li>
      </ul>

      <h2>Refunds</h2>
      <ul>
        <li>Because the Service is delivered instantly and you can use the Free plan before paying, payments for a started billing period are generally non-refundable, including for partial months.</li>
        <li>We refund in full: duplicate charges, charges after a cancellation that was confirmed in the dashboard, and charges caused by a technical error on our side.</li>
        <li>If the Service was unavailable for an extended period in a month due to our fault, write to us and we will offer a pro-rated credit or refund.</li>
        <li>Request a refund within 7 days of the charge at {legal.email} with your account email and the Razorpay payment id or UPI reference number (UTR).</li>
        <li>Approved refunds are issued to the original payment method within 5–7 business days (through Razorpay, or back to the paying UPI account for direct UPI payments); your bank may take a few more days to show it.</li>
        <li>A direct UPI payment we could not verify (for example a wrong UTR) does not activate a plan; if money left your account, contact us with a screenshot and we will verify it again or refund it.</li>
      </ul>
    </LegalPage>
  );
}
