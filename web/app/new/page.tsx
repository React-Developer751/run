'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useMemo, useRef, useState } from 'react';
import { BuildSettings, EMPTY_CONFIG, folderToConfig } from '@/components/BuildSettings';
import { EnvEditor, envFromRows, type EnvRow } from '@/components/EnvEditor';
import { Icon, type IconName } from '@/components/Icon';
import { Nav } from '@/components/Nav';
import { api } from '@/lib/api';
import { useAuth, useRequireAuth } from '@/lib/auth';
import { slugPreview, timeAgo } from '@/lib/format';
import type { BuildConfig, GitHubRepo, GitHubStatus, ScanFolder } from '@/lib/types';
import { GITHUB_RESULT } from '@/lib/github-result';
import { useSiteName } from '@/components/BrandProvider';

type Kind = BuildConfig['kind'];

// "github.com/u/repo", "https://www.github.com/u/repo.git/" and the API's URL all compare equal.
const normalizeRepo = (url: string) =>
  url.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/^www\./, '').replace(/\/+$/, '').replace(/\.git$/, '');
const looksLikeRepoUrl = (text: string) => /^(https?:\/\/)?(www\.)?github\.com\/[\w.-]+\/[\w.-]+/i.test(text.trim());
const toRepoUrl = (text: string) => `https://${normalizeRepo(text)}`;

const TYPES: Array<{ kind: Kind; icon: IconName; title: string; text: string; examples: string }> = [
  {
    kind: 'node',
    icon: 'terminal',
    title: 'Web Service',
    text: 'A server that runs all the time: your API or full-stack app.',
    examples: 'Express · Node.js · Next.js · NestJS',
  },
  {
    kind: 'static',
    icon: 'globe',
    title: 'Static Site',
    text: 'A frontend that is built once and served as files.',
    examples: 'React · Vite · Create React App · HTML',
  },
];
const typeLabel = (k: Kind) => (k === 'node' ? 'Web Service' : 'Static Site');

/** Best folder for the chosen type: a matching one (root first), else the root, else the first found. */
function pickFolder(folders: ScanFolder[], kind: Kind): ScanFolder | undefined {
  const matching = folders.filter((f) => f.kind === kind);
  return matching.find((f) => f.path === '.') ?? matching[0] ?? folders.find((f) => f.path === '.') ?? folders[0];
}

