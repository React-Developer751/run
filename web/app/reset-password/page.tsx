'use client';

import Link from 'next/link';
import { useEffect, useState, type FormEvent } from 'react';
import { Nav } from '@/components/Nav';
import { api } from '@/lib/api';
import { PasswordInput } from '@/components/PasswordInput';

export default function ResetPasswordPage() {
  const [token, setToken] = useState<string | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState('');

  // Read on the client only (no useSearchParams, so the page needs no Suspense boundary).
  useEffect(() => {
    setToken(new URLSearchParams(window.location.search).get('token') ?? '');
  }, []);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (password !== confirm) return setError('The passwords do not match.');
    setBusy(true);
    try {
      await api.resetPassword(token ?? '', password);
      setDone(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Nav variant="site" />
      <main className="auth-wrap">
        <div className="card auth-card">
          <h1>Choose a new <span className="serif grad-text">password</span></h1>
          {done ? (
            <>
              <div className="notice-box" role="status" style={{ marginTop: 24 }}>Your password was changed and every device was signed out.</div>
              <p className="auth-foot"><Link href="/login">Sign in with your new password</Link></p>
            </>
          ) : token === '' ? (
            <div className="error-box" style={{ marginTop: 24 }}>This link is incomplete. Open the link from the email again, or <Link href="/forgot-password">request a new one</Link>.</div>
          ) : (
            <form onSubmit={submit}>
              <div className="field">
                <label className="label" htmlFor="new">New password</label>
                <PasswordInput id="new" className="input" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" minLength={8} required autoFocus />
                <span className="hint">At least 8 characters.</span>
              </div>
              <div className="field">
                <label className="label" htmlFor="conf">Confirm new password</label>
                <PasswordInput id="conf" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" minLength={8} required />
              </div>
              {error && <div className="error-box" role="alert">{error} {/expired|invalid/i.test(error) && <Link href="/forgot-password">Request a new link</Link>}</div>}
              <button className="btn btn-primary btn-lg" disabled={busy || token === null}>{busy ? <span className="spinner" /> : 'Change password'}</button>
            </form>
          )}
        </div>
      </main>
    </>
  );
}
