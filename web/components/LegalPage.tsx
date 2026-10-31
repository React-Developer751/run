import Link from 'next/link';
import type { ReactNode } from 'react';
import { getLegal, getSiteName } from '@/lib/brand';
import { LEGAL_PAGES } from '@/lib/site';
import { Nav } from './Nav';
import { SiteFooter } from './SiteFooter';

/** Shared shell for the legal pages: readable prose column with links to the sibling policies. */
export async function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  const [siteName, legal] = await Promise.all([getSiteName(), getLegal()]);
  return (
    <>
      <Nav variant="site" />
      <main className="container page">
        <article className="legal">
          <h1>{title}</h1>
          <p className="muted">
            Last updated: {legal.updated}. {siteName} is operated by {legal.company}.
          </p>
          {children}
          <hr />
          <p className="muted" style={{ fontSize: 13.5 }}>
            Related: {LEGAL_PAGES.map((p, i) => <span key={p.href}>{i > 0 && ' · '}<Link href={p.href}>{p.label}</Link></span>)}
          </p>
        </article>
      </main>
      <SiteFooter />
    </>
  );
}
