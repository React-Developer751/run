import type { Metadata } from 'next';
import { LegalPage } from '@/components/LegalPage';
import { LEGAL, SITE_NAME, pageMetadata } from '@/lib/site';

export const metadata: Metadata = pageMetadata({
  title: 'Contact us',
  description: `How to reach the ${SITE_NAME} team for support, billing, abuse reports and grievances.`,
  path: '/contact',
});

export default function ContactPage() {
  return (
    <LegalPage title="Contact us">
      <table>
        <tbody>
          <tr><th>Business</th><td>{LEGAL.company}</td></tr>
          <tr><th>Address</th><td>{LEGAL.address}</td></tr>
          <tr><th>Support &amp; billing</th><td><a href={`mailto:${LEGAL.email}`}>{LEGAL.email}</a></td></tr>
          <tr><th>Phone</th><td>{LEGAL.phone} (Mon–Fri, 10:00–18:00 IST)</td></tr>
          <tr><th>Report abuse</th><td><a href={`mailto:${LEGAL.abuseEmail}`}>{LEGAL.abuseEmail}</a></td></tr>
        </tbody>
      </table>
      <p>We reply to support emails within 2 business days.</p>
      <p>Have an account? The fastest way is <a href="/support">Support</a> in your dashboard: mark a request as <b>Emergency</b> when a live app is down and every administrator is alerted at once.</p>

      <h2>Grievance Officer</h2>
      <p>
        Under the Information Technology Act, 2000, its rules, and the Digital Personal Data Protection Act, 2023:
      </p>
      <table>
        <tbody>
          <tr><th>Name</th><td>{LEGAL.grievanceOfficer}</td></tr>
          <tr><th>Email</th><td><a href={`mailto:${LEGAL.grievanceEmail}`}>{LEGAL.grievanceEmail}</a></td></tr>
          <tr><th>Address</th><td>{LEGAL.address}</td></tr>
        </tbody>
      </table>
      <p>Complaints are acknowledged within 24 hours and resolved within 15 days.</p>
    </LegalPage>
  );
}
