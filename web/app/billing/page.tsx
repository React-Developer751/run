'use client';

import { useCallback, useEffect, useState } from 'react';
import { Nav } from '@/components/Nav';
import { PlanCards } from '@/components/PlanCards';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';
import type { BillingInfo, Plan } from '@/lib/types';

const STATUS_TEXT: Record<string, string> = {
  created: 'Waiting for your payment',
  active: 'Active',
  pending: 'Payment failed — Razorpay is retrying. Update your payment method from the Razorpay email.',
  cancelling: 'Cancelled — your plan stays until the end of the paid period',
};

function Usage({ label, used, max }: { label: string; used: number; max: number }) {
  return (
    <div className="stack" style={{ gap: 6 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}><span>{label}</span><span className="mono">{used} / {max}</span></div>
      <div className="usage-bar"><i style={{ width: `${Math.min(100, (used / Math.max(1, max)) * 100)}%` }} /></div>
    </div>
  );
}

export default function BillingPage() {
  const user = useRequireAuth();
  const [info, setInfo] = useState<BillingInfo | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  const load = useCallback(async () => {
    try {
      const [b, p] = await Promise.all([api.billing.me(), api.billing.plans()]);
      setInfo(b);
      setPlans(p.plans.filter((x) => x.available));
    } catch (e) {
      setError((e as Error).message);
    }
  }, []);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  // After paying on Razorpay the plan changes via webhook within seconds: keep checking while a payment is open.
  const waiting = info?.subscription?.status === 'created';
  useEffect(() => {
    if (!waiting) return;
    const t = setInterval(load, 5000);
    return () => clearInterval(t);
  }, [waiting, load]);

  if (!user || (!info && !error)) return <><Nav variant="app" /><div className="center-screen"><span className="spinner" /></div></>;

  const choose = async (plan: Plan) => {
    setBusy(plan.id);
    setError('');
    setNote('');
    try {
      const r = await api.billing.subscribe(plan.id);
      if (r.url) {
        window.location.href = r.url; // Razorpay's hosted payment page (UPI / card / netbanking)
        return;
      }
      if (r.changed) setNote(`Switching to ${plan.name}. It applies as soon as Razorpay confirms (usually seconds).`);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const cancel = async () => {
    if (!window.confirm('Cancel your subscription? You keep your plan until the end of the paid period, then move to Free.')) return;
    setBusy('cancel');
    setError('');
    try {
      await api.billing.cancel();
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const sub = info?.subscription ?? null;
  const currentName = plans.find((p) => p.id === info?.plan)?.name ?? info?.plan;

  return (
    <>
      <Nav variant="app" />
      <main className="container page">
        <div className="page-head" style={{ marginBottom: 24 }}>
          <div><h1>Plan &amp; <span className="serif grad-text">billing</span></h1><p>You are on the <b>{currentName}</b> plan.</p></div>
        </div>

        {error && <div className="error-box" style={{ marginBottom: 20 }}>{error}</div>}
        {note && <div className="notice-box" style={{ marginBottom: 20 }}>{note}</div>}

        {info && !info.enabled ? (
          <div className="notice-box">Billing is not enabled on this server. Every account uses the limits set by the administrator.</div>
        ) : info && (
          <>
            <div className="grid-2" style={{ marginBottom: 28 }}>
              <div className="card stack">
                <h3 style={{ fontSize: 17 }}>Usage</h3>
                <Usage label="Projects" used={info.usage.projects} max={info.limits.projects} />
                <Usage label="MongoDB databases" used={info.usage.databases} max={info.limits.databases} />
                <Usage label="Custom domains" used={info.usage.customDomains} max={info.limits.customDomains} />
                <p className="muted" style={{ fontSize: 13.5 }}>
                  Each app: {info.limits.memory} RAM, {info.limits.cpus} CPU.{' '}
                  {info.limits.sleepAfterMinutes !== null && `Web services sleep after ${info.limits.sleepAfterMinutes} idle minutes and wake on the next visit (the first request takes a few seconds).`}
                </p>
              </div>
              <div className="card stack">
                <h3 style={{ fontSize: 17 }}>Subscription</h3>
                {sub ? (
                  <>
                    <div>{STATUS_TEXT[sub.status] ?? sub.status}</div>
                    {sub.currentPeriodEnd && <div className="muted">{sub.status === 'cancelling' ? 'Ends' : 'Renews'} on {new Date(sub.currentPeriodEnd).toLocaleDateString()}</div>}
                    <div className="row">
                      {sub.paymentUrl && <a className="btn btn-primary" href={sub.paymentUrl}>Complete payment</a>}
                      {sub.status !== 'cancelling' && (
                        <button className="btn btn-danger" disabled={busy !== ''} onClick={cancel}>{busy === 'cancel' ? <span className="spinner" /> : sub.status === 'created' ? 'Discard' : 'Cancel subscription'}</button>
                      )}
                    </div>
                  </>
                ) : (
                  <div className="muted">No paid subscription. Upgrade below — payment by UPI, card or netbanking via Razorpay. Invoices are emailed by Razorpay.</div>
                )}
              </div>
            </div>

            <PlanCards
              plans={plans}
              current={info.plan}
              action={(p) => {
                if (p.id === info.plan) return <button className="btn" style={{ width: '100%', justifyContent: 'center' }} disabled>Current plan</button>;
                if (p.id === 'free') return sub && sub.status !== 'cancelling' ? <button className="btn" style={{ width: '100%', justifyContent: 'center' }} disabled={busy !== ''} onClick={cancel}>Downgrade (cancel)</button> : null;
                return (
                  <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={busy !== '' || sub?.status === 'cancelling'} onClick={() => choose(p)}>
                    {busy === p.id ? <span className="spinner" /> : info.plan === 'free' ? `Upgrade to ${p.name}` : `Switch to ${p.name}`}
                  </button>
                );
              }}
            />
          </>
        )}
      </main>
    </>
  );
}
