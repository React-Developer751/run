'use client';

import { useMemo, useState } from 'react';
import { Stars } from '@/components/FeedbackPrompt';
import { api } from '@/lib/api';
import { shortDate, timeAgo } from '@/lib/format';
import { usePoll, useToast } from '@/lib/hooks';

type Filter = 'all' | 'featured' | 'shareable' | 'low';

export default function AdminFeedback() {
  const { data, error, reload } = usePoll(() => api.admin.feedback(), 30_000);
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState('');
  const { toast, flash } = useToast();

  const rows = useMemo(
    () =>
      (data?.feedback ?? []).filter((f) =>
        filter === 'featured' ? f.featured : filter === 'shareable' ? f.allowPublic && f.message && !f.featured : filter === 'low' ? f.rating <= 2 : true,
      ),
    [data, filter],
  );

  const run = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    try {
      await fn();
      await reload();
      flash(done);
    } catch (e) {
      flash((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const counts = useMemo(() => {
    const c = [0, 0, 0, 0, 0, 0];
    for (const f of data?.feedback ?? []) c[f.rating]++;
    return c;
  }, [data]);
  const total = data?.feedback.length ?? 0;

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>Feedback</h1>
          <p>Ratings users leave after their app goes live. Pick the ones to show on the landing page (only when the user allowed it), or delete any.</p>
        </div>
      </div>

      {error && <div className="error-box">{error}</div>}

      <div className="grid-2 kpis" style={{ gridTemplateColumns: undefined }}>
        <div className="card stat">
          <span>Average rating</span>
          <b>{data?.average ?? '—'}{data?.average ? <small style={{ fontSize: 16 }}> / 5</small> : null}</b>
          <small>{total} response{total === 1 ? '' : 's'} · {data?.featured ?? 0} on the landing page</small>
        </div>
        <div className="card stack" style={{ gap: 6 }}>
          {[5, 4, 3, 2, 1].map((n) => (
            <div key={n} className="row" style={{ gap: 10, alignItems: 'center' }}>
              <span style={{ width: 28, fontSize: 13 }}>{n}★</span>
              <div className="usage-bar" style={{ flex: 1 }}><i style={{ width: `${total ? (counts[n]! / total) * 100 : 0}%`, background: n >= 4 ? 'var(--ok)' : n === 3 ? 'var(--warn)' : 'var(--bad)' }} /></div>
              <span className="mono" style={{ width: 28, textAlign: 'right', fontSize: 13 }}>{counts[n]}</span>
            </div>
          ))}
        </div>
      </div>

      <div className="seg-filter" role="tablist" aria-label="Filter feedback">
        {([['all', 'All'], ['featured', 'On landing page'], ['shareable', 'Can be shown'], ['low', '1–2 stars']] as Array<[Filter, string]>).map(([id, label]) => (
          <button key={id} role="tab" aria-selected={filter === id} className={filter === id ? 'on' : ''} onClick={() => setFilter(id)}>{label}</button>
        ))}
      </div>

      <div className="card" style={{ padding: 0 }}>
        {rows.map((f) => (
          <div key={f.id} className="notif">
            <div className="notif-body">
              <div className="row" style={{ justifyContent: 'space-between', flexWrap: 'wrap', alignItems: 'baseline' }}>
                <span className="row" style={{ gap: 10, alignItems: 'center' }}>
                  <Stars value={f.rating} />
                  <b>{f.userName}</b>
                  <small className="dim">{f.userEmail}</small>
                </span>
                <small className="dim" title={shortDate(f.updatedAt)}>{timeAgo(f.updatedAt)}</small>
              </div>
              <p style={{ whiteSpace: 'pre-wrap' }}>{f.message || <i className="dim">No message, rating only.</i>}</p>
              <div className="row" style={{ gap: 12, fontSize: 13, flexWrap: 'wrap', alignItems: 'center' }}>
                {f.projectName && <span className="tag">{f.projectName}</span>}
                {f.featured && <span className="badge badge-live">On landing page as “{f.publicName}”</span>}
                {!f.allowPublic && <span className="badge badge-idle">Private (user did not allow sharing)</span>}
                {f.allowPublic && f.message && (
                  <button
                    className="link-btn"
                    disabled={busy !== ''}
                    onClick={() => run(`f${f.id}`, () => api.admin.featureFeedback(f.id, !f.featured), f.featured ? 'Removed from the landing page' : 'Shown on the landing page')}
                  >
                    {f.featured ? 'Remove from landing page' : 'Show on landing page'}
                  </button>
                )}
                <button
                  className="link-btn"
                  style={{ color: 'var(--bad)' }}
                  disabled={busy !== ''}
                  onClick={() => window.confirm('Delete this feedback permanently?') && void run(`d${f.id}`, () => api.admin.deleteFeedback(f.id), 'Feedback deleted')}
                >
                  Delete
                </button>
              </div>
            </div>
          </div>
        ))}
        {data && rows.length === 0 && <div className="empty-row" style={{ padding: 28, textAlign: 'center' }}>No feedback{filter !== 'all' ? ' for this filter' : ' yet'}.</div>}
      </div>
      {toast}
    </div>
  );
}
