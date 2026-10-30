import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalPage } from '@/components/LegalPage';
import { LEGAL, SITE_NAME, pageMetadata } from '@/lib/site';

export const metadata: Metadata = pageMetadata({
  title: 'Privacy Policy',
  description: `What personal data ${SITE_NAME} collects, why, how long it is kept and how to exercise your rights.`,
  path: '/privacy',
});

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy">
      <p>
        This policy explains how {LEGAL.company} (&quot;we&quot;) processes your personal data when you use {SITE_NAME}, in line with the
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
          <tr><td>Data in managed databases and custom domain names</td><td>Provide those add-ons; we access database contents only when needed for support you request or to comply with law</td></tr>
          <tr><td>Plan and subscription status, Razorpay subscription id</td><td>Billing. Card, UPI and bank details are collected and processed by Razorpay, not stored by us</td></tr>
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
        <li><b>Razorpay</b>, for payments and invoices.</li>
        <li><b>GitHub</b>, when you connect it, to access the repositories you select.</li>
        <li><b>Our hosting and email providers</b>, which store data or send emails on our behalf under confidentiality obligations.</li>
        <li><b>Let&apos;s Encrypt</b>, which receives your custom domain names to issue HTTPS certificates.</li>
        <li><b>Authorities</b>, when required by law or a valid legal order.</li>
      </ul>

      <h2>4. How long we keep it</h2>
      <ul>
        <li>Account data: while your account exists. When you delete your account we delete your applications, databases, logs, sessions and profile right away; copies in backups are overwritten within 30 days.</li>
        <li>Build logs: the latest 15 deployments per project. Expired sessions and email links are removed automatically.</li>
        <li>Billing records: as long as tax and accounting law requires (generally up to 8 years), held by us and Razorpay.</li>
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
        <li>access and correct your data, and get a summary of the data we process about you, by writing to {LEGAL.email};</li>
        <li>delete your account and all its data yourself on the Account page, or ask us to;</li>
        <li>withdraw consent (by deleting your account) and nominate another person to exercise your rights in case of death or incapacity;</li>
        <li>raise a grievance with our Grievance Officer (below), and if unresolved, with the Data Protection Board of India.</li>
      </ul>
      <p>We reply within 30 days.</p>

      <h2>7. Data in your own applications</h2>
      <p>
        If you host an application that collects personal data of your users, you decide how that data is used and you must provide your own
        privacy notice to them. We process it only to host your application, as described in our <Link href="/terms">Terms</Link>.
      </p>

      <h2>8. Children</h2>
      <p>The Service is not directed at children under 18, and we do not knowingly collect their data without verifiable parental consent.</p>

      <h2>9. Grievance Officer</h2>
      <p>
        {LEGAL.grievanceOfficer}, {LEGAL.company}, {LEGAL.address}. Email: {LEGAL.grievanceEmail}. We acknowledge complaints within 24 hours and
        resolve them within 15 days.
      </p>

      <h2>10. Changes</h2>
      <p>We will post updates here and notify you by email or in the dashboard of material changes.</p>
    </LegalPage>
  );
}
