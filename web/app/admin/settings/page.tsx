'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { useToast } from '@/lib/hooks';
import type { PlatformSettings } from '@/lib/types';

export default function AdminSettings() {
  const { toast, flash } = useToast();
  const [settings, setSettings] = useState<PlatformSettings | null>(null);
  const [limit, setLimit] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    api.admin.settings().then((r) => { setSettings(r.settings); setLimit(String(r.settings.maxProjectsPerUser)); }).catch((e: Error) => setError(e.message));
  }, []);

  const save = async (patch: Partial<PlatformSettings>, done: string) => {
    setBusy(true);
    setError('');
    try {
      const r = await api.admin.updateSettings(patch);
      setSettings(r.settings);
      setLimit(String(r.settings.maxProjectsPerUser));
      flash(done);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  if (!settings) return error ? <div className="error-box">{error}</div> : <div className="center-screen"><span className="spinner" /></div>;

  return (
    <div className="stack" style={{ gap: 20, maxWidth: 720 }}>
      <div className="page-head" style={{ marginBottom: 0 }}><div><h1>Settings</h1><p>Platform rules. Changes apply immediately, no restart needed.</p></div></div>
      {error && <div className="error-box">{error}</div>}

      <div className="card stack">
        <h3 className="card-title">Registration</h3>
        <label className="check">
          <input type="checkbox" checked={settings.allowSignup} disabled={busy} onChange={(e) => save({ allowSignup: e.target.checked }, e.target.checked ? 'Sign-ups opened' : 'Sign-ups closed')} />
          <span><b>Allow new sign-ups</b><small>Turn off once your own accounts exist to keep the server private. Existing users can still sign in.</small></span>
        </label>
      </div>

      <div className="card stack">
        <h3 className="card-title">Limits</h3>
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
