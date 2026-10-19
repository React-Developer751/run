'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { Icon } from '@/components/Icon';
import { Nav } from '@/components/Nav';
import { StatusBadge } from '@/components/StatusBadge';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';
import { repoLabel, timeAgo } from '@/lib/format';
import type { Project } from '@/lib/types';

export default function Dashboard() {
  const user = useRequireAuth();
  const [projects, setProjects] = useState<Project[] | null>(null);
  const [error, setError] = useState('');

  const anyDeploying = projects?.some((p) => p.status === 'deploying') ?? false;

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

  const live = projects?.filter((p) => p.status === 'live').length ?? 0;
  const failed = projects?.filter((p) => p.status === 'failed').length ?? 0;

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
              <div className="stats">
                <div className="card stat"><b>{projects.length}</b><span>Projects</span></div>
                <div className="card stat"><b style={{ color: 'var(--ok)' }}>{live}</b><span>Live</span></div>
                <div className="card stat"><b style={{ color: failed ? 'var(--bad)' : undefined }}>{failed}</b><span>Failed</span></div>
              </div>

              <div className="grid-projects">
                {projects.map((p) => (
                  <Link href={`/projects/${p.id}`} key={p.id} className="card card-hover project-card">
                    <header>
                      <div>
                        <h3>{p.name}</h3>
                        <span className="project-url">{p.url.replace(/^https?:\/\//, '')}</span>
                      </div>
                      <StatusBadge status={p.status} />
                    </header>
                    <div className="project-meta">
                      <span className="tag">{p.framework ?? 'Detecting…'}</span>
                      {p.kind && <span className="tag">{p.kind === 'static' ? 'Static site' : 'Web service'}</span>}
                      <span><Icon name="branch" className="icon" /> {repoLabel(p.repoUrl)}</span>
                    </div>
                    <div className="project-meta">
                      <span>{p.rootDir === '.' ? 'root folder' : `${p.rootDir}/`}</span>
                      <span>·</span>
                      <span>updated {timeAgo(p.updatedAt)}</span>
                    </div>
                  </Link>
                ))}
              </div>
            </>
          )
        )}
      </main>
    </>
  );
}
