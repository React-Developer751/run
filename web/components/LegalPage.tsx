import Link from 'next/link';
import type { ReactNode } from 'react';
import { LEGAL, LEGAL_PAGES, SITE_NAME } from '@/lib/site';
import { Nav } from './Nav';
import { SiteFooter } from './SiteFooter';

/** Shared shell for the legal pages: readable prose column with links to the sibling policies. */
export function LegalPage({ title, children }: { title: string; children: ReactNode }) {
  return (
    <>
      <Nav variant="site" />
      <main className="container page">
        <article className="legal">
          <h1>{title}</h1>
          <p className="muted">
            Last updated: {LEGAL.updated}. {SITE_NAME} is operated by {LEGAL.company}.
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
