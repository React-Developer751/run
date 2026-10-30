'use client';

import type { Project } from '@/lib/types';
import { Icon } from './Icon';

/** Env names apps commonly read their MongoDB connection string from. */
export const MONGO_ENV_KEYS = ['MONGODB_URI', 'MONGO_URI', 'MONGO_URL', 'DATABASE_URL'];

/**
 * How to connect a project to the user's own MongoDB Atlas database (HostX does not host databases).
 * `onUseEnv` jumps to the Environment tab with a MONGODB_URI row ready to fill.
 */
export function AtlasGuide({ project, serverIp, onUseEnv, flash }: { project: Project; serverIp: string | null; onUseEnv: () => void; flash: (m: string) => void }) {
  const key = MONGO_ENV_KEYS.find((k) => project.env[k]?.startsWith('mongodb'));
  const copy = (v: string) => {
    void navigator.clipboard?.writeText(v);
    flash('Copied');
  };

  return (
    <div className="card stack" style={{ maxWidth: 820 }}>
      <div>
        <h3 style={{ fontSize: 18 }}>MongoDB with Atlas</h3>
        <p className="muted" style={{ marginTop: 6 }}>
          Use your own free MongoDB Atlas database: it is the real MongoDB, and your data stays in your account.
          Your app reads the connection string from an environment variable.
        </p>
      </div>

      {key ? (
        <div className="notice-box">
          ✓ <b>{key}</b> is set for this project{project.kind === 'static' ? ' — but this is a static site: use the database from your backend service instead.' : '. Redeploy after changing it.'}
        </div>
      ) : (
        <div className="notice-box">No MongoDB connection string is set yet. Follow the steps below (about 5 minutes).</div>
      )}

      <ol className="atlas-steps">
        <li>
          <b>Create a free cluster.</b> Sign up at{' '}
          <a href="https://www.mongodb.com/cloud/atlas/register" target="_blank" rel="noreferrer">mongodb.com/atlas <Icon name="external" /></a>{' '}
          and create a free <span className="mono">M0</span> cluster (choose a region near India, e.g. Mumbai).
        </li>
        <li>
          <b>Create a database user.</b> Security → <i>Database Access</i> → Add new user, with a password (save it).
        </li>
        <li>
          <b>Allow HostX to connect.</b> Security → <i>Network Access</i> → Add IP address:
          {serverIp ? (
            <span className="row" style={{ marginTop: 8, alignItems: 'center' }}>
              <span className="mono">{serverIp}</span>
              <button type="button" className="btn btn-sm" onClick={() => copy(serverIp)}><Icon name="copy" /> Copy</button>
            </span>
          ) : (
            <span> use <span className="mono">0.0.0.0/0</span> (allow from anywhere). Your password still protects the database; use a long one.</span>
          )}
        </li>
        <li>
          <b>Copy the connection string.</b> Database → <i>Connect</i> → Drivers. It looks like{' '}
          <span className="mono">mongodb+srv://user:&lt;password&gt;@cluster0.xxxxx.mongodb.net/myapp</span>. Replace{' '}
          <span className="mono">&lt;password&gt;</span> and add your database name before the <span className="mono">?</span>.
        </li>
        <li>
          <b>Add it to this project</b> as <span className="mono">MONGODB_URI</span> and redeploy.
          <div style={{ marginTop: 10 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={onUseEnv}>Open Environment and add MONGODB_URI</button>
          </div>
        </li>
      </ol>

      <div className="hint">
        In your code: <span className="mono">mongoose.connect(process.env.MONGODB_URI)</span>. Put the database in your backend (Node/Express) service only,
        never in React/Vite code, where it would be visible to everyone.
      </div>
    </div>
  );
}
