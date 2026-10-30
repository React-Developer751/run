'use client';

import { useEffect, useState } from 'react';
import { refreshSiteName } from '@/app/actions';
import { SITE_NAME_EVENT } from '@/components/BrandProvider';
import { api } from '@/lib/api';
import { useToast } from '@/lib/hooks';
import { PlanEditor } from '@/components/PlanEditor';
import type { PlatformSettings, SettingsPatch } from '@/lib/types';

export default function AdminSettings() {
  const { toast, flash } = useToast();
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [limit, setLimit] = useState('');
  const [siteName, setSiteName] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.admin
      .settings()
      .then((r) => {
        setSettings(r.settings);
        setLimit(String(r.settings.maxProjectsPerUser));
        setSiteName(r.settings.siteName);
      })
      .catch((e: Error) => setError(e.message));
  }, []);

  const save = async (patch: SettingsPatch, done: string): Promise<boolean> => {
    setBusy(true);
    setError('');
    try {
      const r = await api.admin.updateSettings(patch);
      setSettings(r.settings);
      setLimit(String(r.settings.maxProjectsPerUser));
      setSiteName(r.settings.siteName);
      if (patch.siteName !== undefined) {
        // This tab, every component reading the name, and the server-rendered pages (landing, legal, titles).
        window.dispatchEvent(new CustomEvent(SITE_NAME_EVENT, { detail: r.settings.siteName }));
        await refreshSiteName().catch(() => undefined);
      }
      flash(done);
      return true;
    } catch (e) {
      setError((e as Error).message);
      window.scrollTo({ top: 0, behavior: 'smooth' });
      return false;
    } finally {
      setBusy(false);
    }
  };

  if (!settings) return error ? <div className="error-box">{error}</div> : <div className="center-screen"><span className="spinner" /></div>;

  return (
    <div className="stack" style={{ gap: 20, maxWidth: 860 }}>
      <div className="page-head" style={{ marginBottom: 0 }}><div><h1>Settings</h1><p>Platform rules. Changes apply immediately, no restart needed.</p></div></div>
      {error && <div className="error-box">{error}</div>}

      <div className="card stack">
        <div>
          <h3 className="card-title">Website name</h3>
          <p className="muted" style={{ marginTop: 6, fontSize: 14 }}>
            Shown everywhere: logo, landing page, page titles, legal pages, emails and the pages visitors see when an app is paused.
            Open pages update right away; other visitors see it within a minute.
          </p>
        </div>
        <form
          className="row"
          style={{ flexWrap: 'wrap', alignItems: 'flex-start' }}
          onSubmit={(e) => {
            e.preventDefault();
            void save({ siteName: siteName.trim() }, 'Website name saved');
          }}
        >
          <input
            id="site-name"
            className="input"
            aria-label="Website name"
            value={siteName}
            onChange={(e) => setSiteName(e.target.value)}
            maxLength={40}
            minLength={2}
            required
            style={{ maxWidth: 320 }}
            placeholder={settings.defaultSiteName}
          />
          <button className="btn btn-primary" disabled={busy || siteName.trim().length < 2 || siteName.trim() === settings.siteName}>Save</button>
          {settings.siteName !== settings.defaultSiteName && (
            <button type="button" className="btn" disabled={busy} onClick={() => window.confirm(`Go back to "${settings.defaultSiteName}"?`) && void save({ siteName: null }, 'Website name reset')}>
              Reset to {settings.defaultSiteName}
            </button>
          )}
        </form>
        <span className="hint">2–40 characters: letters, numbers, spaces and . &amp; &apos; ! + _ -</span>
      </div>

      <div className="card stack">
        <div>
          <h3 className="card-title">App URLs</h3>
          <p className="muted" style={{ marginTop: 6, fontSize: 14 }}>
            Every deployed project gets an address on the apps domain, like Render&apos;s <span className="mono">name.onrender.com</span>.
            A name that is already taken gets a short suffix (<span className="mono">shop-x7k2</span>). Users can also add their own domains.
          </p>
        </div>
        <div className="mono notice-box" style={{ fontSize: 14 }}>{settings.appUrlTemplate}</div>
        {settings.appsDomain === 'localhost' ? (
          <span className="hint">Local development address. On the live server set <span className="mono">HOSTX_BASE_DOMAIN</span> (or a real dashboard URL) and restart.</span>
        ) : settings.appsDomainAuto ? (
          <span className="hint">
            Taken from the domain this dashboard runs on. Point <span className="mono">*.{settings.appsDomain}</span> to the server. For extra safety use a separate
            domain like Render does: set <span className="mono">HOSTX_BASE_DOMAIN=yourapps.app</span> in the server <span className="mono">.env</span> and restart; every project URL changes with it.
          </span>
        ) : (
          <span className="hint">Set by <span className="mono">HOSTX_BASE_DOMAIN</span> in the server <span className="mono">.env</span>. Changing it (and restarting) moves every project URL to the new domain.</span>
        )}
      </div>

      <div className="card stack">
        <h3 className="card-title">Registration</h3>
        <label className="check">
          <input type="checkbox" checked={settings.allowSignup} disabled={busy} onChange={(e) => save({ allowSignup: e.target.checked }, e.target.checked ? 'Sign-ups opened' : 'Sign-ups closed')} />
          <span><b>Allow new sign-ups</b><small>Turn off once your own accounts exist to keep the server private. Existing users can still sign in.</small></span>
        </label>
      </div>

      {settings.billingEnabled || settings.razorpayKeys ? (
        <>
          {!settings.billingEnabled && <div className="notice-box">Razorpay keys are set. Paste a Razorpay plan id into Starter or Pro below to turn on paid plans.</div>}
          <PlanEditor plans={settings.plans} busy={busy} onSave={save} />
        </>
      ) : (
        <div className="notice-box">
          Plans (Free / Starter / Pro) take effect once Razorpay is configured. Until then every user gets the limits below.
        </div>
      )}

      <div className="card stack">
        <h3 className="card-title">{settings.billingEnabled ? 'Without billing' : 'Limits'}</h3>
        <div className="field">
          <label className="label" htmlFor="limit">Default projects per user</label>
          <div className="row">
            <input id="limit" className="input" type="number" min={0} max={100} value={limit} onChange={(e) => setLimit(e.target.value)} style={{ maxWidth: 160 }} />
            <button className="btn btn-primary" disabled={busy || limit === '' || Number(limit) === settings.maxProjectsPerUser} onClick={() => save({ maxProjectsPerUser: Number(limit) }, 'Limit saved')}>Save</button>
          </div>
          <span className="hint">Individual users can get their own limit from the Users page.</span>
        </div>
      </div>
      {toast}
    </div>
  );
}
