'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { useAuth } from '@/lib/auth';
import { Nav } from './Nav';

export function AuthForm({ mode }: { mode: 'login' | 'register' }) {
  const { user, loading, signIn, signUp } = useAuth();
  const router = useRouter();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState(false);
  const isLogin = mode === 'login';

  useEffect(() => {
    if (!loading && user) router.replace('/dashboard');
  }, [loading, user, router]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      if (isLogin) await signIn(email, password);
      else await signUp(name, email, password);
      router.replace('/dashboard');
    } catch (err) {
      setError((err as Error).message);
      setBusy(false);
    }
  };

  return (
    <>
      <Nav variant="site" />
      <main className="auth-wrap">
        <div className="card auth-card">
          <h1>
            {isLogin ? 'Welcome back' : 'Create your '}
            {!isLogin && <span className="serif grad-text">account</span>}
          </h1>
          <p className="muted">{isLogin ? 'Sign in to manage your deployments.' : 'Free forever. Deploy your first repo in minutes.'}</p>

          <form onSubmit={submit}>
            {!isLogin && (
              <div className="field">
                <label className="label" htmlFor="name">Name</label>
                <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" autoComplete="name" required minLength={2} />
              </div>
            )}
            <div className="field">
              <label className="label" htmlFor="email">Email</label>
              <input id="email" type="email" className="input" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="you@example.com" autoComplete="email" required />
            </div>
            <div className="field">
              <label className="label" htmlFor="password">Password</label>
              <input
                id="password"
                type="password"
                className="input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder={isLogin ? 'Your password' : 'At least 8 characters'}
                autoComplete={isLogin ? 'current-password' : 'new-password'}
                required
                minLength={isLogin ? 1 : 8}
              />
              {isLogin && (
                <span className="hint" style={{ textAlign: 'right' }}><Link href="/forgot-password">Forgot password?</Link></span>
              )}
            </div>

            {!isLogin && (
              <label className="check" style={{ padding: '10px 12px' }}>
                <input type="checkbox" checked={accepted} onChange={(e) => setAccepted(e.target.checked)} required />
                <span style={{ fontSize: 13.5 }}>
                  I agree to the <Link href="/terms" target="_blank">Terms of Service</Link>, <Link href="/acceptable-use" target="_blank">Acceptable Use Policy</Link> and{' '}
                  <Link href="/privacy" target="_blank">Privacy Policy</Link>.
                </span>
              </label>
            )}

            {error && <div className="error-box" role="alert">{error}</div>}

            <button className="btn btn-primary btn-lg" disabled={busy || (!isLogin && !accepted)}>
              {busy ? <span className="spinner" /> : isLogin ? 'Sign in' : 'Create account'}
            </button>
          </form>

          <p className="auth-foot">
            {isLogin ? (
              <>New to HostX? <Link href="/register">Create an account</Link></>
            ) : (
              <>Already have an account? <Link href="/login">Sign in</Link></>
            )}
          </p>
        </div>
      </main>
    </>
  );
}
