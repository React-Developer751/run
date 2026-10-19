import type { Metadata } from 'next';
import Link from 'next/link';
import { Nav } from '@/components/Nav';

export const metadata: Metadata = {
  title: 'Page not found',
  description: 'This page does not exist.',
  robots: { index: false, follow: false },
};

export default function NotFound() {
  return (
    <>
      <Nav variant="site" />
      <main className="center-screen" style={{ textAlign: 'center' }}>
        <div>
          <h1 className="grad-text" style={{ fontSize: 72 }}>404</h1>
          <p className="muted" style={{ margin: '12px 0 24px' }}>This page does not exist.</p>
          <Link href="/" className="btn btn-primary">Back home</Link>
        </div>
      </main>
    </>
  );
}
