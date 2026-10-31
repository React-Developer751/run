'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { Nav } from '@/components/Nav';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';

export default function VerifyEmailPage() {
  const { user, reload } = useAuth();
  const [state, setState] = useState<'working' | 'done' | 'failed'>('working');
  const [error, setError] = useState('');
  const started = useRef(false);

  useEffect(() => {
    if (started.current) return; // StrictMode runs effects twice; the token works only once
    started.current = true;
    const token = new URLSearchParams(window.location.search).get('token') ?? '';
    api
      .verifyEmail(token)
      .then(async () => {
        setState('done');
        await reload();
      })
      .catch((err: Error) => {
        setError(err.message);
        setState('failed');
      });
  }, [reload]);

  return (
    <>
      <Nav variant="site" />
      <main className="auth-wrap">
        <div className="card auth-card">
          <h1>Confirm your <span className="serif grad-text">email</span></h1>
          {state === 'working' && <div className="center-screen" style={{ minHeight: 120 }}><span className="spinner" /></div>}
          {state === 'done' && (
            <>
              <div className="notice-box" role="status" style={{ marginTop: 24 }}>Your email address is confirmed. You can deploy now.</div>
              <p className="auth-foot"><Link href={user ? '/dashboard' : '/login'}>{user ? 'Go to your projects' : 'Sign in'}</Link></p>
            </>
          )}
          {state === 'failed' && (
            <>
              <div className="error-box" style={{ marginTop: 24 }}>{error}</div>
              <p className="auth-foot">{user ? <Link href="/dashboard">Resend from the dashboard</Link> : <Link href="/login">Sign in to get a new link</Link>}</p>
            </>
          )}
        </div>
      </main>
    </>
  );
}
