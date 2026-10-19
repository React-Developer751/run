'use client';

import { useMemo, useState } from 'react';
import { LogModal } from '@/components/LogModal';
import { StatusBadge } from '@/components/StatusBadge';
import { api } from '@/lib/api';
import { shortDate, timeAgo, triggerLabel } from '@/lib/format';
import { usePoll } from '@/lib/hooks';
import type { AdminDeployment } from '@/lib/types';

export default function AdminDeployments() {
  const { data, error } = usePoll(() => api.admin.deployments(), 5000);
  const [failedOnly, setFailedOnly] = useState(false);
  const [open, setOpen] = useState<AdminDeployment | null>(null);
  const rows = useMemo(() => (data?.deployments ?? []).filter((d) => !failedOnly || d.status === 'failed'), [data, failedOnly]);

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><h1>Deployments</h1><p>Latest 100 deployments across the platform. Refreshes automatically.</p></div>
        <label className="check compact"><input type="checkbox" checked={failedOnly} onChange={(e) => setFailedOnly(e.target.checked)} /><span><b>Failed only</b></span></label>
      </div>
      {error && <div className="error-box">{error}</div>}
      <div className="card table-card">
        <table className="table">
          <thead><tr><th>Project</th><th>Owner</th><th>Status</th><th>Trigger</th><th>Commit</th><th>When</th></tr></thead>
          <tbody>
            {rows.map((d) => (
              <tr key={d.id} className="clickable" onClick={() => setOpen(d)} tabIndex={0} onKeyDown={(e) => e.key === 'Enter' && setOpen(d)}>
                <td><div className="cell-main"><b>{d.projectName}</b><small className="mono">{d.slug}</small></div></td>
                <td className="muted">{d.owner}</td>
                <td><StatusBadge status={d.status} /></td>
                <td className="muted">{triggerLabel(d.trigger)}</td>
                <td className="mono muted">{d.commit ?? '—'}</td>
                <td className="muted" title={shortDate(d.createdAt)}>{timeAgo(d.createdAt)}</td>
              </tr>
            ))}
            {data && rows.length === 0 && <tr><td colSpan={6} className="empty-row">Nothing here yet.</td></tr>}
          </tbody>
        </table>
      </div>
      {open && <LogModal projectId={open.projectId} deploymentId={open.id} title={`${open.projectName} · ${open.id}`} onClose={() => setOpen(null)} />}
    </div>
  );
}
