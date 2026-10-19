'use client';

import type { BuildConfig, ScanFolder } from '@/lib/types';
import { FolderSelect } from './FolderSelect';

export const folderToConfig = (f: ScanFolder): BuildConfig => ({
  rootDir: f.path,
  kind: f.kind,
  buildCommand: f.buildCommand,
  startCommand: f.startCommand,
  outputDir: f.outputDir,
});

export const EMPTY_CONFIG: BuildConfig = { rootDir: '.', kind: 'node', buildCommand: '', startCommand: 'npm start', outputDir: 'dist' };

/** Source directory, type, build / start command and output folder. Auto-filled by the repo scan, always editable. */
export function BuildSettings({
  value,
  onChange,
  folders,
}: {
  value: BuildConfig;
  onChange: (next: BuildConfig) => void;
  folders?: ScanFolder[] | null;
}) {
  const set = (patch: Partial<BuildConfig>) => onChange({ ...value, ...patch });
  const pickFolder = (path: string) => {
    const f = folders?.find((x) => x.path === path);
    onChange(f ? folderToConfig(f) : { ...value, rootDir: path });
  };

  return (
    <div className="stack" style={{ gap: 20 }}>
      <div className="field">
        <span className="label">Source directory</span>
        {folders && folders.length > 0 && <FolderSelect folders={folders} value={value.rootDir} onChange={pickFolder} />}
        <input
          className="input mono"
          aria-label="Source directory"
          value={value.rootDir}
          onChange={(e) => set({ rootDir: e.target.value })}
          placeholder=". (repository root)"
          spellCheck={false}
        />
        <span className="hint">
          Folder inside the repo that contains your app (e.g. <span className="mono">backend</span> or <span className="mono">apps/web</span>). Use <span className="mono">.</span> for the root.
        </span>
      </div>

      <div className="field">
        <span className="label">Type</span>
        <div className="seg" role="radiogroup" aria-label="Project type">
          {(['node', 'static'] as const).map((k) => (
            <button
              type="button"
              key={k}
              role="radio"
              aria-checked={value.kind === k}
              className={value.kind === k ? 'on' : ''}
              onClick={() => set({ kind: k })}
            >
              {k === 'node' ? 'Web service (Node.js)' : 'Static site (React / Vite / HTML)'}
            </button>
          ))}
        </div>
      </div>

      <div className="field">
        <label className="label" htmlFor="build-cmd">Build command</label>
        <input id="build-cmd" className="input mono" value={value.buildCommand} onChange={(e) => set({ buildCommand: e.target.value })} placeholder="npm run build  (leave empty for no build)" spellCheck={false} />
        <span className="hint">Runs after <span className="mono">npm install</span>.</span>
      </div>

      {value.kind === 'node' ? (
        <div className="field">
          <label className="label" htmlFor="start-cmd">Start command</label>
          <input id="start-cmd" className="input mono" value={value.startCommand} onChange={(e) => set({ startCommand: e.target.value })} placeholder="npm start" spellCheck={false} required />
          <span className="hint">Your server must listen on <span className="mono">process.env.PORT</span>.</span>
        </div>
      ) : (
        <div className="field">
          <label className="label" htmlFor="out-dir">Output directory</label>
          <input id="out-dir" className="input mono" value={value.outputDir} onChange={(e) => set({ outputDir: e.target.value.trim() })} placeholder="dist" spellCheck={false} required />
          <span className="hint">Folder (relative to the source directory) that the build produces — <span className="mono">dist</span> for Vite, <span className="mono">build</span> for Create React App.</span>
        </div>
      )}
    </div>
  );
}
