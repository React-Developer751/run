'use client';

import Link from 'next/link';
import { useState, type FormEvent } from 'react';
import { Captcha, captchaEnabled } from '@/components/Captcha';
import { Nav } from '@/components/Nav';
import { api } from '@/lib/api';

export default function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [captcha, setCaptcha] = useState('');
  const [captchaKey, setCaptchaKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      await api.forgotPassword(email.trim(), captcha || undefined);
      setSent(true);
    } catch (err) {
      setError((err as Error).message);
      setCaptcha('');
      setCaptchaKey((k) => k + 1);
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Nav variant="site" />
      <main className="auth-wrap">
        <div className="card auth-card">
          <h1>Forgot your <span className="serif grad-text">password?</span></h1>
          {sent ? (
            <div className="notice-box" role="status" style={{ marginTop: 24 }}>
              If an account exists for <b>{email.trim()}</b>, we have sent a link to reset its password. It expires in 1 hour. Check your spam folder too.
            </div>
          ) : (
            <>
              <p className="muted">Enter your email and we will send you a link to choose a new password.</p>
              <form onSubmit={submit}>
                <div className="field">
                  <label className="label" htmlFor="email">Email</label>
                  <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required autoFocus />
                </div>
                <Captcha key={captchaKey} onToken={setCaptcha} />
                {error && <div className="error-box" role="alert">{error}</div>}
                <button className="btn btn-primary btn-lg" disabled={busy || (captchaEnabled && !captcha)}>
                  {busy ? <span className="spinner" /> : 'Send reset link'}
                </button>
              </form>
            </>
          )}
          <p className="auth-foot"><Link href="/login">Back to sign in</Link></p>
        </div>
      </main>
    </>
  );
}
