'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { Nav } from '@/components/Nav';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useRequireAuth } from '@/lib/auth';
import type { GitHubStatus } from '@/lib/types';

const GITHUB_RESULT: Record<string, { ok: boolean; text: string }> = {
  connected: { ok: true, text: 'GitHub connected. Your repositories now show up on the New deploy page.' },
  requested: { ok: true, text: 'Installation requested. An owner of that GitHub organization has to approve it first.' },
  expired: { ok: false, text: 'The GitHub connection took too long or was started from another account. Please try again.' },
  'missing-code': { ok: false, text: 'GitHub did not send a sign-in code. In the GitHub App settings, enable "Request user authorization (OAuth) during installation".' },
  failed: { ok: false, text: 'Could not connect GitHub. Please try again.' },
};

function GitHubCard() {
  const { reload } = useAuth();
  const [status, setStatus] = useState<GitHubStatus | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const key = new URLSearchParams(window.location.search).get('github');
    if (key && GITHUB_RESULT[key]) {
      setResult(GITHUB_RESULT[key]);
      window.history.replaceState(null, '', '/account');
      void reload();
    }
    api.github.status().then(setStatus).catch(() => setStatus(null));
  }, [reload]);

  if (!status?.enabled) return null;
  return (
    <div className="card stack" style={{ marginBottom: 20 }}>
      <div>
        <h2 style={{ fontSize: 18 }}>GitHub</h2>
        <p className="muted" style={{ marginTop: 6 }}>
          Connect GitHub to deploy <b>private repositories</b> and get instant deploys on every push. You choose which repositories HostX can read.
        </p>
      </div>
      {result && <div className={result.ok ? 'notice-box' : 'error-box'} role="status">{result.text}</div>}
      {status.connected ? (
        <>
          <dl className="kv">
            <div><dt>Account</dt><dd className="mono">@{status.login}</dd></div>
            <div><dt>Installations</dt><dd>{status.installations}</dd></div>
          </dl>
          <div className="row">
            <a className="btn" href={status.installUrl}>Add repositories or organizations</a>
            <a className="btn" href={status.authorizeUrl}>Refresh access</a>
            <button
              className="btn btn-danger"
              disabled={busy}
              onClick={async () => {
                if (!window.confirm('Disconnect GitHub from HostX? Existing projects keep deploying until you uninstall the app on GitHub.')) return;
                setBusy(true);
                await api.github.unlink().catch(() => undefined);
                setStatus(await api.github.status().catch(() => null));
                await reload();
                setBusy(false);
              }}
            >
              Disconnect
            </button>
          </div>
        </>
      ) : (
        <div className="row">
          <a className="btn btn-primary" href={status.installUrl}>Connect GitHub</a>
          <a className="btn" href={status.authorizeUrl}>The app is already installed? Link it</a>
        </div>
      )}
    </div>
  );
}

export default function AccountPage() {
  const user = useRequireAuth();
  const { signOut } = useAuth();
  const router = useRouter();
  const [everywhereBusy, setEverywhereBusy] = useState(false);
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState('');
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);

  if (!user) return <><Nav variant="app" /><div className="center-screen"><span className="spinner" /></div></>;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setDone(false);
    if (next !== confirm) return setError('The new passwords do not match.');
    setBusy(true);
    try {
      await api.changePassword(current, next); // all other devices are signed out; the server re-issues this browser's cookies
      setCurrent('');
      setNext('');
      setConfirm('');
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Nav variant="app" />
      <main className="container page">
        <div className="wizard">
          <div className="page-head" style={{ marginBottom: 24 }}>
            <div><h1>Your <span className="serif grad-text">account</span></h1><p>Signed in as {user.email}.</p></div>
          </div>

          <div className="card stack" style={{ marginBottom: 20 }}>
            <h2 style={{ fontSize: 18 }}>Profile</h2>
            <dl className="kv">
              <div><dt>Name</dt><dd>{user.name}</dd></div>
              <div><dt>Email</dt><dd>{user.email} {user.emailVerified ? <span className="dim">(confirmed)</span> : <span style={{ color: 'var(--warn)' }}>(not confirmed)</span>}</dd></div>
              <div><dt>Role</dt><dd style={{ textTransform: 'capitalize' }}>{user.role}</dd></div>
            </dl>
          </div>

          <GitHubCard />

          <form className="card stack" onSubmit={submit}>
            <div>
              <h2 style={{ fontSize: 18 }}>Change password</h2>
              <p className="muted" style={{ marginTop: 6 }}>Other devices are signed out when you change it.</p>
            </div>
            <div className="field">
              <label className="label" htmlFor="cur">Current password</label>
              <input id="cur" type="password" className="input" value={current} onChange={(e) => setCurrent(e.target.value)} autoComplete="current-password" required />
            </div>
            <div className="field">
              <label className="label" htmlFor="new">New password</label>
              <input id="new" type="password" className="input" value={next} onChange={(e) => setNext(e.target.value)} autoComplete="new-password" minLength={8} required />
              <span className="hint">At least 8 characters.</span>
            </div>
            <div className="field">
              <label className="label" htmlFor="conf">Confirm new password</label>
              <input id="conf" type="password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={8} required />
            </div>
            {error && <div className="error-box" role="alert">{error}</div>}
            {done && <div className="notice-box" role="status">Password updated.</div>}
            <div><button className="btn btn-primary" disabled={busy}>{busy ? <span className="spinner" /> : 'Update password'}</button></div>
          </form>

          <div className="card stack" style={{ marginTop: 20 }}>
            <div>
              <h2 style={{ fontSize: 18 }}>Sessions</h2>
              <p className="muted" style={{ marginTop: 6 }}>Sign out of every browser and device where you are logged in, including this one.</p>
            </div>
            <div>
              <button
                className="btn btn-danger"
                disabled={everywhereBusy}
                onClick={async () => {
                  setEverywhereBusy(true);
                  await api.logoutAll().catch(() => undefined);
                  await signOut();
                  router.replace('/login');
                }}
              >
                {everywhereBusy ? <span className="spinner" /> : 'Sign out everywhere'}
              </button>
            </div>
          </div>
        </div>
      </main>
    </>
  );
}
