'use client';

import { useCallback, useEffect, useState } from 'react';
import { Nav } from '@/components/Nav';
import { PlanCards, memoryLabel } from '@/components/PlanCards';
import { UpiPayModal } from '@/components/UpiPayModal';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';
import type { BillingInfo, Plan } from '@/lib/types';
import { useConfirm } from '@/components/ConfirmProvider';

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
  const confirm = useConfirm();
  const user = useRequireAuth();
  const [info, setInfo] = useState<BillingInfo | null>(null);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  const [upiPlan, setUpiPlan] = useState<Plan | null>(null);

  const load = useCallback(async () => {
    try {
      const [b, p] = await Promise.all([api.billing.me(), api.billing.plans()]);
      setInfo(b);
      setPlans(p.plans.filter((x) => x.available));
      setError('');
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
    // Every 5 s for 5 minutes; after that a reload of the page checks again.
    let n = 0;
    const t = setInterval(() => {
      if (++n > 60) clearInterval(t);
      else void load();
    }, 5000);
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
    const ok = await confirm({
      title: sub?.status === 'created' ? 'Discard this payment?' : 'Cancel your subscription?',
      message: sub?.status === 'created' ? 'The unpaid checkout is cancelled. You stay on your current plan.' : 'Nothing is charged again. You keep your plan until the end of the period you paid for, then move to Free. Your apps are not deleted.',
      confirmLabel: sub?.status === 'created' ? 'Discard' : 'Cancel subscription',
      cancelLabel: 'Keep it',
      danger: true,
    });
    if (!ok) return;
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
  const subLive = Boolean(sub && ['created', 'active', 'pending', 'cancelling'].includes(sub.status));
  const upiPaidUntil = info?.upi.paidUntil ?? null;
  const upiPending = info?.upi.payments.find((p) => p.status === 'pending') ?? null;
  const upi = info?.methods.upi ?? null;
  const methodText = [info?.methods.razorpay ? 'card, UPI AutoPay or netbanking via Razorpay (renews automatically)' : '', upi ? 'direct UPI (one month at a time, verified by our team)' : '']
    .filter(Boolean)
    .join(', or ');
  const PAYMENT_STATUS: Record<string, string> = { pending: 'Being verified', approved: 'Approved', rejected: 'Rejected' };

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
                <Usage label="Web Services" used={info.usage.webServices} max={info.limits.webServices} />
                <Usage label="Static Sites" used={info.usage.staticSites} max={info.limits.staticSites} />
                <Usage label="Custom domains" used={info.usage.customDomains} max={info.limits.customDomains} />
                <p className="muted" style={{ fontSize: 13.5 }}>
                  Each app: {memoryLabel(info.limits.memory)} RAM, {info.limits.cpus} CPU.{' '}
                  {info.limits.pauseAfterDays !== null
                    ? `Web services run all the time while people use them; one with no visits for ${info.limits.pauseAfterDays} days is paused (resume in one click)${info.limits.archiveAfterDays !== null ? `, and archived after ${info.limits.archiveAfterDays} days` : ''}. Static sites are never paused.`
                    : 'Apps are never paused.'}
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
                ) : upiPaidUntil ? (
                  <>
                    <div>Paid by UPI until <b>{new Date(upiPaidUntil).toLocaleDateString()}</b></div>
                    <div className="muted" style={{ fontSize: 13.5 }}>UPI payments do not renew automatically. Pay again before that date to continue; the new month starts when this one ends.</div>
                    {upi && !upiPending && (
                      <div><button className="btn btn-primary" disabled={busy !== ''} onClick={() => setUpiPlan(plans.find((p) => p.id === info.plan) ?? null)}>Renew by UPI</button></div>
                    )}
                  </>
                ) : (
                  <div className="muted">No paid plan. Upgrade below. {methodText ? `Pay by ${methodText}.` : ''}</div>
                )}
                {upiPending && (
                  <div className="notice-box">
                    Your UPI payment of ₹{upiPending.amountInr.toLocaleString('en-IN')} (UTR <span className="mono">{upiPending.utr}</span>) is being verified. You get an email when it is approved.
                  </div>
                )}
              </div>
            </div>

            <PlanCards
              plans={plans}
              current={info.plan}
              action={(p) => {
                if (p.id === info.plan && !(upiPaidUntil && upi)) return <button className="btn" style={{ width: '100%', justifyContent: 'center' }} disabled>Current plan</button>;
                if (p.id === 'free') return sub && sub.status !== 'cancelling' ? <button className="btn" style={{ width: '100%', justifyContent: 'center' }} disabled={busy !== ''} onClick={cancel}>Downgrade (cancel)</button> : null;
                const verb = p.id === info.plan ? 'Renew' : info.plan === 'free' ? `Upgrade to ${p.name}` : `Switch to ${p.name}`;
                // Only the methods the admin switched on; one way of paying at a time.
                const viaRazorpay = info.methods.razorpay && info.methods.razorpayPlans.includes(p.id) && !upiPaidUntil;
                const viaUpi = Boolean(upi) && !subLive && p.priceInr > 0;
                if (!viaRazorpay && !viaUpi) return null;
                return (
                  <div className="pay-actions">
                    {viaRazorpay && (
                      <button className="btn btn-primary" disabled={busy !== '' || sub?.status === 'cancelling'} onClick={() => choose(p)}>
                        {busy === p.id ? <span className="spinner" /> : viaUpi ? `${verb} · card / AutoPay` : verb}
                      </button>
                    )}
                    {viaUpi && (
                      <button className={`btn ${viaRazorpay ? '' : 'btn-primary'}`} disabled={busy !== '' || Boolean(upiPending)} title={upiPending ? 'Your last UPI payment is still being verified' : undefined} onClick={() => setUpiPlan(p)}>
                        {upiPending ? 'UPI payment being verified' : viaRazorpay ? 'Pay by UPI (manual)' : `${verb} · pay by UPI`}
                      </button>
                    )}
                  </div>
                );
              }}
            />
            {info.upi.payments.length > 0 && (
              <div className="card table-card" style={{ marginTop: 28 }}>
                <table className="table">
                  <thead><tr><th>UPI payment</th><th>Plan</th><th>Amount</th><th>UTR</th><th>Status</th></tr></thead>
                  <tbody>
                    {info.upi.payments.map((p) => (
                      <tr key={p.id}>
                        <td>{new Date(p.createdAt).toLocaleDateString()}</td>
                        <td>{plans.find((x) => x.id === p.plan)?.name ?? p.plan}</td>
                        <td>₹{p.amountInr.toLocaleString('en-IN')}</td>
                        <td className="mono">{p.utr}</td>
                        <td>
                          <span className={`badge ${p.status === 'approved' ? 'badge-live' : p.status === 'rejected' ? 'badge-bad' : 'badge-busy'}`}>{PAYMENT_STATUS[p.status]}</span>
                          {p.reason && <small className="dim" style={{ display: 'block', marginTop: 4, whiteSpace: 'normal' }}>{p.reason}</small>}
                          {p.paidUntil && <small className="dim" style={{ display: 'block', marginTop: 4 }}>until {new Date(p.paidUntil).toLocaleDateString()}</small>}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </>
        )}
        {upiPlan && upi && info && (
          <UpiPayModal
            plan={upiPlan}
            upi={upi}
            periodDays={info.upi.periodDays}
            reference={user.id.slice(-6)}
            onClose={() => setUpiPlan(null)}
            onDone={() => {
              setUpiPlan(null);
              setNote('Thanks! Your UPI payment was submitted. We verify it and email you when your plan is active.');
              void load();
            }}
          />
        )}
      </main>
    </>
  );
}
