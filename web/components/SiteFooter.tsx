'use client';

import Link from 'next/link';
import { LEGAL_PAGES } from '@/lib/site';
import { useLegal, useSiteName } from './BrandProvider';
import { Logo } from './Logo';

export function SiteFooter() {
  const siteName = useSiteName();
  const legal = useLegal();
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <Logo />
        <nav className="footer-links" aria-label="Legal">
          <Link href="/pricing">Pricing</Link>
          {LEGAL_PAGES.map((p) => <Link key={p.href} href={p.href}>{p.label}</Link>)}
        </nav>
        <span>© {new Date().getFullYear()} {legal.company} · {siteName}</span>
      </div>
    </footer>
  );
}
