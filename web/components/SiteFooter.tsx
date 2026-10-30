import Link from 'next/link';
import { LEGAL, LEGAL_PAGES, SITE_NAME } from '@/lib/site';
import { Logo } from './Logo';

export function SiteFooter() {
  return (
    <footer className="footer">
      <div className="container footer-inner">
        <Logo />
        <nav className="footer-links" aria-label="Legal">
          <Link href="/pricing">Pricing</Link>
          {LEGAL_PAGES.map((p) => <Link key={p.href} href={p.href}>{p.label}</Link>)}
        </nav>
        <span>© {new Date().getFullYear()} {LEGAL.company} · {SITE_NAME}</span>
      </div>
    </footer>
  );
}
