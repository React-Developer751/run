import type { Metadata } from 'next';
import { LegalPage } from '@/components/LegalPage';
import { LEGAL, SITE_NAME } from '@/lib/site';

export const metadata: Metadata = {
  title: 'Acceptable Use Policy',
  description: `What you may and may not host on ${SITE_NAME}, and how to report abuse.`,
  alternates: { canonical: '/acceptable-use' },
};

export default function AcceptableUsePage() {
  return (
    <LegalPage title="Acceptable Use Policy">
      <p>
        {SITE_NAME} is shared infrastructure. To keep it safe and fast for everyone, you may not use it to host, build or run anything that:
      </p>
      <ul>
        <li>is illegal in India or where you operate, or infringes copyright, trademarks or other rights;</li>
        <li>is phishing, impersonates another person, brand or organisation, or collects credentials or payment details deceptively;</li>
        <li>distributes malware, ransomware, spyware or exploit kits, or operates botnets or command-and-control servers;</li>
        <li>attacks or scans other systems: denial-of-service, port scanning, brute-forcing, vulnerability scanning without permission;</li>
        <li>sends spam or bulk unsolicited messages, or runs open proxies, open mail relays or anonymising VPN exits;</li>
        <li>mines cryptocurrency, or otherwise uses resources in a way unrelated to serving a web application;</li>
        <li>contains child sexual abuse material, non-consensual intimate imagery, or content that promotes terrorism or violence;</li>
        <li>is content prohibited under Rule 3 of the IT (Intermediary Guidelines and Digital Media Ethics Code) Rules, 2021;</li>
        <li>tries to break out of the container, reach other users&apos; applications or the host, bypass plan limits, or abuse free plans with multiple accounts.</li>
      </ul>

      <h2>Enforcement</h2>
      <p>
        We may stop, suspend or delete applications and accounts that break this policy, in serious cases without prior notice, and report
        illegal activity to the authorities. Where reasonable we will tell you what was wrong and give you a chance to fix it.
      </p>

      <h2>Report abuse</h2>
      <p>
        Send the URL and details to <b>{LEGAL.abuseEmail}</b>. Lawful orders from government agencies and courts are handled through our
        Grievance Officer (see Contact). We act on valid reports as quickly as possible and within the time limits set by law.
      </p>
    </LegalPage>
  );
}