export default function NewDeploy() {
  const siteName = useSiteName();
  const user = useRequireAuth();
  const { reload } = useAuth();
  const router = useRouter();

  // Step 1: what to deploy. Step 2: which repo. Step 3: settings.
  const [githubResult, setGithubResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [kind, setKind] = useState<Kind | null>(null);
  const [query, setQuery] = useState('');
  const [repoUrl, setRepoUrl] = useState('');
  const [repo, setRepo] = useState<GitHubRepo | null>(null);
  const [branch, setBranch] = useState('');
  const [scannedBranch, setScannedBranch] = useState('');
  const [scanning, setScanning] = useState(false);
  const [scanned, setScanned] = useState(false);
  const [folders, setFolders] = useState<ScanFolder[]>([]);
  const [config, setConfig] = useState<BuildConfig>(EMPTY_CONFIG);
  const [name, setName] = useState('');
  const [env, setEnv] = useState<EnvRow[]>([]);
  const [autoDeploy, setAutoDeploy] = useState(true);
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState('');
  const [urlTemplate, setUrlTemplate] = useState('http://{slug}.localhost:8080');
  const [github, setGithub] = useState<GitHubStatus | null>(null);
  const [repos, setRepos] = useState<GitHubRepo[] | null>(null);
  const [repoError, setRepoError] = useState('');
  // Only the newest scan may fill in the form: an older, slower one (e.g. after "Change repository") is ignored.
  const scanSeq = useRef(0);

  // ?type=static|web preselects step 1; ?github=connected means we just came back from GitHub with new access.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const t = params.get('type');
    if (t === 'static') setKind('static');
    if (t === 'web' || t === 'node') setKind('node');
    const gh = params.get('github');
    if (gh) {
      if (GITHUB_RESULT[gh]) setGithubResult(GITHUB_RESULT[gh]);
      window.history.replaceState(null, '', '/new');
      void reload();
    }
    api.health().then((h) => setUrlTemplate(h.urlTemplate)).catch(() => undefined);
    api.github.status('new').then(setGithub).catch(() => setGithub(null));
  }, [reload]);

  useEffect(() => {
    if (!user?.github) return;
    api.github
      .repos()
      .then((r) => { setRepos(r.repos); setRepoError(''); })
      .catch((e: Error) => { setRepos([]); setRepoError(e.message); });
  }, [user?.github]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!repos) return [];
    if (!q || looksLikeRepoUrl(q)) return repos.slice(0, 30);
    return repos.filter((r) => r.fullName.toLowerCase().includes(q)).slice(0, 30);
  }, [repos, query]);

  // A pasted URL of one of your connected repos is cloned through the GitHub App (private repos too).
  const typedRepo = looksLikeRepoUrl(query) ? repos?.find((r) => normalizeRepo(r.url) === normalizeRepo(query)) : undefined;

  // rescan = same repository, another branch: the form stays visible (also if it fails) and a name the user typed is kept.
  const scan = async (url: string, fromGithub: GitHubRepo | null, scanBranch: string, rescan = false) => {
    const seq = ++scanSeq.current;
    setError('');
    setScanning(true);
    if (!rescan) setScanned(false);
    try {
      const r = await api.scan(url, scanBranch, fromGithub?.installationId);
      if (seq !== scanSeq.current) return;
      setFolders(r.folders);
      const best = pickFolder(r.folders, kind ?? 'node');
      setConfig(best ? { ...folderToConfig(best), kind: kind ?? best.kind } : { ...EMPTY_CONFIG, kind: kind ?? 'node' });
      if (!rescan || !name.trim()) setName(r.repoName);
      setScannedBranch(scanBranch);
      setScanned(true);
    } catch (err) {
      if (seq === scanSeq.current) setError((err as Error).message);
    } finally {
      if (seq === scanSeq.current) setScanning(false);
    }
  };

  const choose = (url: string, fromGithub: GitHubRepo | null) => {
    const b = fromGithub?.defaultBranch ?? '';
    setRepoUrl(url);
    setRepo(fromGithub);
    setBranch(b);
    void scan(url, fromGithub, b);
  };

  const backToRepos = () => {
    scanSeq.current++; // drop any scan still running
    setScanning(false);
    setRepoUrl('');
    setRepo(null);
    setScanned(false);
    setError('');
  };

  const deploy = async () => {
    setError('');
    setDeploying(true);
    try {
      const r = await api.createProject({
        repoUrl,
        ...(branch.trim() ? { branch: branch.trim() } : {}),
        name: name.trim(),
        env: envFromRows(env),
        autoDeploy,
        ...(repo ? { githubInstallationId: repo.installationId } : {}),
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

  const step = !kind ? 1 : !repoUrl ? 2 : 3;
  const detected = folders.find((f) => f.path === config.rootDir);
  const mismatch = scanned && kind && detected && detected.kind !== kind ? detected : null;
  const startMissing = config.kind === 'node' && !config.startCommand.trim();
  const outputMissing = config.kind === 'static' && !config.outputDir.trim();
  const repoLabel = repo?.fullName ?? normalizeRepo(repoUrl).replace(/^github\.com\//, '');

  return (
    <>
      <Nav variant="app" />
      <main className="container page">
        <div className="wizard">
          <div className="page-head" style={{ marginBottom: 24 }}>
            <div>
              <h1>New <span className="serif grad-text">{kind ? typeLabel(kind) : 'deployment'}</span></h1>
              <p>
                {step === 1 && 'What are you deploying? Pick one; a full-stack MERN repo gets one of each (backend + frontend).'}
                {step === 2 && 'Choose the GitHub repository to deploy.'}
                {step === 3 && 'We detected these settings from your code. Change anything you like.'}
              </p>
            </div>
          </div>

          <div className="stepper" aria-label={`Step ${step} of 3`}>
            <div className="on" /><div className={step >= 2 ? 'on' : ''} /><div className={step >= 3 ? 'on' : ''} />
          </div>

          {githubResult && <div className={githubResult.ok ? 'notice-box' : 'error-box'} role="status" style={{ marginBottom: 16 }}>{githubResult.text}</div>}

          {/* ── Step 1: service type ── */}
          {step === 1 && (
            <div className="type-grid">
              {TYPES.map((t) => (
                <button key={t.kind} type="button" className="card card-hover type-card" onClick={() => setKind(t.kind)}>
                  <span className="feature-icon"><Icon name={t.icon} /></span>
                  <b>{t.title}</b>
                  <span className="muted">{t.text}</span>
                  <small className="dim">{t.examples}</small>
                  <span className="type-go">Select <Icon name="arrow" /></span>
                </button>
              ))}
            </div>
          )}

          {step >= 2 && kind && (
            <div className="crumbs-row">
              <span className="chip"><Icon name={kind === 'node' ? 'terminal' : 'globe'} /> {typeLabel(kind)}</span>
              {step === 2 && <button type="button" className="link-btn" onClick={() => setKind(null)}>Change type</button>}
              {step === 3 && (
                <>
                  <span className="chip"><Icon name="branch" /> {repoLabel}{repo?.private ? ' · private' : ''}</span>
                  <button type="button" className="link-btn" onClick={backToRepos}>Change repository</button>
                </>
              )}
            </div>
          )}

          {/* ── Step 2: repository ── */}
          {step === 2 && (
            <div className="card stack">
              <div className="field">
                <label className="label" htmlFor="repo-search">Repository</label>
                <div className="search-box">
                  <Icon name="search" />
                  <input
                    id="repo-search"
                    className="input"
                    placeholder={user.github ? 'Search your repositories, or paste a public GitHub URL' : 'Paste a public GitHub URL, e.g. https://github.com/you/project'}
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' && looksLikeRepoUrl(query)) choose(typedRepo?.url ?? toRepoUrl(query), typedRepo ?? null);
                    }}
                    spellCheck={false}
                    autoFocus
                    autoComplete="off"
                  />
                </div>
              </div>

              {looksLikeRepoUrl(query) && (
                <button type="button" className="repo-row" onClick={() => choose(typedRepo?.url ?? toRepoUrl(query), typedRepo ?? null)}>
                  <Icon name="globe" />
                  <span className="repo-main"><b className="mono">{normalizeRepo(query).replace(/^github\.com\//, '')}</b><small>{typedRepo ? 'From your GitHub' : 'Public repository'}</small></span>
                  <span className="btn btn-sm btn-primary">Continue</span>
                </button>
              )}

              {user.github && repos === null && !repoError && <div className="muted"><span className="spinner" /> Loading your repositories…</div>}
              {repoError && <div className="notice-box">Could not load your GitHub repositories ({repoError}). You can still paste a public repository URL.</div>}

              {repos && repos.length > 0 && (
                <div className="repo-list" role="list">
                  {filtered.map((r) => (
                    <div role="listitem" key={`${r.installationId}:${r.fullName}`}>
                    <button type="button" className="repo-row" onClick={() => choose(r.url, r)}>
                      <Icon name="branch" />
                      <span className="repo-main">
                        <b className="mono">{r.fullName}</b>
                        <small>{r.private ? 'Private' : 'Public'} · {r.defaultBranch}{r.pushedAt ? ` · updated ${timeAgo(r.pushedAt)}` : ''}</small>
                      </span>
                      <span className="btn btn-sm">Connect</span>
                    </button>
                    </div>
                  ))}
                  {filtered.length === 0 && !looksLikeRepoUrl(query) && <div className="muted" style={{ padding: 12 }}>No repository matches “{query}”.</div>}
                </div>
              )}

              {github?.enabled && (
                <div className="notice-box" style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                  {!user.github ? (
                    <span>Connect GitHub to see all your repositories here (private ones too) and deploy on every push.</span>
                  ) : repos && repos.length === 0 && !repoError ? (
                    <span>{siteName} cannot see any of your repositories yet. Choose which ones it may access.</span>
                  ) : (
                    <span>Missing a repository? Give {siteName} access to it on GitHub.</span>
                  )}
                  <a className={`btn btn-sm ${user.github && repos?.length ? '' : 'btn-primary'}`} href={github.installUrl}>
                    {user.github ? 'Configure GitHub access' : 'Connect GitHub'}
                  </a>
                </div>
              )}
            </div>
          )}

          {/* ── Step 3: settings ── */}
          {step === 3 && (
            <div className="card stack">
              {scanning && <div className="muted" style={{ padding: '18px 0' }}><span className="spinner" /> Reading <span className="mono">{repoLabel}</span> and detecting settings…</div>}
              {error && <div className="error-box" role="alert">{error}</div>}

              {scanned && (
                <>
                  {mismatch && (
                    <div className="notice-box" style={{ display: 'flex', gap: 12, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}>
                      <span>
                        <span className="mono">{mismatch.path === '.' ? 'This folder' : `${mismatch.path}/`}</span> looks like {/^[aeiou]/i.test(mismatch.framework) ? 'an' : 'a'} <b>{mismatch.framework}</b>{' '}
                        {mismatch.kind === 'static' ? 'static site' : 'web service'}.
                      </span>
                      <button type="button" className="btn btn-sm" onClick={() => { setKind(mismatch.kind); setConfig(folderToConfig(mismatch)); }}>
                        Deploy as {typeLabel(mismatch.kind)}
                      </button>
                    </div>
                  )}
                  {folders.length === 0 && (
                    <div className="notice-box">
                      No <span className="mono">package.json</span> or <span className="mono">index.html</span> was found. Set the root directory and commands below.
                    </div>
                  )}

                  <div className="field">
                    <label className="label" htmlFor="name">Name</label>
                    <input id="name" className="input" value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={40} required />
                    <div className="url-preview">{urlTemplate.replace('{slug}', slugPreview(name)).replace(/^https?:\/\//, '')}</div>
                  </div>

                  <div className="field">
                    <label className="label" htmlFor="branch">Branch</label>
                    <div className="row">
                      <input id="branch" className="input mono" value={branch} onChange={(e) => setBranch(e.target.value)} placeholder="default branch" spellCheck={false} />
                      {branch.trim() !== scannedBranch && (
                        <button type="button" className="btn" disabled={scanning} onClick={() => void scan(repoUrl, repo, branch.trim(), true)}>Re-scan</button>
                      )}
                    </div>
                  </div>

                  <BuildSettings
                    value={config}
                    onChange={(next) => setConfig({ ...next, kind: kind ?? next.kind })}
                    folders={folders}
                    hideKind
                  />

                  <div className="field">
                    <span className="label">Environment variables <span className="dim">(optional)</span></span>
                    <EnvEditor rows={env} onChange={setEnv} />
                    {config.kind === 'static' ? (
                      <span className="hint">For React/Vite, use the VITE_ prefix (e.g. VITE_API_URL). Values are baked in at build time. Never put database URLs here.</span>
                    ) : (
                      <span className="hint">Using MongoDB? Add <span className="mono">MONGODB_URI</span> with your free MongoDB Atlas connection string (the project&apos;s Database tab has a step-by-step guide).</span>
                    )}
                  </div>

                  <label className="check">
                    <input type="checkbox" checked={autoDeploy} onChange={(e) => setAutoDeploy(e.target.checked)} />
                    <span>
                      <b>Auto-deploy</b>
                      <small>
                        Every push to <span className="mono">{branch.trim() || 'the default branch'}</span> goes live automatically
                        {repo ? ' (instantly through your GitHub connection).' : ' (checked about once a minute).'}
                      </small>
                    </span>
                  </label>

                  {branch.trim() !== scannedBranch && <div className="hint">Branch changed: click Re-scan so the settings match that branch.</div>}
                  <button className="btn btn-primary btn-lg" onClick={deploy} disabled={deploying || scanning || branch.trim() !== scannedBranch || name.trim().length < 2 || startMissing || outputMissing}>
                    {deploying ? <><span className="spinner" /> Starting…</> : <>Create {typeLabel(config.kind)} <Icon name="arrow" /></>}
                  </button>
                </>
              )}
            </div>
          )}
        </div>
      </main>
    </>
  );
}
