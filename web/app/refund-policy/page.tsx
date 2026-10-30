import type { Metadata } from 'next';
import { LegalPage } from '@/components/LegalPage';
import { LEGAL, SITE_NAME, pageMetadata } from '@/lib/site';

export const metadata: Metadata = pageMetadata({
  title: 'Cancellation & Refund Policy',
  description: `How to cancel a ${SITE_NAME} subscription and when refunds are given.`,
  path: '/refund-policy',
});

export default function RefundPolicyPage() {
  return (
    <LegalPage title="Cancellation & Refund Policy">
      <h2>Cancelling</h2>
      <ul>
        <li>Paid plans are monthly subscriptions. Cancel any time from <b>Billing → Cancel subscription</b> in the dashboard; no email or call is needed.</li>
        <li>After cancelling you keep your plan until the end of the period you already paid for. Then your account moves to the Free plan; nothing is charged again.</li>
        <li>Switching between paid plans takes effect immediately; Razorpay adjusts the amount for the remaining period.</li>
        <li>Deleting your account cancels the subscription immediately.</li>
      </ul>

      <h2>Refunds</h2>
      <ul>
        <li>Because the Service is delivered instantly and you can use the Free plan before paying, payments for a started billing period are generally non-refundable, including for partial months.</li>
        <li>We refund in full: duplicate charges, charges after a cancellation that was confirmed in the dashboard, and charges caused by a technical error on our side.</li>
        <li>If the Service was unavailable for an extended period in a month due to our fault, write to us and we will offer a pro-rated credit or refund.</li>
        <li>Request a refund within 7 days of the charge at {LEGAL.email} with your account email and the Razorpay payment id.</li>
        <li>Approved refunds are issued to the original payment method through Razorpay within 5–7 business days; your bank may take a few more days to show it.</li>
      </ul>
    </LegalPage>
  );
}
