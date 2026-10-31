'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import type { User } from '@/lib/types';
import { Icon, type IconName } from './Icon';

/**
 * Top-right account menu (avatar button + dropdown): profile, settings, billing, support, the Admin panel for
 * administrators, and sign out. Closes on Esc, outside click and navigation.
 */
export function AccountMenu({ user, billing, onSignOut }: { user: User; billing: boolean; onSignOut: () => void }) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const pathname = usePathname();
  const isAdmin = user.role === 'admin';

  useEffect(() => setOpen(false), [pathname]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (root.current && !root.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    // Move focus into the menu for keyboard users.
    root.current?.querySelector<HTMLElement>('[role="menuitem"]')?.focus();
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const item = (href: string, label: string, icon: IconName) => (
    <Link role="menuitem" href={href} className={`menu-item ${pathname === href ? 'on' : ''}`}>
      <Icon name={icon} /> {label}
    </Link>
  );

  return (
    <div className="account-menu" ref={root}>
      <button
        ref={button}
        type="button"
        className={`avatar-btn ${isAdmin ? 'is-admin' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Account menu for ${user.name}`}
        onClick={() => setOpen((v) => !v)}
      >
        <span className="avatar">{user.name.charAt(0).toUpperCase()}</span>
        {isAdmin && <span className="avatar-admin-dot" title="Administrator" aria-hidden="true"><Icon name="shield" /></span>}
        <Icon name="chevron" className="icon avatar-chevron" />
      </button>
      {open && (
        <div className="menu" role="menu" aria-label="Account">
          <div className="menu-head">
            <b>{user.name}</b>
            <small>{user.email}</small>
            {isAdmin && <span className="badge badge-admin"><Icon name="shield" /> Administrator</span>}
          </div>
          {item('/profile', 'Profile', 'users')}
          {item('/account', 'Account settings', 'key')}
          {billing && item('/billing', 'Plan & billing', 'star')}
          {item('/support', 'Support', 'message')}
          {isAdmin && (
            <>
              <div className="menu-sep" role="separator" />
              {item('/admin', 'Admin panel', 'shield')}
            </>
          )}
          <div className="menu-sep" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="menu-item menu-danger"
            onClick={() => {
              setOpen(false);
              onSignOut();
            }}
          >
            <Icon name="logout" /> Sign out
          </button>
        </div>
      )}
    </div>
  );
}
