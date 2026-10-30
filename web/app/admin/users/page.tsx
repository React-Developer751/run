'use client';

import { useMemo, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Modal } from '@/components/Modal';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { shortDay, timeAgo } from '@/lib/format';
import { usePoll, useToast } from '@/lib/hooks';
import type { AdminUser } from '@/lib/types';

export default function AdminUsers() {
  const { user: me } = useAuth();
  const { data, error, reload } = usePoll(() => api.admin.users(), 10000);
  const { toast, flash } = useToast();
  const [q, setQ] = useState('');
  const [busy, setBusy] = useState('');
  const [quota, setQuota] = useState<AdminUser | null>(null);
  const [quotaValue, setQuotaValue] = useState('');
  const [tempPassword, setTempPassword] = useState<{ email: string; password: string } | null>(null);
  const [actionError, setActionError] = useState('');

  const users = useMemo(() => (data?.users ?? []).filter((u) => `${u.name} ${u.email}`.toLowerCase().includes(q.toLowerCase())), [data, q]);

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
        <div><h1>Users</h1><p>{data ? `${data.users.length} accounts` : 'Loading…'}</p></div>
        <div className="search"><Icon name="search" /><input className="input input-sm" placeholder="Search name or email" value={q} onChange={(e) => setQ(e.target.value)} aria-label="Search users" /></div>
      </div>

      {(error || actionError) && <div className="error-box">{actionError || error}</div>}

      <div className="card table-card">
        <table className="table">
          <thead><tr><th>User</th><th>Role</th><th>Status</th><th>Plan</th><th>Projects</th><th>Last sign-in</th><th>Joined</th><th /></tr></thead>
          <tbody>
            {users.map((u) => {
              const self = u.id === me?.id;
              return (
                <tr key={u.id}>
                  <td><div className="cell-main"><b>{u.name}{self && <span className="you">you</span>}</b><small>{u.email}</small></div></td>
                  <td><span className={`badge ${u.role === 'admin' ? 'badge-busy' : 'badge-idle'}`}>{u.role}</span></td>
                  <td><span className={`badge ${u.suspended ? 'badge-bad' : 'badge-live'}`}>{u.suspended ? 'Suspended' : 'Active'}</span></td>
                  <td>
                    <select
                      className="input input-sm"
                      style={{ width: 'auto', height: 32 }}
                      value={u.plan}
                      disabled={busy !== ''}
                      aria-label={`Plan of ${u.email}`}
                      title={u.subscriptionStatus ? `Razorpay subscription: ${u.subscriptionStatus}` : 'No paid subscription'}
                      onChange={(e) => {
                        const plan = e.target.value as AdminUser['plan'];
                        if (!window.confirm(`Set ${u.email} to the ${plan} plan? This does not charge or refund anything.`)) return;
                        void act(`p${u.id}`, () => api.admin.updateUser(u.id, { plan }), 'Plan updated');
                      }}
                    >
                      <option value="free">Free</option>
                      <option value="starter">Starter</option>
                      <option value="pro">Pro</option>
                    </select>
                    {u.subscriptionStatus && <small className="dim"> · paid</small>}
                  </td>
                  <td>{u.liveProjects}/{u.projects}{u.maxProjects !== null && <small className="dim"> · limit {u.maxProjects}</small>}</td>
                  <td className="muted">{u.lastLoginAt ? timeAgo(u.lastLoginAt) : 'never'}</td>
                  <td className="muted">{shortDay(u.createdAt)}</td>
                  <td>
                    <div className="row-actions">
                      <button className="icon-btn" title={u.role === 'admin' ? 'Remove admin rights' : 'Make admin'} aria-label={u.role === 'admin' ? 'Remove admin rights' : 'Make admin'} disabled={self || busy !== ''} onClick={() => act(`r${u.id}`, () => api.admin.updateUser(u.id, { role: u.role === 'admin' ? 'user' : 'admin' }), u.role === 'admin' ? 'Admin removed' : 'Promoted to admin')}>
                        <Icon name="shield" />
                      </button>
                      <button className="icon-btn" title="Set project limit" aria-label="Set project limit" disabled={busy !== ''} onClick={() => { setQuota(u); setQuotaValue(u.maxProjects === null ? '' : String(u.maxProjects)); }}>
                        <Icon name="sliders" />
                      </button>
                      <button className="icon-btn" title={u.suspended ? 'Reactivate account' : 'Suspend account'} aria-label={u.suspended ? 'Reactivate account' : 'Suspend account'} disabled={self || busy !== ''} onClick={() => {
                        if (!u.suspended && !window.confirm(`Suspend ${u.email}? Their apps go offline and they are signed out.`)) return;
                        void act(`s${u.id}`, () => api.admin.updateUser(u.id, { suspended: !u.suspended }), u.suspended ? 'Account reactivated' : 'Account suspended');
                      }}>
                        <Icon name={u.suspended ? 'play' : 'stop'} />
                      </button>
                      <button className="icon-btn" title="Reset password" aria-label="Reset password" disabled={self || busy !== ''} onClick={async () => {
                        if (!window.confirm(`Reset the password of ${u.email}? They will be signed out everywhere.`)) return;
                        setBusy(`p${u.id}`);
                        setActionError('');
                        try {
                          const r = await api.admin.resetPassword(u.id);
                          setTempPassword({ email: u.email, password: r.password });
                        } catch (e) {
                          setActionError((e as Error).message);
                        } finally {
                          setBusy('');
                        }
                      }}>
                        <Icon name="key" />
                      </button>
                      <button className="icon-btn" title="Delete user and their projects" aria-label={`Delete ${u.email}`} disabled={self || busy !== ''} onClick={() => {
                        if (window.confirm(`Delete ${u.email} and ALL of their projects? This cannot be undone.`)) void act(`d${u.id}`, () => api.admin.deleteUser(u.id), 'User deleted');
                      }}><Icon name="trash" /></button>
                    </div>
                  </td>
                </tr>
              );
            })}
            {data && users.length === 0 && <tr><td colSpan={8} className="empty-row">No users match.</td></tr>}
          </tbody>
        </table>
      </div>

      {quota && (
        <Modal title={`Project limit · ${quota.email}`} onClose={() => setQuota(null)}>
          <div className="stack">
            <div className="field">
              <label className="label" htmlFor="q">Maximum projects for this user</label>
              <input id="q" className="input" type="number" min={0} max={100} value={quotaValue} onChange={(e) => setQuotaValue(e.target.value)} placeholder="Platform default" autoFocus />
              <span className="hint">Leave empty to use the platform default. 0 blocks new projects.</span>
            </div>
            <div className="row">
              <button className="btn btn-primary" disabled={busy !== ''} onClick={async () => {
                const v = quotaValue.trim() === '' ? null : Number(quotaValue);
                const id = quota.id;
                setQuota(null);
                await act('quota', () => api.admin.updateUser(id, { maxProjects: v }), 'Limit saved');
              }}>Save</button>
              <button className="btn" onClick={() => setQuota(null)}>Cancel</button>
            </div>
          </div>
        </Modal>
      )}
      {tempPassword && (
        <Modal title="Temporary password" onClose={() => setTempPassword(null)}>
          <div className="stack">
            <p className="muted">Give this to <b>{tempPassword.email}</b>. It is shown only once; they should change it right after signing in.</p>
            <div className="row">
              <input className="input mono" readOnly value={tempPassword.password} onFocus={(e) => e.currentTarget.select()} aria-label="Temporary password" />
              <button className="btn" onClick={() => { void navigator.clipboard?.writeText(tempPassword.password); flash('Password copied'); }}><Icon name="copy" /> Copy</button>
            </div>
            <div><button className="btn btn-primary" onClick={() => setTempPassword(null)}>Done</button></div>
          </div>
        </Modal>
      )}
      {toast}
    </div>
  );
}
