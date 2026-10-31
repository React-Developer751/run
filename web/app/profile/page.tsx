'use client';

import Link from 'next/link';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Icon } from '@/components/Icon';
import { Nav } from '@/components/Nav';
import { memoryLabel } from '@/components/PlanCards';
import { api } from '@/lib/api';
import { useAuth, useRequireAuth } from '@/lib/auth';
import { shortDay, timeAgo } from '@/lib/format';
import { useToast } from '@/lib/hooks';
import type { Profile } from '@/lib/types';

const date = (iso: string | null) => (iso ? new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' }) : '—');

function Meter({ label, used, max }: { label: string; used: number; max: number }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}><span>{label}</span><span className="mono">{used} / {max}</span></div>
      <div className="usage-bar"><i style={{ width: `${Math.min(100, (used / Math.max(1, max)) * 100)}%` }} /></div>
    </div>
  );
}

/** How the current plan is paid, in one line. */
function planLine(p: Profile['plan']): string {
  switch (p.source) {
    case 'razorpay':
      return p.endsOn ? `Cancelled · active until ${date(p.endsOn)}` : p.renewsOn ? `Renews automatically on ${date(p.renewsOn)}` : 'Subscription active';
    case 'upi':
      return `Paid by UPI · active until ${date(p.endsOn)}`;
    case 'admin':
      return 'Granted by an administrator';
    default:
      return 'Free forever, no card needed';
  }
}

