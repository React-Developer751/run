'use client';

import { api } from '@/lib/api';
import { shortDate } from '@/lib/format';
import { usePoll } from '@/lib/hooks';

export default function AdminAudit() {
  const { data, error } = usePoll(() => api.admin.audit(), 10000);
  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head" style={{ marginBottom: 0 }}><div><h1>Audit log</h1><p>Every administrative action: who did what, and when.</p></div></div>
      {error && <div className="error-box">{error}</div>}
      <div className="card table-card">
        <table className="table">
          <thead><tr><th>When</th><th>Admin</th><th>Action</th><th>Target</th><th>Details</th></tr></thead>
          <tbody>
            {data?.entries.map((e) => (
              <tr key={e.id}>
                <td className="muted">{shortDate(e.at)}</td>
                <td>{e.actorEmail}</td>
                <td><span className="tag mono">{e.action}</span></td>
                <td className="mono">{e.target}</td>
                <td className="muted">{e.detail || '—'}</td>
              </tr>
            ))}
            {data && data.entries.length === 0 && <tr><td colSpan={5} className="empty-row">No admin actions recorded yet.</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
