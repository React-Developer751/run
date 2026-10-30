'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { BuildSettings } from '@/components/BuildSettings';
import { EnvEditor, envFromRows, rowsFromEnv, type EnvRow } from '@/components/EnvEditor';
import { Icon } from '@/components/Icon';
import { LogViewer } from '@/components/LogViewer';
import { Nav } from '@/components/Nav';
import { StatusBadge, isBusy } from '@/components/StatusBadge';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';
import { repoLabel, timeAgo, triggerLabel } from '@/lib/format';
import type { BuildConfig, Deployment, Project, ProjectEvent } from '@/lib/types';

const EVENT_ICON: Record<ProjectEvent['kind'], string> = { crash: '🔴', restart: '🟠', recovered: '🟢', rollback: '↩️' };

type Tab = 'deployments' | 'runtime' | 'env' | 'database' | 'settings';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'deployments', label: 'Deployments' },
  { id: 'runtime', label: 'Runtime logs' },
  { id: 'env', label: 'Environment' },
  { id: 'database', label: 'Database' },
  { id: 'settings', label: 'Settings' },
];

/** Polls one deployment's build log until it reaches a final state. */
function BuildLogs({ projectId, deployment, onFinished }: { projectId: string; deployment: Deployment; onFinished: () => void }) {
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState(deployment.status);
  const finished = useRef(onFinished);
  finished.current = onFinished;

  useEffect(() => {
    let cancelled = false;
    let next = 0;
    let timer: ReturnType<typeof setTimeout>;
    setLines([]);

    const tick = async () => {
      try {
        const r = await api.deploymentLogs(projectId, deployment.id, next);
        if (cancelled) return;
        next = r.next;
        if (r.lines.length) setLines((prev) => [...prev, ...r.lines]);
        setStatus(r.status);
        if (r.status === 'live' || r.status === 'failed') {
          finished.current();
          return;
        }
      } catch {
        /* transient error: retry on the next tick */
      }
      timer = setTimeout(tick, 1000);
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [projectId, deployment.id]);

  return <LogViewer title={`deployment ${deployment.id}`} lines={lines} footer={<StatusBadge status={status} />} />;
}

export default function ProjectPage() {
  const user = useRequireAuth();
  const router = useRouter();
  const { id } = useParams<{ id: string }>();

  const [project, setProject] = useState<Project | null>(null);
  const [deployments, setDeployments] = useState<Deployment[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const [tab, setTab] = useState<Tab>('deployments');
  const [error, setError] = useState('');
  const [toast, setToast] = useState('');
  const [busy, setBusy] = useState('');
  const [envRows, setEnvRows] = useState<EnvRow[]>([]);
  const [envDirty, setEnvDirty] = useState(false);
  const [name, setName] = useState('');
  const [cfg, setCfg] = useState<BuildConfig | null>(null);
  const [cfgInitial, setCfgInitial] = useState<BuildConfig | null>(null);
  const [runtimeLogs, setRuntimeLogs] = useState<string[]>([]);
  const [events, setEvents] = useState<ProjectEvent[]>([]);
  const [databasesOn, setDatabasesOn] = useState(false);
  const [showUri, setShowUri] = useState(false);

  useEffect(() => {
    api.health().then((h) => setDatabasesOn(Boolean(h.databases))).catch(() => undefined);
  }, []);

  const flash = (message: string) => {
    setToast(message);
    setTimeout(() => setToast(''), 2600);
  };

  const load = useCallback(async () => {
    try {
      const r = await api.project(id);
      setProject(r.project);
      setDeployments(r.deployments);
      setSelected((cur) => cur ?? r.project.currentDeploymentId ?? r.deployments[0]?.id ?? null);
      setError('');
    } catch (e) {
      setError((e as Error).message);
    }
  }, [id]);

  useEffect(() => {
    if (user) void load();
  }, [user, load]);

  // Fill the editors only once, then leave them alone so polling never overwrites typing.
  const seeded = useRef(false);
  useEffect(() => {
    if (project && !seeded.current) {
      seeded.current = true;
      setEnvRows(rowsFromEnv(project.env));
      setName(project.name);
      const initial: BuildConfig = {
        rootDir: project.rootDir,
        kind: project.config.kind ?? project.kind ?? 'node',
        buildCommand: project.config.buildCommand ?? '',
        startCommand: project.config.startCommand ?? (project.kind === 'static' ? '' : 'npm start'),
        outputDir: project.config.outputDir ?? 'dist',
      };
      setCfg(initial);
      setCfgInitial(initial);
    }
  }, [project]);

  const deploying = project ? isBusy(project.status) : false;
  useEffect(() => {
    if (!deploying) return;
    const t = setInterval(load, 2000);
    return () => clearInterval(t);
  }, [deploying, load]);

  useEffect(() => {
    if (tab !== 'runtime' || !user) return;
    let cancelled = false;
    const fetchLogs = () => {
      void api.events(id).then((r) => !cancelled && setEvents(r.events)).catch(() => undefined);
      return api.runtimeLogs(id).then((r) => !cancelled && setRuntimeLogs(r.logs ? r.logs.split('\n') : [])).catch(() => undefined);
    };
    void fetchLogs();
    const t = setInterval(fetchLogs, 4000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [tab, id, user]);

  const act = async (key: string, fn: () => Promise<unknown>, done?: string) => {
    setBusy(key);
    setError('');
    try {
      await fn();
      if (done) flash(done);
      await load();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy('');
    }
  };

  const rollback = (d: Deployment) => {
    if (!window.confirm(`Put the version from ${timeAgo(d.createdAt)}${d.commit ? ` (commit ${d.commit})` : ''} back live? It uses your current environment variables. Nothing is rebuilt.`)) return;
    void act('rollback', async () => {
      const r = await api.rollback(id, d.id);
      setSelected(r.deployment.id);
    });
  };

  const redeploy = () =>
    act('deploy', async () => {
      const r = await api.redeploy(id);
      setSelected(r.deployment.id);
      setTab('deployments');
    });

  if (!user || (!project && !error)) return <><Nav variant="app" /><div className="center-screen"><span className="spinner" /></div></>;
  if (!project) {
    return (
      <>
        <Nav variant="app" />
        <main className="container page"><div className="error-box">{error}</div><br /><Link href="/dashboard" className="btn">Back to projects</Link></main>
      </>
    );
  }

  const selectedDeployment = deployments.find((d) => d.id === selected) ?? deployments[0];
  const host = project.url.replace(/^https?:\/\//, '');

  return (
    <>
      <Nav variant="app" />
      <main className="container page">
        <Link href="/dashboard" className="crumb"><Icon name="back" /> All projects</Link>

        <div className="detail-head">
          <div>
            <h1>{project.name} <StatusBadge status={project.status} /></h1>
            <a className="project-url" href={project.url} target="_blank" rel="noreferrer" style={{ marginTop: 10 }}>
              {host} <Icon name="external" />
            </a>
          </div>
          <div className="actions">
            {project.status === 'live' && (
              <a className="btn btn-primary" href={project.url} target="_blank" rel="noreferrer">Visit <Icon name="external" /></a>
            )}
            <button className="btn" onClick={() => { void navigator.clipboard?.writeText(project.url); flash('URL copied'); }}>
              <Icon name="copy" /> Copy URL
            </button>
            <button className="btn" onClick={redeploy} disabled={deploying || busy !== ''}>
              {busy === 'deploy' ? <span className="spinner" /> : <Icon name="refresh" />} Redeploy
            </button>
            {project.status === 'stopped' || project.status === 'crashed' || project.status === 'sleeping' ? (
              <button className="btn" disabled={busy !== ''} onClick={() => act('start', () => api.start(id), 'App started')}>
                {busy === 'start' ? <span className="spinner" /> : <Icon name="play" />} {project.status === 'crashed' ? 'Restart' : project.status === 'sleeping' ? 'Wake up' : 'Start'}
              </button>
            ) : (
              <button className="btn" disabled={deploying || busy !== '' || project.status === 'failed'} onClick={() => act('stop', () => api.stop(id), 'App stopped')}>
                {busy === 'stop' ? <span className="spinner" /> : <Icon name="stop" />} Stop
              </button>
            )}
          </div>
        </div>

        {error && <div className="error-box" style={{ marginBottom: 20 }}>{error}</div>}
        {project.status === 'sleeping' && (
          <div className="notice-box" style={{ marginBottom: 20 }}>
            This service is sleeping because it had no visitors for a while (Free plan). The next visit wakes it up in a few seconds. <a href="/billing">Upgrade</a> to keep it always on.
          </div>
        )}
        {project.status === 'crashed' && (
          <div className="error-box" style={{ marginBottom: 20 }}>
            This app crashed and is not serving traffic. Check <button className="link-btn" onClick={() => setTab('runtime')}>Runtime logs</button>, then restart, redeploy or roll back to an earlier version.
          </div>
        )}

        <div className="meta-grid">
          <div><small>Repository</small><span><a href={project.repoUrl.replace(/\.git$/, '')} target="_blank" rel="noreferrer">{repoLabel(project.repoUrl)}</a></span></div>
          <div><small>Folder</small><span className="mono">{project.rootDir === '.' ? '/ (root)' : `${project.rootDir}/`}</span></div>
          <div><small>Branch</small><span className="mono">{project.branch ?? 'default'}</span></div>
          <div><small>Framework</small><span>{project.framework ?? '—'}{project.kind ? ` · ${project.kind === 'static' ? 'static' : 'service'}` : ''}</span></div>
          <div><small>Commit</small><span className="mono">{project.commit ?? '—'}</span></div>
          <div><small>Updated</small><span>{timeAgo(project.updatedAt)}</span></div>
        </div>

        <div className="tabs" role="tablist">
          {TABS.map((t) => (
            <button key={t.id} role="tab" aria-selected={tab === t.id} className={`tab ${tab === t.id ? 'on' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}
            </button>
          ))}
        </div>

        {tab === 'deployments' && (
          <div className="deploy-layout">
            <div className="deploy-list">
              {deployments.map((d) => (
                <button key={d.id} className={`deploy-item ${selectedDeployment?.id === d.id ? 'on' : ''}`} onClick={() => setSelected(d.id)}>
                  <span className="row" style={{ alignItems: 'center', gap: 8 }}>
                    <StatusBadge status={d.status} />
                    {d.id === project.liveDeploymentId && <span className="badge badge-live">Serving</span>}
                  </span>
                  <small>
                    {triggerLabel(d.trigger)} · {timeAgo(d.createdAt)}
                    {d.commit ? ` · ${d.commit}` : ''}
                  </small>
                </button>
              ))}
            </div>
            {selectedDeployment ? (
              <div className="stack" style={{ gap: 14 }}>
                {selectedDeployment.status === 'failed' && selectedDeployment.error && (
                  <div className="error-box">{selectedDeployment.error}</div>
                )}
                {selectedDeployment.canRollback && (
                  <div className="notice-box" style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                    <span>This version can be put back live in seconds, without rebuilding.</span>
                    <button className="btn btn-sm" disabled={deploying || busy !== ''} onClick={() => rollback(selectedDeployment)}>
                      {busy === 'rollback' ? <span className="spinner" /> : '↩'} Roll back to this version
                    </button>
                  </div>
                )}
                <BuildLogs projectId={project.id} deployment={selectedDeployment} onFinished={load} key={selectedDeployment.id} />
              </div>
            ) : (
              <div className="muted">No deployments yet.</div>
            )}
          </div>
        )}

        {tab === 'runtime' && events.length > 0 && (
          <div className="card stack" style={{ marginBottom: 16, gap: 10 }}>
            <h3 style={{ fontSize: 16 }}>Recent activity</h3>
            {events.slice(0, 8).map((e) => (
              <div key={e.id} className="row" style={{ gap: 10, alignItems: 'baseline' }}>
                <span aria-hidden>{EVENT_ICON[e.kind]}</span>
                <span style={{ flex: 1 }}>{e.message}</span>
                <small className="dim" title={new Date(e.at).toLocaleString()}>{timeAgo(e.at)}</small>
              </div>
            ))}
          </div>
        )}

        {tab === 'runtime' && (
          <LogViewer
            title="runtime output (last 300 lines)"
            lines={runtimeLogs}
            empty={project.kind === 'static' ? 'Static sites have no runtime logs.' : 'No output yet.'}
          />
        )}

        {tab === 'env' && (
          <div className="card stack" style={{ maxWidth: 760 }}>
            <div>
              <h3 style={{ fontSize: 18 }}>Environment variables</h3>
              <p className="muted" style={{ marginTop: 6 }}>Injected at build time and at runtime. Redeploy to apply changes.</p>
            </div>
            <EnvEditor rows={envRows} onChange={(rows) => { setEnvRows(rows); setEnvDirty(true); }} />
            <div className="row">
              <button className="btn" disabled={!envDirty || busy !== ''} onClick={() => act('env', async () => { await api.updateProject(id, { env: envFromRows(envRows) }); setEnvDirty(false); }, 'Variables saved')}>
                {busy === 'env' ? <span className="spinner" /> : 'Save'}
              </button>
              <button
                className="btn btn-primary"
                disabled={busy !== '' || deploying}
                onClick={() => act('env', async () => {
                  await api.updateProject(id, { env: envFromRows(envRows) });
                  setEnvDirty(false);
                  const r = await api.redeploy(id);
                  setSelected(r.deployment.id);
                  setTab('deployments');
                })}
              >
                Save &amp; redeploy
              </button>
            </div>
          </div>
        )}

        {tab === 'database' && (
          <div className="card stack" style={{ maxWidth: 760 }}>
            <div>
              <h3 style={{ fontSize: 18 }}>MongoDB</h3>
              <p className="muted" style={{ marginTop: 6 }}>
                A private database only this project can use. The connection string is injected as{' '}
                <span className="mono">MONGODB_URI</span> (and <span className="mono">MONGO_URI</span>) into your web service, unless you set those variables yourself.
              </p>
            </div>
            {project.database ? (
              <>
                <div className="field">
                  <span className="label">Connection string</span>
                  <div className="row">
                    <input
                      className="input input-sm mono"
                      readOnly
                      type={showUri ? 'text' : 'password'}
                      value={project.database.uri}
                      onFocus={(e) => e.currentTarget.select()}
                    />
                    <button type="button" className="btn btn-sm" onClick={() => setShowUri((v) => !v)}>{showUri ? 'Hide' : 'Show'}</button>
                    <button type="button" className="btn btn-sm" onClick={() => { void navigator.clipboard?.writeText(project.database?.uri ?? ''); flash('Connection string copied'); }}>
                      <Icon name="copy" /> Copy
                    </button>
                  </div>
                  <span className="hint">
                    Database <span className="mono">{project.database.name}</span> · created {timeAgo(project.database.createdAt)}. It is reachable only from this app, not from the internet.
                    {project.kind === 'static' && ' Static sites never receive it — connect from your backend service.'}
                  </span>
                </div>
                <div className="notice-box">
                  In code: <span className="mono">mongoose.connect(process.env.MONGODB_URI)</span>. Redeploy after adding a database so the app picks it up.
                </div>
                <div>
                  <button
                    className="btn btn-danger"
                    disabled={busy !== '' || deploying}
                    onClick={() => {
                      if (!window.confirm(`Delete database "${project.database?.name}" and ALL of its data? This cannot be undone.`)) return;
                      void act('db', () => api.deleteDatabase(id), 'Database deleted');
                    }}
                  >
                    {busy === 'db' ? <span className="spinner" /> : <Icon name="trash" />} Delete database
                  </button>
                </div>
              </>
            ) : databasesOn ? (
              <div className="row">
                <button
                  className="btn btn-primary"
                  disabled={busy !== '' || deploying}
                  onClick={() => act('db', async () => {
                    await api.createDatabase(id);
                    if (project.status === 'live' && window.confirm('Database created. Redeploy now so the app receives MONGODB_URI?')) {
                      const r = await api.redeploy(id);
                      setSelected(r.deployment.id);
                      setTab('deployments');
                    }
                  }, 'Database created')}
                >
                  {busy === 'db' ? <span className="spinner" /> : null} Create database
                </button>
              </div>
            ) : (
              <div className="notice-box">Databases are not enabled on this server.</div>
            )}
          </div>
        )}

        {tab === 'settings' && (
          <div className="stack" style={{ maxWidth: 760 }}>
            <div className="card stack">
              <h3 style={{ fontSize: 18 }}>General</h3>
              <div className="field">
                <label className="label" htmlFor="pname">Project name</label>
                <input id="pname" className="input" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={40} />
                <span className="hint">The URL stays <span className="mono">{host}</span>.</span>
              </div>
              <div><button className="btn" disabled={busy !== '' || name.trim() === project.name || name.trim().length < 2} onClick={() => act('rename', () => api.updateProject(id, { name: name.trim() }), 'Renamed')}>Save name</button></div>
            </div>

            {cfg && cfgInitial && (
              <div className="card stack">
                <div>
                  <h3 style={{ fontSize: 18 }}>Build &amp; run</h3>
                  <p className="muted" style={{ marginTop: 6 }}>Changes apply on the next deployment.</p>
                </div>
                <BuildSettings value={cfg} onChange={setCfg} />
                <div className="row">
                  <button
                    className="btn btn-primary"
                    disabled={busy !== '' || deploying || (cfg.kind === 'node' && !cfg.startCommand.trim()) || (cfg.kind === 'static' && !cfg.outputDir.trim())}
                    onClick={() => act('cfg', async () => {
                      const changed = (Object.keys(cfg) as Array<keyof BuildConfig>).filter((k) => cfg[k] !== cfgInitial[k]);
                      if (changed.length > 0) await api.updateProject(id, Object.fromEntries(changed.map((k) => [k, k === 'rootDir' ? cfg[k].trim() || '.' : cfg[k]])));
                      setCfgInitial(cfg);
                      const r = await api.redeploy(id);
                      setSelected(r.deployment.id);
                      setTab('deployments');
                    })}
                  >
                    {busy === 'cfg' ? <span className="spinner" /> : <Icon name="refresh" />} Save &amp; redeploy
                  </button>
                </div>
              </div>
            )}

            <div className="card stack">
              <div>
                <h3 style={{ fontSize: 18 }}>Auto-deploy</h3>
                <p className="muted" style={{ marginTop: 6 }}>Redeploy automatically whenever new code is pushed to <span className="mono">{project.branch ?? 'the default branch'}</span>.</p>
              </div>
              <label className="check">
                <input
                  type="checkbox"
                  checked={project.autoDeploy}
                  disabled={busy !== ''}
                  onChange={(e) => act('auto', () => api.updateProject(id, { autoDeploy: e.target.checked }), e.target.checked ? 'Auto-deploy on' : 'Auto-deploy off')}
                />
                <span>
                  <b>Deploy on every new commit</b>
                  <small>HostX checks GitHub about once a minute. No setup needed.</small>
                </span>
              </label>
              <details className="webhook">
                <summary>Instant deploys with a GitHub webhook (optional)</summary>
                <div className="stack" style={{ gap: 12, marginTop: 14 }}>
                  <p className="muted">Needs a HostX API reachable from the internet. In GitHub: <b>Settings → Webhooks → Add webhook</b>, content type <span className="mono">application/json</span>, event <b>Just the push event</b>.</p>
                  {[{ label: 'Payload URL', value: project.webhook.url }, { label: 'Secret', value: project.webhook.secret }].map((f) => (
                    <div className="field" key={f.label}>
                      <span className="label">{f.label}</span>
                      <div className="row">
                        <input className="input input-sm mono" readOnly value={f.value} onFocus={(e) => e.currentTarget.select()} />
                        <button type="button" className="btn btn-sm" onClick={() => { void navigator.clipboard?.writeText(f.value); flash(`${f.label} copied`); }}><Icon name="copy" /> Copy</button>
                      </div>
                    </div>
                  ))}
                </div>
              </details>
            </div>

            <div className="card stack danger-zone">
              <h3 style={{ fontSize: 18, color: 'var(--bad)' }}>Danger zone</h3>
              <p className="muted">Deleting stops the app and permanently removes its files, logs and deployments{project.database ? ', and its database with all data' : ''}.</p>
              <div>
                <button
                  className="btn btn-danger"
                  disabled={busy !== ''}
                  onClick={async () => {
                    if (!window.confirm(`Delete "${project.name}"? This cannot be undone.`)) return;
                    setBusy('delete');
                    try {
                      await api.remove(id);
                      router.replace('/dashboard');
                    } catch (e) {
                      setError((e as Error).message);
                      setBusy('');
                    }
                  }}
                >
                  <Icon name="trash" /> Delete project
                </button>
              </div>
            </div>
          </div>
        )}
      </main>
      {toast && <div className="toast" role="status">{toast}</div>}
    </>
  );
}
