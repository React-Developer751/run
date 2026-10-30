'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AtlasGuide, MONGO_ENV_KEYS } from '@/components/AtlasGuide';
import { BuildSettings } from '@/components/BuildSettings';
import { DomainsPanel } from '@/components/DomainsPanel';
import { EnvEditor, envFromRows, rowsFromEnv, type EnvRow } from '@/components/EnvEditor';
import { Icon } from '@/components/Icon';
import { LogViewer } from '@/components/LogViewer';
import { Nav } from '@/components/Nav';
import { StatusBadge, isBusy } from '@/components/StatusBadge';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';
import { repoLabel, timeAgo, triggerLabel } from '@/lib/format';
import type { BuildConfig, Deployment, Project, ProjectEvent } from '@/lib/types';
import { FeedbackPrompt } from '@/components/FeedbackPrompt';
import { useSiteName } from '@/components/BrandProvider';
import { brandSlug } from '@/lib/site';

const EVENT_ICON: Record<ProjectEvent['kind'], string> = { crash: '🔴', restart: '🟠', recovered: '🟢', rollback: '↩️', paused: '⏸️', archived: '📦' };

type Tab = 'deployments' | 'runtime' | 'env' | 'domains' | 'database' | 'settings';
const TABS: Array<{ id: Tab; label: string }> = [
  { id: 'deployments', label: 'Deployments' },
  { id: 'runtime', label: 'Runtime logs' },
  { id: 'env', label: 'Environment' },
  { id: 'domains', label: 'Domains' },
  { id: 'database', label: 'Database' },
  { id: 'settings', label: 'Settings' },
];

