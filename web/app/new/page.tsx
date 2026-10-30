'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { BuildSettings, EMPTY_CONFIG, folderToConfig } from '@/components/BuildSettings';
import { EnvEditor, envFromRows, type EnvRow } from '@/components/EnvEditor';
import { Icon } from '@/components/Icon';
import { Nav } from '@/components/Nav';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';
import { slugPreview } from '@/lib/format';
import type { BuildConfig, GitHubRepo, ScanFolder } from '@/lib/types';

// "github.com/u/repo", "https://www.github.com/u/repo.git/" and the API's URL all compare equal.
const normalizeRepo = (url: string) =>
  url.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '').replace(/\.git$/, '');

export default function NewDeploy() {
  const user = useRequireAuth();
  const router = useRouter();

  const [repoUrl, setRepoUrl] = useState('');
  const [branch, setBranch] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [folders, setFolders] = useState<ScanFolder[]>([]);
  const [config, setConfig] = useState<BuildConfig>(EMPTY_CONFIG);
  const [name, setName] = useState('');
  const [env, setEnv] = useState<EnvRow[]>([]);
  const [autoDeploy, setAutoDeploy] = useState(true);
  const [withDatabase, setWithDatabase] = useState(false);
  const [databasesOn, setDatabasesOn] = useState(false);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState('');
  const [urlTemplate, setUrlTemplate] = useState('http://{slug}.localhost:8080');
  const [githubOn, setGithubOn] = useState(false);
  const [repos, setRepos] = useState<GitHubRepo[] | null>(null);
  const [repoFilter, setRepoFilter] = useState('');
  const [repoError, setRepoError] = useState('');

  useEffect(() => {
    if (user?.github) {
      api.github.repos().then((r) => { setRepos(r.repos); setRepoError(''); }).catch((e: Error) => { setRepos([]); setRepoError(e.message); });
    }
  }, [user?.github]);

  // A repository from the connected GitHub account is cloned through the GitHub App (works for private repos too).
  const githubRepo = repos?.find((r) => normalizeRepo(r.url) === normalizeRepo(repoUrl));
  const installationId = githubRepo?.installationId;

  useEffect(() => {
    api.health().then((h) => { setUrlTemplate(h.urlTemplate); setDatabasesOn(Boolean(h.databases)); setGithubOn(Boolean(h.github)); }).catch(() => undefined);
  }, []);

  const reset = () => setScanned(false);

  const scan = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setScanning(true);
    setScanned(false);
    try {
      const r = await api.scan(repoUrl.trim(), branch.trim(), installationId);
      setFolders(r.folders);
      // Prefer the repo root when it is deployable, otherwise the first folder found.
      const first = r.folders.find((f) => f.path === '.') ?? r.folders[0];
      setConfig(first ? folderToConfig(first) : EMPTY_CONFIG);
      setName(r.repoName);
      setScanned(true);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setScanning(false);
    }
  };

  const deploy = async () => {
    setError('');
    setDeploying(true);
    try {
      const r = await api.createProject({
        repoUrl: repoUrl.trim(),
        ...(branch.trim() ? { branch: branch.trim() } : {}),
        name: name.trim(),
        env: envFromRows(env),
        autoDeploy,
        database: withDatabase && config.kind === 'node',
        ...(installationId !== undefined ? { githubInstallationId: installationId } : {}),
        ...config,
        rootDir: config.rootDir.trim() || '.',
      });
      router.push(`/projects/${r.project.id}`);
    } catch (err) {
      setError((err as Error).message);
      setDeploying(false);
    }
  };

  if (!user) return <><Nav variant="app" /><div className="center-screen"><span className="spinner" /></div></>;

  const startMissing = config.kind === 'node' && !config.startCommand.trim();
  const outputMissing = config.kind === 'static' && !config.outputDir.trim();

  return (
    <>
      <Nav variant="app" />
      <main className="container page">
        <div className="wizard">
          <div className="page-head" style={{ marginBottom: 24 }}>
            <div>
              <h1>New <span className="serif grad-text">deployment</span></h1>
              <p>Paste a public GitHub repository. We detect the settings — you can change any of them.</p>
            </div>
          </div>

          <div className="stepper"><div className="on" /><div className={scanned ? 'on' : ''} /></div>

          <div className="card stack">
            {repos && repos.length > 0 && (
              <div className="field">
                <span className="label">Your GitHub repositories <span className="dim">(@{user.github?.login})</span></span>
                <input className="input input-sm" aria-label="Filter repositories" placeholder="Filter repositories…" value={repoFilter} onChange={(e) => setRepoFilter(e.target.value)} spellCheck={false} />
                <div className="deploy-list" style={{ maxHeight: 220, overflowY: 'auto' }}>
                  {repos
                    .filter((r) => r.fullName.toLowerCase().includes(repoFilter.trim().toLowerCase()))
                    .slice(0, 50)
                    .map((r) => (
                      <button
                        type="button"
                        key={`${r.installationId}:${r.fullName}`}
                        className={`deploy-item ${githubRepo?.fullName === r.fullName ? 'on' : ''}`}
                        onClick={() => { setRepoUrl(r.url); setBranch(''); reset(); }}
                      >
                        <span className="mono">{r.fullName}</span>
                        <small>{r.private ? 'private' : 'public'} · {r.defaultBranch}</small>
                      </button>
                    ))}
                </div>
              </div>
            )}

            {repoError && <div className="notice-box">Could not load your GitHub repositories ({repoError}). You can still paste a repository URL below.</div>}

            <form className="stack" onSubmit={scan}>
              <div className="field">
                <label className="label" htmlFor="repo">GitHub repository URL</label>
                <div className="row">
                  <input
                    id="repo"
                    className="input"
                    placeholder="https://github.com/username/project"
                    value={repoUrl}
                    onChange={(e) => { setRepoUrl(e.target.value); reset(); }}
                    required
                    spellCheck={false}
                    autoFocus
                  />
                  <input
                    className="input"
                    style={{ maxWidth: 170 }}
                    placeholder="branch (optional)"
                    aria-label="Branch"
                    value={branch}
                    onChange={(e) => { setBranch(e.target.value); reset(); }}
                    spellCheck={false}
                  />
                  <button className="btn btn-primary" style={{ height: 46 }} disabled={scanning || !repoUrl.trim()}>
                    {scanning ? <><span className="spinner" /> Scanning</> : 'Scan repo'}
                  </button>
                </div>
                <span className="hint">
                  We take a shallow clone and auto-fill the settings below.{' '}
                  {githubRepo
                    ? `Cloned through your GitHub connection${githubRepo.private ? ' (private repository)' : ''}.`
                    : githubOn && !user.github
                      ? <>Private repository? <Link href="/account">Connect GitHub</Link> first.</>
                      : 'Public repositories work without connecting GitHub.'}
                </span>
              </div>
            </form>

            {error && <div className="error-box" role="alert">{error}</div>}

            {scanned && (
              <>
                <hr style={{ border: 0, borderTop: '1px solid var(--line)', width: '100%', margin: 0 }} />

                {folders.length === 0 ? (
                  <div className="notice-box">
                    No <span className="mono">package.json</span> or <span className="mono">index.html</span> was found automatically. Fill in the source directory and commands below.
                  </div>
                ) : (
                  <div className="notice-box">
                    Auto-detected <b>{folders.length}</b> deployable folder{folders.length > 1 ? 's' : ''}. Pick one — settings update automatically. A full-stack repo needs one deployment per folder.
                  </div>
                )}

                <div className="field">
                  <label className="label" htmlFor="name">Project name</label>
                  <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={40} required />
                  <div className="url-preview">{urlTemplate.replace('{slug}', slugPreview(name)).replace(/^https?:\/\//, '')}</div>
                </div>

                <BuildSettings value={config} onChange={setConfig} folders={folders} />

                <div className="field">
                  <span className="label">Environment variables <span className="dim">(optional)</span></span>
                  <EnvEditor rows={env} onChange={setEnv} />
                  {config.kind === 'static' && (
                    <span className="hint">For React/Vite, use the VITE_ prefix (e.g. VITE_API_URL). Values are baked in at build time.</span>
                  )}
                </div>

                {databasesOn && config.kind === 'node' && (
                  <label className="check">
                    <input type="checkbox" checked={withDatabase} onChange={(e) => setWithDatabase(e.target.checked)} />
                    <span>
                      <b>Add a MongoDB database</b>
                      <small>A private database for this service. Your app gets its connection string as <span className="mono">process.env.MONGODB_URI</span>.</small>
                    </span>
                  </label>
                )}

                <label className="check">
                  <input type="checkbox" checked={autoDeploy} onChange={(e) => setAutoDeploy(e.target.checked)} />
                  <span>
                    <b>Auto-deploy on new commits</b>
                    <small>HostX checks your branch regularly and redeploys when you push.</small>
                  </span>
                </label>

                <button className="btn btn-primary btn-lg" onClick={deploy} disabled={deploying || name.trim().length < 2 || startMissing || outputMissing}>
                  {deploying ? <><span className="spinner" /> Starting…</> : <>Deploy <Icon name="arrow" /></>}
                </button>
              </>
            )}
          </div>
        </div>
      </main>
    </>
  );
}
