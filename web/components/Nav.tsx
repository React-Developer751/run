'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import type { Health } from '@/lib/types';
import { Icon } from './Icon';
import { Logo } from './Logo';
import { ThemeToggle } from './ThemeToggle';

function RunnerChip({ health }: { health: Health | null }) {
  if (!health) return null;
  const isolated = health.runner === 'docker';
  return (
    <span
      className={`chip ${isolated ? '' : 'warn'}`}
      title={isolated ? 'Every app runs in its own Docker container' : 'Docker not found: apps run as plain local processes (development only)'}
    >
      <i className="dot" />
      {isolated ? 'Docker isolated' : 'Dev mode'}
    </span>
  );
}

/** Shown until the account's email is confirmed, on servers where that blocks deploys. */
function VerifyBanner({ email }: { email: string }) {
  const [state, setState] = useState<'idle' | 'busy' | 'sent'>('idle');
  const [error, setError] = useState('');
  const resend = async () => {
    setState('busy');
    setError('');
    try {
      await api.resendVerification();
      setState('sent');
    } catch (err) {
      setError((err as Error).message);
      setState('idle');
    }
  };
  return (
    <div className="container" style={{ marginTop: 14 }}>
      <div className="notice-box" role="status" style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
        <span>
          <b>Confirm your email</b> to start deploying. We sent a link to <b>{email}</b>.
          {error && <span style={{ color: 'var(--bad)' }}> {error}</span>}
        </span>
        <button className="btn btn-sm" onClick={resend} disabled={state !== 'idle'}>
          {state === 'busy' ? <span className="spinner" /> : state === 'sent' ? 'Sent — check your inbox' : 'Resend email'}
        </button>
      </div>
    </div>
  );
}

export function Nav({ variant }: { variant: 'site' | 'app' }) {
  const { user, loading, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
  }, []);

  // Unread support replies (badge on "Support"), refreshed on page changes and every minute.
  const [supportUnread, setSupportUnread] = useState(0);
  useEffect(() => {
    if (variant !== 'app' || !user) return;
    const load = () => api.support.tickets().then((r) => setSupportUnread(r.unread)).catch(() => undefined);
    void load();
    const t = setInterval(load, 60_000);
    return () => clearInterval(t);
  }, [variant, user, pathname]);

  const logout = async () => {
    await signOut();
    router.push('/');
  };

  return (
    <>
    <nav className="nav">
      <div className="container nav-inner">
        <Logo href={user ? '/dashboard' : '/'} />

        {variant === 'site' ? (
          <div className="nav-links">
            <a className="nav-link" href="/#how">How it works</a>
            <a className="nav-link" href="/#features">Features</a>
            {health?.billing && <Link className="nav-link" href="/pricing">Pricing</Link>}
          </div>
        ) : (
          <div className="nav-links">
            <Link className={`nav-link ${pathname === '/dashboard' ? 'active' : ''}`} href="/dashboard">Projects</Link>
            <Link className={`nav-link ${pathname === '/new' ? 'active' : ''}`} href="/new">New deploy</Link>
            {health?.billing && <Link className={`nav-link ${pathname === '/billing' ? 'active' : ''}`} href="/billing">Billing</Link>}
            <Link className={`nav-link ${pathname === '/support' ? 'active' : ''}`} href="/support">
              Support{supportUnread > 0 && <span className="count-badge" aria-label={`${supportUnread} new replies`}>{supportUnread}</span>}
            </Link>
            {user?.role === 'admin' && <Link className={`nav-link ${pathname.startsWith('/admin') ? 'active' : ''}`} href="/admin">Admin</Link>}
          </div>
        )}

        <div className="nav-right">
          <ThemeToggle />
          {variant === 'app' && <RunnerChip health={health} />}
          {loading ? null : user ? (
            <>
              {variant === 'site' && (
                <Link href="/dashboard" className="btn btn-sm btn-primary">Dashboard</Link>
              )}
              <Link href="/account" className="avatar" title={`${user.name} · account settings`} aria-label="Account settings">{user.name.charAt(0).toUpperCase()}</Link>
              {variant === 'app' && (
                <button className="btn btn-sm" onClick={logout} aria-label="Sign out">
                  <Icon name="logout" /> Sign out
                </button>
              )}
            </>
          ) : (
            <>
              <Link href="/login" className="btn btn-sm">Sign in</Link>
              <Link href="/register" className="btn btn-sm btn-primary">Get started</Link>
            </>
          )}
        </div>
      </div>
    </nav>
    {variant === 'app' && user && !user.emailVerified && user.verificationRequired && <VerifyBanner email={user.email} />}
    </>
  );
}