/** Polls one deployment's build log until it reaches a final state. */
function BuildLogs({ projectId, deployment, onFinished }: { projectId: string; deployment: Deployment; onFinished: () => void }) {
  const siteName = useSiteName();
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState(deployment.status);
  const finished = useRef(onFinished);
  finished.current = onFinished;

  useEffect(() => {
    let cancelled = false;
    let next = 0;
    let timer: ReturnType<typeof setTimeout>;
    setLines([]);

    // Server errors (engine restarting) back off up to 15 s instead of hammering it every second.
    let failures = 0;
    const tick = async () => {
      try {
        const r = await api.deploymentLogs(projectId, deployment.id, next);
        if (cancelled) return;
        failures = 0;
        next = r.next;
        if (r.lines.length) setLines((prev) => [...prev, ...r.lines]);
        setStatus(r.status);
        if (r.status === 'live' || r.status === 'failed') {
          finished.current();
          return;
        }
      } catch (e) {
        // 4xx (deleted, not yours, signed out) will not fix itself: stop polling and say why.
        const status = (e as { status?: number }).status ?? 0;
        if (status >= 400 && status < 500) {
          if (!cancelled) setLines((prev) => [...prev, `[${brandSlug(siteName)}] Could not load the log: ${(e as Error).message}`]);
          return;
        }
        failures++;
      }
      timer = setTimeout(tick, failures ? Math.min(15_000, 1000 * 2 ** failures) : 1000);
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
  const siteName = useSiteName();
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
  const [repoInput, setRepoInput] = useState('');
  const [branchInput, setBranchInput] = useState('');
  const [cfg, setCfg] = useState<BuildConfig | null>(null);
  const [cfgInitial, setCfgInitial] = useState<BuildConfig | null>(null);
  const [runtimeLogs, setRuntimeLogs] = useState<string[]>([]);
  const [events, setEvents] = useState<ProjectEvent[]>([]);
  const [serverIp, setServerIp] = useState<string | null>(null);

  useEffect(() => {
    api.health().then((h) => setServerIp(h.serverIp ?? null)).catch(() => undefined);
  }, []);

  const toastTimer = useRef<ReturnType<typeof setTimeout>>(undefined);
  const flash = (message: string) => {
    setToast(message);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(''), 2600);
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
      setRepoInput(project.repoUrl.replace(/\.git$/, ''));
      setBranchInput(project.branch ?? '');
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
    if (project) document.title = `${project.name} · ${siteName}`;
  }, [project?.name, siteName]);
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
            {project.status === 'stopped' || project.status === 'crashed' || project.status === 'paused' ? (
              <button className="btn" disabled={busy !== ''} onClick={() => act('start', () => api.start(id), project.status === 'paused' ? 'App resumed' : 'App started')}>
                {busy === 'start' ? <span className="spinner" /> : <Icon name="play" />} {project.status === 'crashed' ? 'Restart' : project.status === 'paused' ? 'Resume' : 'Start'}
              </button>
            ) : project.status === 'archived' ? null : (
              <button className="btn" disabled={deploying || busy !== '' || project.status === 'failed'} onClick={() => act('stop', () => api.stop(id), 'App stopped')}>
                {busy === 'stop' ? <span className="spinner" /> : <Icon name="stop" />} Stop
              </button>
            )}
          </div>
        </div>

        {error && <div className="error-box" style={{ marginBottom: 20 }}>{error}</div>}
        {project.status === 'live' && project.liveDeploymentId && <FeedbackPrompt projectId={project.id} projectName={project.name} />}

        {project.status === 'paused' && (
          <div className="notice-box" style={{ marginBottom: 20, display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <span>
              <b>Paused</b> because it had no visitors for a while (Free plan). Nothing was deleted — your settings, environment variables and
              URL are all here. Visitors see a &ldquo;paused&rdquo; page until you resume it. <a href="/billing">Paid plans</a> are never paused.
            </span>
            <button className="btn btn-primary btn-sm" disabled={busy !== ''} onClick={() => act('start', () => api.start(id), 'App resumed')}>
              {busy === 'start' ? <span className="spinner" /> : <Icon name="play" />} Resume
            </button>
          </div>
        )}
        {project.status === 'archived' && (
          <div className="notice-box" style={{ marginBottom: 20, display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
            <span>
              <b>Archived</b> after a long time without visitors, to free server space. Your settings, environment variables, domains and URL
              are all kept. <b>Restore</b> rebuilds it from <span className="mono">{project.repoUrl.replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '')}</span>
              {project.branch ? ` (${project.branch})` : ''} in 1–3 minutes. Repository moved or renamed? Update it in Settings first.
            </span>
            <button className="btn btn-primary btn-sm" disabled={busy !== ''} onClick={redeploy}>
              {busy === 'deploy' ? <span className="spinner" /> : <Icon name="refresh" />} Restore
            </button>
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
          <div>
            <small>Auto-deploy</small>
            <span>{project.autoDeploy ? `On · every push${project.viaGitHubApp ? ' (instant)' : ''}` : 'Off'}</span>
          </div>
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

        {tab === 'domains' && <DomainsPanel project={project} onChange={setProject} flash={flash} />}

        {tab === 'database' && (
          <AtlasGuide
            project={project}
            serverIp={serverIp}
            flash={flash}
            onUseEnv={() => {
              if (!envRows.some((r) => MONGO_ENV_KEYS.includes(r.key.trim()))) {
                setEnvRows((rows) => [...rows, { key: 'MONGODB_URI', value: '' }]);
                setEnvDirty(true);
              }
              setTab('env');
            }}
          />
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

            <div className="card stack">
              <div>
                <h3 style={{ fontSize: 18 }}>Repository</h3>
                <p className="muted" style={{ marginTop: 6 }}>Where {siteName} gets the code. Change it if the repository was renamed or moved; the next deploy uses it.</p>
              </div>
              <div className="field">
                <label className="label" htmlFor="repo-url">GitHub repository</label>
                <input id="repo-url" className="input mono" value={repoInput} onChange={(e) => setRepoInput(e.target.value)} spellCheck={false} />
              </div>
              <div className="field">
                <label className="label" htmlFor="repo-branch">Branch</label>
                <input id="repo-branch" className="input mono" value={branchInput} onChange={(e) => setBranchInput(e.target.value)} placeholder="default branch" spellCheck={false} />
              </div>
              <div>
                <button
                  className="btn"
                  disabled={busy !== '' || deploying || (repoInput.trim() === project.repoUrl.replace(/\.git$/, '') && branchInput.trim() === (project.branch ?? ''))}
                  onClick={() => act('repo', async () => {
                    const r = await api.updateProject(id, { repoUrl: repoInput.trim(), branch: branchInput.trim() || null });
                    setRepoInput(r.project.repoUrl.replace(/\.git$/, ''));
                    setBranchInput(r.project.branch ?? '');
                  }, 'Repository saved — deploy to use it')}
                >
                  {busy === 'repo' ? <span className="spinner" /> : 'Save repository'}
                </button>
              </div>
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
                  disabled={busy !== '' || deploying}
                  onChange={(e) => act('auto', () => api.updateProject(id, { autoDeploy: e.target.checked }), e.target.checked ? 'Auto-deploy on' : 'Auto-deploy off')}
                />
                <span>
                  <b>Deploy on every new commit</b>
                  <small>{siteName} checks GitHub about once a minute. No setup needed.</small>
                </span>
              </label>
              <details className="webhook">
                <summary>Instant deploys with a GitHub webhook (optional)</summary>
                <div className="stack" style={{ gap: 12, marginTop: 14 }}>
                  <p className="muted">Needs the {siteName} API reachable from the internet. In GitHub: <b>Settings → Webhooks → Add webhook</b>, content type <span className="mono">application/json</span>, event <b>Just the push event</b>.</p>
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
              <p className="muted">Deleting stops the app and permanently removes its files, logs and deployments. Your MongoDB Atlas data is not touched.</p>
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
