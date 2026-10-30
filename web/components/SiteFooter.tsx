'use client';

import Link from 'next/link';
import { LEGAL, LEGAL_PAGES } from '@/lib/site';
import { useSiteName } from './BrandProvider';
import { Logo } from './Logo';

export function SiteFooter() {
  const siteName = useSiteName();
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <Logo />
        <nav className="footer-links" aria-label="Legal">
          <Link href="/pricing">Pricing</Link>
          {LEGAL_PAGES.map((p) => <Link key={p.href} href={p.href}>{p.label}</Link>)}
        </nav>
        <span>© {new Date().getFullYear()} {LEGAL.company} · {siteName}</span>
      </div>
    </footer>
  );
}
