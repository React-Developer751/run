'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState, type FormEvent } from 'react';
import { BuildSettings, EMPTY_CONFIG, folderToConfig } from '@/components/BuildSettings';
import { EnvEditor, envFromRows, type EnvRow } from '@/components/EnvEditor';
import { Icon } from '@/components/Icon';
import { Nav } from '@/components/Nav';
import { api } from '@/lib/api';
import { useRequireAuth } from '@/lib/auth';
import { slugPreview } from '@/lib/format';
import type { BuildConfig, ScanFolder } from '@/lib/types';

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
  const [deploying, setDeploying] = useState(false);
  const [error, setError] = useState('');
  const [urlTemplate, setUrlTemplate] = useState('http://{slug}.localhost:8080');

  useEffect(() => {
    api.health().then((h) => setUrlTemplate(h.urlTemplate)).catch(() => undefined);
  }, []);

  const reset = () => setScanned(false);

  const scan = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setScanning(true);
    setScanned(false);
    try {
      const r = await api.scan(repoUrl.trim(), branch.trim());
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
                <span className="hint">We take a shallow clone and auto-fill the settings below. Only public repositories are supported.</span>
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
