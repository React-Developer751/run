'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Icon } from '@/components/Icon';
import { Nav } from '@/components/Nav';
import { StatusBadge } from '@/components/StatusBadge';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';
import { repoLabel, timeAgo } from '@/lib/format';
import type { Project } from '@/lib/types';

type FilterId = 'all' | 'active' | 'paused' | 'archived' | 'failed';
type TypeFilter = 'all' | 'node' | 'static';

const FILTERS: Array<{ id: FilterId; label: string; test: (p: Project) => boolean }> = [
  { id: 'all', label: 'All', test: () => true },
  { id: 'active', label: 'Active', test: (p) => p.status === 'live' || p.status === 'deploying' },
  { id: 'paused', label: 'Paused / stopped', test: (p) => p.status === 'paused' || p.status === 'stopped' },
  { id: 'archived', label: 'Archived', test: (p) => p.status === 'archived' },
  { id: 'failed', label: 'Failed', test: (p) => p.status === 'failed' || p.status === 'crashed' },
];
const FILTER_KEY = 'hostx:dashboard-filter';
// Detected type, or the one chosen when creating it (before the first successful build).
const kindOf = (p: Project) => p.kind ?? p.config.kind ?? 'node';

export default function Dashboard() {
  const user = useRequireAuth();
  const router = useRouter();
  const [filter, setFilterState] = useState<FilterId>('all');
  const [type, setType] = useState<TypeFilter>('all');
  const [query, setQuery] = useState('');
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState('');

  const anyDeploying = projects?.some((p) => p.status === 'deploying') ?? false;

  // Remember the chosen tab per browser (?filter=failed in the URL wins, e.g. from a link).
  useEffect(() => {
    try {
      const fromUrl = new URLSearchParams(window.location.search).get('filter');
      const saved = fromUrl ?? window.localStorage.getItem(FILTER_KEY);
      if (saved && FILTERS.some((f) => f.id === saved)) setFilterState(saved as FilterId);
    } catch {
      /* storage blocked */
    }
  }, []);
  const setFilter = (f: FilterId) => {
    setFilterState(f);
    try {
      window.localStorage.setItem(FILTER_KEY, f);
    } catch {
      /* storage blocked */
    }
  };

  const rows = useMemo(() => {
    const test = FILTERS.find((f) => f.id === filter)?.test ?? (() => true);
    const q = query.trim().toLowerCase();
    return (projects ?? [])
      .filter((p) => test(p) && (type === 'all' || kindOf(p) === type))
      .filter((p) => !q || `${p.name} ${p.slug} ${p.repoUrl} ${p.framework ?? ''} ${p.url}`.toLowerCase().includes(q))
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  }, [projects, filter, type, query]);

  useEffect(() => {
    if (!user) return;
    let cancelled = false;
    const load = () =>
      api
        .projects()
        .then((r) => !cancelled && (setProjects(r.projects), setError('')))
        .catch((e: Error) => !cancelled && setError(e.message));
    void load();
    const timer = setInterval(load, anyDeploying ? 2500 : 10000);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [user, anyDeploying]);

  if (!user) return <><Nav variant="app" /><div className="center-screen"><span className="spinner" /></div></>;

  const paused = projects?.filter((p) => p.status === 'paused').length ?? 0;
  const archived = projects?.filter((p) => p.status === 'archived').length ?? 0;

  return (
    <>
      <Nav variant="app" />
      <main className="container page">
        <div className="page-head">
          <div>
            <h1>Hi {user.name.split(' ')[0]}, <span className="serif grad-text">your projects</span></h1>
            <p>Everything you have deployed with HostX.</p>
          </div>
          <Link href="/new" className="btn btn-primary"><Icon name="plus" /> New deploy</Link>
        </div>

        {error && <div className="error-box" style={{ marginBottom: 20 }}>{error}</div>}

        {projects === null && !error ? (
          <div className="center-screen"><span className="spinner" /></div>
        ) : projects && projects.length === 0 ? (
          <div className="empty">
            <Icon name="box" className="icon" />
            <h3>No projects yet</h3>
            <p>Paste a GitHub link and ship your first app in a few minutes.</p>
            <Link href="/new" className="btn btn-primary"><Icon name="plus" /> Deploy your first repo</Link>
          </div>
        ) : (
          projects && (
            <>
              {paused > 0 && (
                <div className="notice-box" style={{ marginBottom: 16 }}>
                  {paused} app{paused > 1 ? 's are' : ' is'} paused because nobody visited {paused > 1 ? 'them' : 'it'} for a while. Open the project and click Resume to bring it back in seconds.
                </div>
              )}
              {archived > 0 && (
                <div className="notice-box" style={{ marginBottom: 16 }}>
                  {archived} app{archived > 1 ? 's were' : ' was'} archived after a long time without visits. Settings, env vars and URL are kept: open the project and click Restore to rebuild it from GitHub.
                </div>
              )}
              <div className="list-toolbar">
                <div className="seg-filter" role="tablist" aria-label="Filter projects">
                  {FILTERS.map((f) => (
                    <button key={f.id} type="button" role="tab" aria-selected={filter === f.id} className={filter === f.id ? 'on' : ''} onClick={() => setFilter(f.id)}>
                      {f.label} <span className="seg-count">{projects.filter(f.test).length}</span>
                    </button>
                  ))}
                </div>
                <div className="list-tools">
                  <select className="input input-sm" aria-label="Service type" value={type} onChange={(e) => setType(e.target.value as TypeFilter)}>
                    <option value="all">All types</option>
                    <option value="node">Web Services</option>
                    <option value="static">Static Sites</option>
                  </select>
                  <div className="search-box">
                    <Icon name="search" className="icon" />
                    <input className="input input-sm" type="search" placeholder="Search services" aria-label="Search services" value={query} onChange={(e) => setQuery(e.target.value)} />
                  </div>
                </div>
              </div>

              <div className="card table-card">
                <table className="table services-table">
                  <thead>
                    <tr><th>Service name</th><th>Status</th><th>Type</th><th>Runtime</th><th>Repository</th><th>Updated</th></tr>
                  </thead>
                  <tbody>
                    {rows.map((p) => (
                      <tr
                        key={p.id}
                        className="clickable"
                        tabIndex={0}
                        onClick={() => router.push(`/projects/${p.id}`)}
                        onKeyDown={(e) => { if (e.key === 'Enter') router.push(`/projects/${p.id}`); }}
                      >
                        <td>
                          <div className="cell-main">
                            <Link href={`/projects/${p.id}`} className="svc-name" onClick={(e) => e.stopPropagation()}>{p.name}</Link>
                            <small className="mono">{p.url.replace(/^https?:\/\//, '')}</small>
                          </div>
                        </td>
                        <td><StatusBadge status={p.status} /></td>
                        <td>
                          <span className="type-cell">
                            <Icon name={kindOf(p) === 'static' ? 'globe' : 'terminal'} className="icon" />
                            {kindOf(p) === 'static' ? 'Static Site' : 'Web Service'}
                          </span>
                        </td>
                        <td>{p.framework ?? (p.status === 'deploying' ? 'Detecting…' : p.kind === 'static' ? 'Static' : 'Node.js')}</td>
                        <td>
                          <div className="cell-main">
                            <span>{repoLabel(p.repoUrl)}</span>
                            <small><Icon name="branch" className="icon" /> {p.branch ?? 'default branch'}{p.rootDir !== '.' ? ` · ${p.rootDir}/` : ''}</small>
                          </div>
                        </td>
                        <td title={new Date(p.updatedAt).toLocaleString()}>{timeAgo(p.updatedAt)}</td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={6} className="empty-row" style={{ textAlign: 'center', padding: 32 }}>
                          No services match{filter !== 'all' ? ` “${FILTERS.find((f) => f.id === filter)?.label}”` : ''}{query ? ` and “${query}”` : ''}.{' '}
                          <button type="button" className="link-btn" onClick={() => { setFilter('all'); setType('all'); setQuery(''); }}>Clear filters</button>
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </>
          )
        )}
      </main>
    </>
  );
}
