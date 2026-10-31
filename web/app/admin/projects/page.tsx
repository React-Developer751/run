'use client';

import { useEffect, useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';
import { LogModal } from '@/components/LogModal';
import { Modal } from '@/components/Modal';
import { StatusBadge } from '@/components/StatusBadge';
import { api } from '@/lib/api';
import { repoLabel, timeAgo } from '@/lib/format';
import { usePoll, useToast } from '@/lib/hooks';
import type { AdminProject, ProjectStatus } from '@/lib/types';

const FILTERS: Array<ProjectStatus | 'all'> = ['all', 'live', 'deploying', 'crashed', 'failed', 'stopped', 'paused', 'archived', 'suspended'];

export default function AdminProjects() {
  const { data, error, reload } = usePoll(() => api.admin.projects(), 6000);
  const { toast, flash } = useToast();
  const [q, setQ] = useState('');
  // Links from Admin → Notifications open this page pre-filtered (?q=<project name>).
  useEffect(() => {
    const preset = new URLSearchParams(window.location.search).get('q');
    if (preset) setQ(preset);
  }, []);
  const [status, setStatus] = useState<ProjectStatus | 'all'>('all');
  const [busy, setBusy] = useState('');
  const [logs, setLogs] = useState<AdminProject | null>(null);
  const [suspending, setSuspending] = useState<AdminProject | null>(null);
  const [reason, setReason] = useState('');
  const [actionError, setActionError] = useState('');

  const rows = useMemo(
    () => (data?.projects ?? []).filter((p) => (status === 'all' || p.status === status) && `${p.name} ${p.slug} ${p.owner.email} ${p.repoUrl}`.toLowerCase().includes(q.toLowerCase())),
    [data, q, status],
  );

  const act = async (key: string, fn: () => Promise<unknown>, done: string) => {
    setBusy(key);
    setActionError('');
    try {
      await fn();
      flash(done);
      await reload();
    } catch (e) {
      setActionError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div><h1>Projects</h1><p>{data ? `${data.projects.length} projects across all users` : 'Loading…'}</p></div>
        <div className="search"><Icon name="search" /><input className="input input-sm" placeholder="Search project, owner or repo" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search projects" /></div>
      </div>

      <div className="seg-filter" role="tablist">
        {FILTERS.map((f) => <button key={f} role="tab" aria-selected={status === f} className={status === f ? 'on' : ''} onClick={() => setStatus(f)}>{f}</button>)}
      </div>

      {(error || actionError) && <div className="error-box">{actionError || error}</div>}

      <div className="card table-card">
        <table className="table">
          <thead><tr><th>Project</th><th>Owner</th><th>Status</th><th>Runtime</th><th>Updated</th><th /></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id}>
                <td>
                  <div className="cell-main">
                    <b>{p.name}</b>
                    <a className="mono link" href={p.url} target="_blank" rel="noreferrer">{p.url.replace(/^https?:\/\//, '')}</a>
                    <small>{repoLabel(p.repoUrl)}{p.rootDir !== '.' ? ` · ${p.rootDir}/` : ''}</small>
                  </div>
                </td>
                <td><div className="cell-main"><b>{p.owner.name}</b><small>{p.owner.email}</small></div></td>
                <td>
                  <StatusBadge status={p.status} />
                  {p.suspendedReason && <small className="dim" style={{ display: 'block', marginTop: 6, maxWidth: 220, whiteSpace: 'normal' }}>{p.suspendedReason}</small>}
                </td>
                <td className="muted">{p.framework ?? '—'}<br /><small className="dim">{p.runtime ?? 'not deployed'} · :{p.port}</small></td>
                <td className="muted">{timeAgo(p.updatedAt)}</td>
                <td>
                  <div className="row-actions">
                    <button className="btn btn-sm" onClick={() => setLogs(p)}><Icon name="terminal" /> Logs</button>
                    {p.status === 'suspended' ? (
                      <button
                        className="btn btn-sm"
                        disabled={busy !== ''}
                        onClick={() => window.confirm(`Lift the suspension of "${p.name}"? It starts again if it was deployed, and the owner is emailed.`) && void act(`u${p.id}`, () => api.admin.unsuspendProject(p.id), 'Suspension lifted')}
                      >
                        Unsuspend
                      </button>
                    ) : (
                      <button className="btn btn-sm" title="Suspend: offline until an admin lifts it" disabled={busy !== ''} onClick={() => { setReason(''); setSuspending(p); }}>
                        <Icon name="shield" /> Suspend
                      </button>
                    )}
                    <button className="icon-btn" title="Redeploy" aria-label="Redeploy" disabled={busy !== '' || p.status === 'deploying' || p.status === 'suspended'} onClick={() => act(`d${p.id}`, () => api.admin.redeployProject(p.id), 'Redeploy started')}><Icon name="refresh" /></button>
                    {(p.status === 'stopped' || p.status === 'paused') && (
                      <button className="icon-btn" title={p.status === 'paused' ? 'Resume' : 'Start'} aria-label={p.status === 'paused' ? 'Resume' : 'Start'} disabled={busy !== ''} onClick={() => act(`a${p.id}`, () => api.admin.startProject(p.id), 'Started')}><Icon name="play" /></button>
                    )}
                    {(p.status === 'live' || p.status === 'crashed') && (
                      <button className="icon-btn" title="Stop" aria-label="Stop" disabled={busy !== ''} onClick={() => act(`o${p.id}`, () => api.admin.stopProject(p.id), 'Stopped')}><Icon name="stop" /></button>
                    )}
                    <button className="icon-btn" aria-label={`Delete ${p.name}`} disabled={busy !== '' || p.status === 'deploying'} onClick={() => {
                      if (window.confirm(`Delete "${p.name}" owned by ${p.owner.email}? This cannot be undone.`)) void act(`x${p.id}`, () => api.admin.deleteProject(p.id), 'Project deleted');
                    }}><Icon name="trash" /></button>
                  </div>
                </td>
              </tr>
            ))}
            {data && rows.length === 0 && <tr><td colSpan={6} className="empty-row">No projects match.</td></tr>}
          </tbody>
        </table>
      </div>

      {suspending && (
        <Modal title={`Suspend ${suspending.name}`} onClose={() => setSuspending(null)}>
          <form
            className="stack"
            onSubmit={async (e) => {
              e.preventDefault();
              const target = suspending;
              setSuspending(null);
              await act(`s${target.id}`, () => api.admin.suspendProject(target.id, reason.trim()), `${target.name} suspended`);
            }}
          >
            <p className="muted" style={{ fontSize: 14 }}>
              The app goes offline now and visitors see a &ldquo;suspended&rdquo; page. {suspending.owner.email} cannot start, redeploy or roll it back until you lift
              the suspension, and is emailed the reason below. Nothing is deleted. Their other projects keep running.
            </p>
            <div className="field">
              <label className="label" htmlFor="suspend-reason">Reason (shown to the owner)</label>
              <textarea id="suspend-reason" className="input" rows={3} minLength={5} maxLength={300} required value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Phishing page imitating a bank (Acceptable Use Policy)" autoFocus />
            </div>
            <div className="row">
              <button className="btn btn-danger" disabled={reason.trim().length < 5}>Suspend app</button>
              <button type="button" className="btn" onClick={() => setSuspending(null)}>Cancel</button>
            </div>
          </form>
        </Modal>
      )}
      {logs && <LogModal projectId={logs.id} deploymentId={logs.currentDeploymentId} title={`${logs.name} · logs`} onClose={() => setLogs(null)} />}
      {toast}
    </div>
  );
}
