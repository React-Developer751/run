'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '@/lib/api';
import { Icon, type IconName } from '@/components/Icon';
import { Nav } from '@/components/Nav';
import { useRequireAuth } from '@/lib/auth';

const LINKS: Array<{ href: string; label: string; icon: IconName }> = [
  { href: '/admin', label: 'Overview', icon: 'grid' },
  { href: '/admin/users', label: 'Users', icon: 'users' },
  { href: '/admin/projects', label: 'Projects', icon: 'box' },
  { href: '/admin/deployments', label: 'Deployments', icon: 'activity' },
  { href: '/admin/notifications', label: 'Notifications', icon: 'bell' },
  { href: '/admin/payments', label: 'Payments', icon: 'key' },
  { href: '/admin/support', label: 'Support', icon: 'message' },
  { href: '/admin/feedback', label: 'Feedback', icon: 'star' },
  { href: '/admin/settings', label: 'Settings', icon: 'sliders' },
  { href: '/admin/audit', label: 'Audit log', icon: 'list' },
];

export function AdminShell({ children }: { children: ReactNode }) {
  const user = useRequireAuth();
  const pathname = usePathname();
  const [unread, setUnread] = useState(0);

  // Unread alerts badge; also refreshed on every page change (e.g. after marking them read).
  useEffect(() => {
    if (user?.role !== 'admin') return;
    const load = () => api.admin.notifications(1).then((r) => setUnread(r.unread)).catch(() => undefined);
    void load();
    const t = setInterval(load, 30_000);
    window.addEventListener('hostx:admin-notifications', load);
    return () => {
      clearInterval(t);
      window.removeEventListener('hostx:admin-notifications', load);
    };
  }, [user?.role, pathname]);

  if (!user) return <><Nav variant="app" /><div className="center-screen"><span className="spinner" /></div></>;
  if (user.role !== 'admin') {
    return (
      <>
        <Nav variant="app" />
        <main className="center-screen" style={{ textAlign: 'center' }}>
          <div>
            <Icon name="shield" />
            <h2 style={{ margin: '12px 0 8px' }}>Administrators only</h2>
            <p className="muted" style={{ marginBottom: 20 }}>Your account does not have access to this area.</p>
            <Link href="/dashboard" className="btn btn-primary">Back to projects</Link>
          </div>
        </main>
      </>
    );
  }

  return (
    <>
      <Nav variant="app" />
      <div className="container admin-wrap">
        <aside className="admin-side" aria-label="Admin navigation">
          <span className="admin-side-title">Administration</span>
          {LINKS.map((l) => (
            <Link key={l.href} href={l.href} className={`admin-link ${(l.href === '/admin' ? pathname === '/admin' : pathname.startsWith(l.href)) ? 'on' : ''}`}>
              <Icon name={l.icon} /> {l.label}
              {l.href === '/admin/notifications' && unread > 0 && <span className="count-badge" aria-label={`${unread} unread`}>{unread > 99 ? '99+' : unread}</span>}
            </Link>
          ))}
        </aside>
        <main className="admin-main">{children}</main>
      </div>
    </>
  );
}