export default function ProfilePage() {
  const user = useRequireAuth();
  const { reload } = useAuth();
  const [profile, setProfile] = useState<Profile | null>(null);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState('');
  const [saving, setSaving] = useState(false);
  const { toast, flash } = useToast();

  const load = useCallback(async () => {
    try {
      setProfile(await api.profile());
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  if (!user || (!profile && !error)) return <><Nav variant="app" /><div className="center-screen"><span className="spinner" /></div></>;

  const saveName = async (e: FormEvent) => {
    e.preventDefault();
    setSaving(true);
    try {
      await api.updateName(name.trim());
      await Promise.all([load(), reload()]);
      setEditing(false);
      flash('Name updated');
    } catch (err) {
      flash((err as Error).message);
    } finally {
      setSaving(false);
    }
  };

  const p = profile;
  const paid = p ? p.plan.id !== 'free' : false;
  const isAdmin = user.role === 'admin';

  return (
    <>
      <Nav variant="app" />
      <main className="container page profile-page">
        {error && <div className="error-box" style={{ marginBottom: 20 }}>{error}</div>}
        {p && (
          <>
            <section className="card profile-hero">
              <div className="profile-avatar" aria-hidden="true">{p.user.name.charAt(0).toUpperCase()}</div>
              <div className="profile-id">
                {editing ? (
                  <form className="row" style={{ flexWrap: 'wrap', gap: 8 }} onSubmit={saveName}>
                    <input className="input input-sm" aria-label="Your name" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={60} required autoFocus style={{ maxWidth: 260 }} />
                    <button className="btn btn-sm btn-primary" disabled={saving || name.trim().length < 2}>{saving ? <span className="spinner" /> : 'Save'}</button>
                    <button type="button" className="btn btn-sm" onClick={() => setEditing(false)} disabled={saving}>Cancel</button>
                  </form>
                ) : (
                  <h1>
                    {p.user.name}
                    <button className="icon-btn" aria-label="Edit name" title="Edit name" onClick={() => { setName(p.user.name); setEditing(true); }}><Icon name="edit" /></button>
                  </h1>
                )}
                <div className="profile-email">
                  <span>{p.user.email}</span>
                  {p.user.emailVerified ? <span className="badge badge-live">Verified</span> : <span className="badge badge-busy">Not verified</span>}
                </div>
                <div className="profile-tags">
                  {isAdmin && <span className="badge badge-admin"><Icon name="shield" /> Administrator</span>}
                  <span className={`badge ${paid ? 'badge-premium' : 'badge-idle'}`}>{paid ? <Icon name="star" /> : null}{p.plan.name} plan</span>
                  {p.signIn.github && <span className="badge badge-idle"><Icon name="github" /> @{p.signIn.github.login}</span>}
                </div>
                <small className="dim">Member since {shortDay(p.user.createdAt)}{p.user.lastLoginAt ? ` · last sign-in ${timeAgo(p.user.lastLoginAt)}` : ''}</small>
              </div>
              <div className="profile-actions">
                <Link className="btn btn-sm" href="/account"><Icon name="key" /> Account settings</Link>
                {isAdmin && <Link className="btn btn-sm btn-primary" href="/admin"><Icon name="shield" /> Admin panel</Link>}
              </div>
            </section>

            <div className="profile-grid">
              <section className={`card stack ${paid ? 'plan-premium' : ''}`}>
                <div className="row" style={{ justifyContent: 'space-between', alignItems: 'flex-start' }}>
                  <div>
                    <small className="dim">Current plan</small>
                    <h2 className="profile-plan">{p.plan.name}{p.plan.priceInr > 0 && <small> · ₹{p.plan.priceInr.toLocaleString('en-IN')}/month</small>}</h2>
                  </div>
                  {paid && <span className="badge badge-premium"><Icon name="star" /> Premium</span>}
                </div>
                <div className="muted">{isAdmin && !paid ? 'Administrators are not limited by plans.' : planLine(p.plan)}</div>
                <ul className="profile-list">
                  <li><Icon name="check" /> {p.limits.webServices} Web Services · {p.limits.staticSites} Static Sites</li>
                  <li><Icon name="check" /> {memoryLabel(p.limits.memory)} RAM · {p.limits.cpus} CPU per app</li>
                  <li><Icon name="check" /> {p.limits.customDomains} custom domain{p.limits.customDomains === 1 ? '' : 's'}</li>
                </ul>
                {p.plan.paidPlansOffered && !(isAdmin && !paid) && (
                  <div><Link className={`btn ${paid ? '' : 'btn-primary'}`} href="/billing">{paid ? 'Manage billing' : 'Upgrade plan'}</Link></div>
                )}
              </section>

              <section className="card stack">
                <div className="row" style={{ justifyContent: 'space-between' }}>
                  <h3 className="card-title">Usage</h3>
                  <Link href="/dashboard" className="link-btn" style={{ textDecoration: 'none' }}>View projects →</Link>
                </div>
                <Meter label="Web Services" used={p.usage.webServices} max={p.limits.webServices} />
                <Meter label="Static Sites" used={p.usage.staticSites} max={p.limits.staticSites} />
                <Meter label="Custom domains" used={p.usage.customDomains} max={p.limits.customDomains} />
                <small className="dim">{p.usage.projects} project{p.usage.projects === 1 ? '' : 's'} · {p.usage.live} live right now</small>
              </section>

              <section className="card stack">
                <h3 className="card-title">Sign-in &amp; security</h3>
                <ul className="profile-rows">
                  <li><span><Icon name="key" /> Email &amp; password</span><span className="dim">{p.user.passwordChangedAt ? `changed ${timeAgo(p.user.passwordChangedAt)}` : 'set'}</span></li>
                  <li>
                    <span><Icon name="github" /> GitHub</span>
                    {p.signIn.github ? <span className="ok-text">@{p.signIn.github.login} · connected</span> : <Link href="/account">Connect</Link>}
                  </li>
                  <li><span><Icon name="globe" /> Active sign-ins</span><span>{p.signIn.activeSessions} device{p.signIn.activeSessions === 1 ? '' : 's'}</span></li>
                  <li><span><Icon name="check" /> Email</span><span>{p.user.emailVerified ? `verified ${date(p.user.emailVerifiedAt)}` : 'not verified yet'}</span></li>
                </ul>
                <div><Link className="btn btn-sm" href="/account">Change password, sessions or delete account</Link></div>
              </section>

              <section className="card stack">
                <h3 className="card-title">Help</h3>
                <p className="muted" style={{ fontSize: 14 }}>
                  {p.support.open > 0
                    ? `You have ${p.support.open} open support request${p.support.open === 1 ? '' : 's'}${p.support.unread ? `, ${p.support.unread} with a new reply` : ''}.`
                    : 'No open support requests.'}
                </p>
                <div className="row" style={{ flexWrap: 'wrap' }}>
                  <Link className="btn btn-sm" href="/support">{p.support.unread ? 'Read replies' : 'Contact support'}</Link>
                  <Link className="btn btn-sm" href="/new">New deploy</Link>
                </div>
              </section>
            </div>
          </>
        )}
        {toast}
      </main>
    </>
  );
}
