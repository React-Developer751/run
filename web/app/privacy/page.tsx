import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/LegalPage';
import { pageMetadata } from '@/lib/site';
import { getLegal, getSiteName } from '@/lib/brand';

export async function generateMetadata(): Promise<Metadata> {
  const siteName = await getSiteName();
  return pageMetadata({
    title: 'Privacy Policy',
    description: `What personal data ${siteName} collects, why, how long it is kept and how to exercise your rights.`,
    path: '/privacy',
    name: siteName,
  });
}

export default async function PrivacyPage() {
  const legal = await getLegal();
  const siteName = await getSiteName();
  return (
    <LegalPage title="Privacy Policy">
      <p>
        This policy explains how {legal.company} (&quot;we&quot;) processes your personal data when you use {siteName}, in line with the
        Digital Personal Data Protection Act, 2023 and the Information Technology Act, 2000 and its rules. We collect only what we need to run
        the Service and we do not sell personal data.
      </p>

      <h2>1. What we collect</h2>
      <table>
        <thead><tr><th>Data</th><th>Why</th></tr></thead>
        <tbody>
          <tr><td>Name, email address, password (stored only as a salted scrypt hash)</td><td>Create and secure your account, send account emails</td></tr>
          <tr><td>Session records: IP address, browser user agent, sign-in times</td><td>Keep you signed in, detect stolen sessions, prevent abuse</td></tr>
          <tr><td>GitHub username and the GitHub App installations you connect</td><td>List and clone the repositories you choose (we never store your GitHub password or personal token)</td></tr>
          <tr><td>Repository code, build logs, runtime logs, environment variables (encrypted at rest)</td><td>Build, run and troubleshoot your applications</td></tr>
          <tr><td>Custom domain names</td><td>Route your domain to your application and obtain its HTTPS certificate</td></tr>
          <tr><td>Plan and subscription status, Razorpay subscription id</td><td>Billing. Card, UPI and bank details for Razorpay payments are collected and processed by Razorpay, not stored by us</td></tr>
          <tr><td>For direct UPI payments: amount, plan, date and the UPI reference number (UTR) you enter</td><td>Matching your payment with our bank statement and activating your plan. We never see or store your UPI PIN or bank account details</td></tr>
          <tr><td>Support requests and their replies; feedback ratings and comments</td><td>Answering you and improving the Service. Feedback is shown on our website only if you ticked the box allowing it, with your first name and last initial</td></tr>
          <tr><td>Security and audit logs of administrative actions</td><td>Security, fraud prevention, legal obligations</td></tr>
        </tbody>
      </table>

      <h2>2. Cookies and similar technology</h2>
      <p>
        We use only strictly necessary cookies: two HttpOnly sign-in cookies (a 15-minute access token and a refresh token). Your colour theme
        choice is kept in your browser&apos;s local storage. We do not use advertising or third-party tracking cookies.
      </p>

      <h2>3. Who we share data with</h2>
      <ul>
        <li><b>Razorpay</b>, for payments and invoices, when you pay through it.</li>
        <li><b>Your bank / UPI app</b> processes a direct UPI payment between you and us; we only receive the amount and reference number.</li>
        <li><b>GitHub</b>, when you connect it, to access the repositories you select.</li>
        <li><b>Our hosting and email providers</b>, which store data or send emails on our behalf under confidentiality obligations.</li>
        <li><b>Let&apos;s Encrypt</b>, which receives your custom domain names to issue HTTPS certificates.</li>
        <li><b>Authorities</b>, when required by law or a valid legal order.</li>
      </ul>

      <h2>4. How long we keep it</h2>
      <ul>
        <li>Account data: while your account exists. When you delete your account we immediately and permanently delete your profile, applications, environment variables, custom domains, logs, sessions, support requests and feedback (no &quot;soft delete&quot;); copies in backups are overwritten within 30 days. We email you a confirmation.</li>
        <li>Build logs: the latest 15 deployments per project. Expired sessions and email links are removed automatically.</li>
        <li>Billing records (payments, UPI reference numbers, invoices) and the security audit log: kept after account deletion for as long as tax, accounting and security law requires (generally up to 8 years), by us and, for card payments, Razorpay.</li>
      </ul>

      <h2>5. Security</h2>
      <p>
        Passwords are hashed, environment variables, database passwords and webhook secrets are encrypted (AES-256-GCM), traffic uses HTTPS,
        and each application runs in its own isolated container and network. No system is perfectly secure; we will notify you and the Data
        Protection Board of India of a personal data breach as the law requires.
      </p>

      <h2>6. Your rights</h2>
      <p>You can:</p>
      <ul>
        <li>access and correct your data, and get a summary of the data we process about you, by writing to {legal.email};</li>
        <li>delete your account and all its data yourself on the Account page, or ask us to;</li>
        <li>withdraw consent (by deleting your account) and nominate another person to exercise your rights in case of death or incapacity;</li>
        <li>raise a grievance with our Grievance Officer (below), and if unresolved, with the Data Protection Board of India.</li>
      </ul>
      <p>We reply within 30 days.</p>

      <h2>7. Data in your own applications</h2>
      <p>
        We do not host your application&apos;s database. If you connect a service such as MongoDB Atlas, its provider stores that data
        under its own terms; we only pass the connection string you saved (encrypted at rest) to your application.
      </p>
      <p>
        If you host an application that collects personal data of your users, you decide how that data is used and you must provide your own
        privacy notice to them. We process it only to host your application, as described in our <Link href="/terms">Terms</Link>.
      </p>

      <h2>8. Children</h2>
      <p>The Service is not directed at children under 18, and we do not knowingly collect their data without verifiable parental consent.</p>

      <h2>9. Grievance Officer</h2>
      <p>
        {legal.grievanceOfficer}, {legal.company}, {legal.address}. Email: {legal.grievanceEmail}. We acknowledge complaints within 24 hours and
        resolve them within 15 days.
      </p>

      <h2>10. Changes</h2>
      <p>We will post updates here and notify you by email or in the dashboard of material changes.</p>
    </LegalPage>
  );
}
