import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/LegalPage';
import { LEGAL, pageMetadata } from '@/lib/site';
import { getSiteName } from '@/lib/brand';

export async function generateMetadata(): Promise<Metadata> {
  const siteName = await getSiteName();
  return pageMetadata({
    title: 'Terms of Service',
    description: `The terms that apply when you use ${siteName} to deploy and host applications.`,
    path: '/terms',
    name: siteName,
  });
}

export default async function TermsPage() {
  const siteName = await getSiteName();
  return (
    <LegalPage title="Terms of Service">
      <p>
        These Terms govern your use of {siteName} (the &quot;Service&quot;), a platform that builds and hosts web applications from
        GitHub repositories. By creating an account or using the Service you agree to these Terms, our{' '}
        <Link href="/privacy">Privacy Policy</Link> and our <Link href="/acceptable-use">Acceptable Use Policy</Link>. If you use the Service
        for an organisation, you confirm you may bind it to these Terms.
      </p>

      <h2>1. Eligibility and your account</h2>
      <ul>
        <li>You must be at least 18 years old, or use the Service with the consent of a parent or guardian.</li>
        <li>Give accurate information and keep your password safe. You are responsible for all activity under your account.</li>
        <li>Tell us promptly at {LEGAL.email} if you believe your account has been compromised.</li>
      </ul>

      <h2>2. The Service</h2>
      <p>
        {siteName} clones the repositories you choose, builds them and runs them in isolated containers, and may provide add-ons such as
        custom domains. Databases (for example MongoDB Atlas) are provided by third parties under their own terms; we do not host them. Features, limits and prices of each plan are shown on the{' '}
        <Link href="/pricing">Pricing</Link> page and may change; we will give reasonable notice of changes that reduce a paid plan.
      </p>
      <p>
        Applications stay running while they are used. On the Free plan, a web service with no visits for 7 days is paused (nothing is
        deleted; you resume it from the dashboard), and one with no visits for 90 days is archived: its build is removed to free space, while
        its settings, environment variables, domains and address are kept so it can be redeployed from your repository. Static sites and paid plans are never
        paused or archived. We may apply resource limits (memory, CPU, build time, storage, bandwidth) to keep the platform fair and stable.
      </p>

      <h2>3. Your content and code</h2>
      <ul>
        <li>
          You keep all rights to the code, data and content you deploy (&quot;Your Content&quot;). You grant us a limited licence to copy,
          build, store, run and serve Your Content only as needed to provide the Service to you.
        </li>
        <li>You are responsible for Your Content, including its legality, the licences of its dependencies, and the data it collects from your own users.</li>
        <li>
          If your application processes personal data of others, you are the data fiduciary/controller for that data and must give your users
          your own privacy notice. We process it on your behalf only to host your application.
        </li>
        <li>You are responsible for keeping your own backups of important data, including databases.</li>
      </ul>

      <h2>4. Acceptable use</h2>
      <p>
        You must follow the <Link href="/acceptable-use">Acceptable Use Policy</Link>. We may suspend or remove applications or accounts that
        break it, harm the platform or other users, or are reported to us by a competent authority, where possible after notifying you.
      </p>

      <h2>5. Payments</h2>
      <ul>
        <li>Paid plans are billed monthly in advance in Indian Rupees through our payment partner Razorpay. Taxes are added as applicable.</li>
        <li>Subscriptions renew automatically until cancelled. You can cancel at any time from the Billing page; see the <Link href="/refund-policy">Cancellation &amp; Refund Policy</Link>.</li>
        <li>If a renewal payment fails and is not resolved, your account moves to the Free plan and its limits apply.</li>
      </ul>

      <h2>6. Availability and changes</h2>
      <p>
        We work to keep the Service available but do not guarantee uninterrupted or error-free operation, and do not provide a service-level
        agreement unless agreed in writing. We may perform maintenance, and may change or discontinue features with reasonable notice.
      </p>

      <h2>7. Termination</h2>
      <p>
        You may delete your account at any time from the Account page; this permanently deletes your applications and data on {siteName}. We may
        suspend or terminate accounts for breach of these Terms, non-payment, or legal requirements. Where we discontinue the Service as a
        whole we will give at least 30 days&apos; notice so you can export your data.
      </p>

      <h2>8. Disclaimers and liability</h2>
      <p>
        The Service is provided &quot;as is&quot;. To the extent permitted by law, we are not liable for indirect, incidental or
        consequential losses, loss of profits, data or goodwill. Our total liability for any claim relating to the Service is limited to the
        amount you paid us in the three months before the claim. Nothing in these Terms limits liability that cannot be limited by law.
      </p>

      <h2>9. Indemnity</h2>
      <p>You will compensate us for claims and costs arising from Your Content or your breach of these Terms or the law.</p>

      <h2>10. Governing law and disputes</h2>
      <p>
        These Terms are governed by the laws of India. Courts at {LEGAL.jurisdiction} have exclusive jurisdiction. Please contact us first at{' '}
        {LEGAL.email}; most issues can be solved quickly.
      </p>

      <h2>11. Changes to these Terms</h2>
      <p>We may update these Terms. We will notify you by email or in the dashboard of material changes; continued use after they take effect means you accept them.</p>

      <h2>12. Contact</h2>
      <p>
        {LEGAL.company}, {LEGAL.address}. Email {LEGAL.email}. Grievances: see <Link href="/contact">Contact</Link>.
      </p>
    </LegalPage>
  );
}
