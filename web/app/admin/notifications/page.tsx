'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { api } from '@/lib/api';
import { shortDate, timeAgo } from '@/lib/format';
import { usePoll, useToast } from '@/lib/hooks';
import type { AdminNotification, StorageReport } from '@/lib/types';

const KIND_LABEL: Record<AdminNotification['kind'], string> = {
  'deploy-failed': 'Deploy failed',
  'disk-near-full': 'Disk almost full',
};

type Filter = 'all' | 'unread' | AdminNotification['kind'];

const gb = (mb: number) => (mb >= 1024 ? `${(mb / 1024).toFixed(1)} GB` : `${mb} MB`);
const barTone = (pct: number, warn: number) => (pct >= 95 ? 'var(--bad)' : pct >= warn ? 'var(--warn)' : 'var(--accent)');

function Bar({ pct, warn }: { pct: number; warn: number }) {
  return <div className="usage-bar"><i style={{ width: `${Math.min(100, pct)}%`, background: barTone(pct, warn) }} /></div>;
}

function StorageCard() {
  const { data, error, reload } = usePoll(() => api.admin.storage(), 60_000);
  const [busy, setBusy] = useState(false);
  const [checkError, setCheckError] = useState('');
  const [fresh, setFresh] = useState<StorageReport | null>(null);
  const report = fresh ?? data;

  const checkNow = async () => {
    setBusy(true);
    setCheckError('');
    try {
      setFresh(await api.admin.checkStorage());
      await reload();
      window.dispatchEvent(new Event('hostx:admin-notifications'));
    } catch (e) {
      setCheckError((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card stack">
      <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
        <div>
          <h3 style={{ fontSize: 17 }}>Storage</h3>
          <p className="muted" style={{ fontSize: 13.5 }}>
            Checked every 10 minutes{report?.checkedAt ? ` · last ${timeAgo(report.checkedAt)}` : ' · first check runs a minute after start'}. Alerts at 85% and 95% full.
          </p>
        </div>
        <button className="btn btn-sm" onClick={checkNow} disabled={busy}>{busy ? <span className="spinner" /> : 'Check now'}</button>
      </div>
      {(checkError || error) && <div className="error-box">{checkError || error}</div>}
      {report?.disks.map((d) => (
        <div key={d.mount} className="stack" style={{ gap: 6 }}>
          <div className="row" style={{ justifyContent: 'space-between' }}>
            <span>Disk <span className="mono">{d.mount}</span></span>
            <span className="mono">{d.usedPercent}% · {gb(d.freeMb)} free of {gb(d.totalMb)}</span>
          </div>
          <Bar pct={d.usedPercent} warn={85} />
        </div>
      ))}
    </div>
  );
}

export default function AdminNotifications() {
  const { data, error, reload } = usePoll(() => api.admin.notifications(200), 15_000);
  const [filter, setFilter] = useState<Filter>('all');
  const { toast, flash } = useToast();

  const rows = useMemo(
    () => (data?.notifications ?? []).filter((n) => (filter === 'all' ? true : filter === 'unread' ? !n.readAt : n.kind === filter)),
    [data, filter],
  );

  const markRead = async (ids?: string[]) => {
    try {
      const r = await api.admin.readNotifications(ids);
      await reload();
      window.dispatchEvent(new Event('hostx:admin-notifications'));
      if (!ids) flash(`${r.marked} marked as read`);
    } catch (e) {
      flash((e as Error).message);
    }
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>Notifications</h1>
          <p>Failed deployments and server disks running out of space. Admins are also emailed (at most once an hour per project).</p>
        </div>
        <button className="btn" disabled={!data?.unread} onClick={() => markRead()}>Mark all read{data?.unread ? ` (${data.unread})` : ''}</button>
      </div>

      <StorageCard />

      {error && <div className="error-box">{error}</div>}

      <div className="row" style={{ flexWrap: 'wrap' }}>
        {(['all', 'unread', 'deploy-failed', 'disk-near-full'] as Filter[]).map((f) => (
          <button key={f} className={`btn btn-sm ${filter === f ? 'btn-primary' : ''}`} onClick={() => setFilter(f)}>
            {f === 'all' ? 'All' : f === 'unread' ? 'Unread' : KIND_LABEL[f]}
          </button>
        ))}
      </div>

      <div className="card" style={{ padding: 0 }}>
        {rows.map((n) => (
          <div key={n.id} className={`notif ${n.readAt ? '' : 'unread'}`}>
            <span className={`notif-dot ${n.severity}`} title={n.severity} />
            <div className="notif-body">
              <div className="row" style={{ justifyContent: 'space-between', alignItems: 'baseline', flexWrap: 'wrap' }}>
                <b>{n.title}</b>
                <small className="dim" title={shortDate(n.at)}>{timeAgo(n.at)}</small>
              </div>
              <p>{n.message}</p>
              <div className="row" style={{ gap: 12, fontSize: 13 }}>
                <span className={`badge ${n.severity === 'critical' ? 'badge-bad' : 'badge-busy'}`}>{KIND_LABEL[n.kind] ?? n.kind}</span>
                {n.projectName && <Link href={`/admin/projects?q=${encodeURIComponent(n.projectName)}`}>View project</Link>}
                {!n.readAt && <button className="link-btn" onClick={() => markRead([n.id])}>Mark read</button>}
              </div>
            </div>
          </div>
        ))}
        {data && rows.length === 0 && <div className="empty-row" style={{ padding: 28, textAlign: 'center' }}>No notifications{filter !== 'all' ? ' for this filter' : ' yet'}.</div>}
      </div>
      {toast}
    </div>
  );
}
