'use client';

import { useMemo, useState } from 'react';
import { Modal } from '@/components/Modal';
import { api } from '@/lib/api';
import { shortDate, timeAgo } from '@/lib/format';
import { usePoll, useToast } from '@/lib/hooks';
import type { AdminUpiPayment } from '@/lib/types';
import { useConfirm } from '@/components/ConfirmProvider';

type Filter = 'pending' | 'approved' | 'rejected' | 'all';
const FILTERS: Array<[Filter, string]> = [['pending', 'To verify'], ['approved', 'Approved'], ['rejected', 'Rejected'], ['all', 'All']];
const STATUS: Record<AdminUpiPayment['status'], { label: string; cls: string }> = {
  pending: { label: 'To verify', cls: 'badge-busy' },
  approved: { label: 'Approved', cls: 'badge-live' },
  rejected: { label: 'Rejected', cls: 'badge-bad' },
};

export default function AdminPayments() {
  const confirm = useConfirm();
  const { data, error, reload } = usePoll(() => api.admin.payments(), 20_000);
  const [filter, setFilter] = useState<Filter>('pending');
  const [query, setQuery] = useState('');
  const [busy, setBusy] = useState('');
  const [rejecting, setRejecting] = useState<AdminUpiPayment | null>(null);
  const [reason, setReason] = useState('');
  const { toast, flash } = useToast();

  const rows = useMemo(() => {
    const q = query.trim().toLowerCase();
    return (data?.payments ?? [])
      .filter((p) => filter === 'all' || p.status === filter)
      .filter((p) => !q || `${p.utr} ${p.userEmail} ${p.userName}`.toLowerCase().includes(q));
  }, [data, filter, query]);

  const run = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try {
      await fn();
      await reload();
      window.dispatchEvent(new Event('hostx:admin-notifications'));
      flash(done);
    } catch (e) {
      flash((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const total = (data?.payments ?? []).filter((p) => p.status === 'approved').reduce((n, p) => n + p.amountInr, 0);

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>Payments</h1>
          <p>
            Direct UPI payments. Find the UTR in your bank or UPI app statement and check the amount, then approve to activate the plan for 30 days
            (the user is emailed), or reject with a reason. Razorpay payments are handled automatically and are not listed here.
          </p>
        </div>
      </div>
      {error && <div className="error-box">{error}</div>}

      <div className="list-toolbar" style={{ marginBottom: 0 }}>
        <div className="seg-filter" role="tablist" aria-label="Filter payments">
          {FILTERS.map(([id, label]) => (
            <button key={id} role="tab" aria-selected={filter === id} className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>
              {label}
              {id === 'pending' && data?.pending ? <span className="seg-count">{data.pending}</span> : null}
            </button>
          ))}
        </div>
        <div className="list-tools">
          <span className="muted" style={{ fontSize: 13.5 }}>Approved so far: <b>₹{total.toLocaleString('en-IN')}</b></span>
          <input className="input input-sm" type="search" placeholder="Search UTR or email" aria-label="Search payments" value={query} onChange={(e) => setQuery(e.target.value)} style={{ maxWidth: 240 }} />
        </div>
      </div>

      <div className="card table-card">
        <table className="table">
          <thead><tr><th>User</th><th>Plan</th><th>Amount</th><th>UTR</th><th>Submitted</th><th>Status</th><th /></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td><div className="cell-main"><b>{p.userName}</b><small>{p.userEmail}</small></div></td>
                <td style={{ textTransform: 'capitalize' }}>{p.plan}</td>
                <td><b>₹{p.amountInr.toLocaleString('en-IN')}</b></td>
                <td>
                  <span className="mono">{p.utr}</span>{' '}
                  <button className="icon-btn" aria-label="Copy UTR" onClick={() => { void navigator.clipboard?.writeText(p.utr); flash('UTR copied'); }}>⧉</button>
                </td>
                <td title={shortDate(p.createdAt)}>{timeAgo(p.createdAt)}</td>
                <td>
                  <span className={`badge ${STATUS[p.status].cls}`}>{STATUS[p.status].label}</span>
                  {p.reason && <small className="dim" style={{ display: 'block', marginTop: 4, maxWidth: 220, whiteSpace: 'normal' }}>{p.reason}</small>}
                  {p.paidUntil && <small className="dim" style={{ display: 'block', marginTop: 4 }}>until {new Date(p.paidUntil).toLocaleDateString()}</small>}
                  {p.decidedBy && <small className="dim" style={{ display: 'block' }}>by {p.decidedBy}</small>}
                </td>
                <td>
                  {p.status === 'pending' && (
                    <div className="row-actions">
                      <button
                        className="btn btn-sm btn-primary"
                        disabled={busy !== ''}
                        onClick={async () =>
                          (await confirm({
                            title: `Approve ₹${p.amountInr} from ${p.userEmail}?`,
                            message: `Only if ₹${p.amountInr} with UTR ${p.utr} is in your bank or UPI statement. ${p.plan} is activated for 30 days and the user is emailed.`,
                            confirmLabel: 'Approve',
                          })) && void run(`a${p.id}`, () => api.admin.approvePayment(p.id), 'Approved, plan activated')
                        }
                      >
                        Approve
                      </button>
                      <button className="btn btn-sm btn-danger" disabled={busy !== ''} onClick={() => { setReason(''); setRejecting(p); }}>Reject</button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
            {data && rows.length === 0 && (
              <tr><td colSpan={7} className="empty-row">{filter === 'pending' ? 'Nothing to verify right now.' : 'No payments here.'}</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {rejecting && (
        <Modal title="Reject UPI payment" onClose={() => setRejecting(null)}>
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const target = rejecting;
              setRejecting(null);
              await run(`r${target.id}`, () => api.admin.rejectPayment(target.id, reason.trim()), 'Payment rejected');
            }}
          >
            <p className="muted" style={{ fontSize: 14 }}>
              ₹{rejecting.amountInr} · UTR <span className="mono">{rejecting.utr}</span> · {rejecting.userEmail}. The user is emailed this reason. If the money did reach you, refund it.
            </p>
            <div className="field">
              <label className="label" htmlFor="reject-reason">Reason (shown to the user)</label>
              <textarea id="reject-reason" className="input" rows={3} minLength={5} maxLength={300} required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. No payment with this UTR reached our account" autoFocus />
            </div>
            <div className="row">
              <button className="btn btn-danger" disabled={reason.trim().length < 5}>Reject payment</button>
              <button type="button" className="btn" onClick={() => setRejecting(null)}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}
      {toast}
    </div>
  );
}
