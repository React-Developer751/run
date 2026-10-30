'use client';

import { useState, type FormEvent } from 'react';
import { api } from '@/lib/api';
import { timeAgo } from '@/lib/format';
import type { Project } from '@/lib/types';
import { Icon } from './Icon';

/** Custom domains of one project: add, DNS instructions, verify, remove. */
export function DomainsPanel({ project, onChange, flash }: { project: Project; onChange: (p: Project) => void; flash: (msg: string) => void }) {
  const [domain, setDomain] = useState('');
  const [busy, setBusy] = useState('');
  const [error, setError] = useState('');

  const run = async (key: string, fn: () => Promise<{ project: Project }>, done?: string) => {
    setBusy(key);
    setError('');
    try {
      onChange((await fn()).project);
      if (done) flash(done);
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const add = (e: FormEvent) => {
    e.preventDefault();
    void run('add', () => api.addDomain(project.id, domain.trim()), 'Domain added').then(() => setDomain(''));
  };

  const copy = (v: string) => {
    void navigator.clipboard?.writeText(v);
    flash('Copied');
  };

  return (
    <div className="stack" style={{ maxWidth: 860 }}>
      <form className="card stack" onSubmit={add}>
        <div>
          <h3 style={{ fontSize: 18 }}>Custom domains</h3>
          <p className="muted" style={{ marginTop: 6 }}>Serve this app on your own domain, e.g. <span className="mono">www.myshop.com</span>. HTTPS certificates are issued automatically.</p>
        </div>
        <div className="row">
          <input className="input" placeholder="www.example.com" value={domain} onChange={(e) => setDomain(e.target.value)} spellCheck={false} aria-label="Domain" required />
          <button className="btn btn-primary" disabled={busy !== '' || !domain.trim()}>{busy === 'add' ? <span className="spinner" /> : 'Add domain'}</button>
        </div>
        {error && <div className="error-box" role="alert">{error}</div>}
      </form>

      {project.domains.map((d) => (
        <div key={d.name} className="card stack" style={{ gap: 14 }}>
          <div className="row" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
            <div className="row" style={{ alignItems: 'center', gap: 10 }}>
              {d.verified ? (
                <a className="project-url" href={d.url} target="_blank" rel="noreferrer">{d.name} <Icon name="external" /></a>
              ) : (
                <b className="mono">{d.name}</b>
              )}
              <span className={`badge ${d.verified ? 'badge-live' : 'badge-busy'}`}>{d.verified ? 'Verified' : 'Waiting for DNS'}</span>
              {d.verified && d.dns === 'not-pointing' && <span className="badge badge-bad">Not pointing here</span>}
            </div>
            <div className="row">
              <button className="btn btn-sm" disabled={busy !== ''} onClick={() => run(`v${d.name}`, () => api.verifyDomain(project.id, d.name))}>
                {busy === `v${d.name}` ? <span className="spinner" /> : <Icon name="refresh" />} Check now
              </button>
              <button
                className="btn btn-sm btn-danger"
                disabled={busy !== ''}
                onClick={() => window.confirm(`Remove ${d.name}? It stops serving this app immediately.`) && run(`r${d.name}`, () => api.removeDomain(project.id, d.name), 'Domain removed')}
              >
                <Icon name="trash" /> Remove
              </button>
            </div>
          </div>

          {(!d.verified || d.dns !== 'ok') && (
            <>
              <p className="muted" style={{ fontSize: 14 }}>
                Add these records at your domain provider (GoDaddy, Hostinger, Cloudflare…). {d.verified ? 'Ownership is verified; point the domain here to start serving.' : 'We check automatically every few minutes.'}
              </p>
              <div className="table-card" style={{ overflowX: 'auto' }}>
                <table className="table">
                  <thead><tr><th>Type</th><th>Name / Host</th><th>Value</th><th /></tr></thead>
                  <tbody>
                    {d.records.filter((r) => !(d.verified && r.type === 'TXT')).map((r) => (
                      <tr key={r.type}>
                        <td><span className="badge badge-idle">{r.type}</span></td>
                        <td className="mono" style={{ wordBreak: 'break-all' }}>{r.name}</td>
                        <td className="mono" style={{ wordBreak: 'break-all' }}>{r.value}</td>
                        <td><button type="button" className="btn btn-sm" onClick={() => copy(r.value)}><Icon name="copy" /></button></td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              {d.records.some((r) => r.type === 'CNAME') && d.name.split('.').length === 2 && (
                <p className="hint">Root domains (without www) cannot use CNAME at most providers. Use <span className="mono">www.{d.name}</span> instead, or a provider that supports ALIAS/flattening (e.g. Cloudflare).</p>
              )}
            </>
          )}
          {d.lastError && !d.verified && <div className="hint">{d.lastError}</div>}
          {d.lastCheckedAt && <small className="dim">Last checked {timeAgo(d.lastCheckedAt)}</small>}
        </div>
      ))}
    </div>
  );
}
