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

function RunnerChip() {
  const [health, setHealth] = useState<Health | null>(null);
  useEffect(() => {
    api.health().then(setHealth).catch(() => setHealth(null));
  }, []);
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

export function Nav({ variant }: { variant: 'site' | 'app' }) {
  const { user, loading, signOut } = useAuth();
  const pathname = usePathname();
  const router = useRouter();

  const logout = async () => {
    await signOut();
    router.push('/');
  };

  return (
    <nav className="nav">
      <div className="container nav-inner">
        <Logo href={user ? '/dashboard' : '/'} />

        {variant === 'site' ? (
          <div className="nav-links">
            <a className="nav-link" href="/#how">How it works</a>
            <a className="nav-link" href="/#features">Features</a>
          </div>
        ) : (
          <div className="nav-links">
            <Link className={`nav-link ${pathname === '/dashboard' ? 'active' : ''}`} href="/dashboard">Projects</Link>
            <Link className={`nav-link ${pathname === '/new' ? 'active' : ''}`} href="/new">New deploy</Link>
            {user?.role === 'admin' && <Link className={`nav-link ${pathname.startsWith('/admin') ? 'active' : ''}`} href="/admin">Admin</Link>}
          </div>
        )}

        <div className="nav-right">
          <ThemeToggle />
          {variant === 'app' && <RunnerChip />}
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
  );
}
