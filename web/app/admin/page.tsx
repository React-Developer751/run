'use client';

import { api } from '@/lib/api';
import { bytes, duration } from '@/lib/format';
import { usePoll } from '@/lib/hooks';

function Meter({ label, used, total, text, calm }: { label: string; used: number; total: number; text: string; calm?: boolean }) {
  const pct = total > 0 ? Math.min(100, Math.round((used / total) * 100)) : 0;
  return (
    <div className="meter">
      <div className="meter-top"><span>{label}</span><b>{text}</b></div>
      <div className="meter-bar"><i style={{ width: `${pct}%` }} className={pct > 85 && !calm ? 'hot' : ''} /></div>
    </div>
  );
}

export default function AdminOverview() {
  const { data: s, error } = usePoll(() => api.admin.stats(), 8000);
  if (error && !s) return <div className="error-box">{error}</div>;
  if (!s) return <div className="center-screen"><span className="spinner" /></div>;

  const { users, projects, deployments, platform } = s;
  const failRate = deployments.last24h ? Math.round((deployments.failed24h / deployments.last24h) * 100) : 0;
  const peak = Math.max(1, ...deployments.perDay.map((d) => d.total));
  const usedMem = platform.os.totalMem - platform.os.freeMem;

  return (
    <div className="stack" style={{ gap: 24 }}>
      <div className="page-head" style={{ marginBottom: 0 }}>
        <div>
          <h1>Platform <span className="serif grad-text">overview</span></h1>
          <p>Live status of everything running on this HostX server.</p>
        </div>
        <span className={`chip ${platform.runner === 'docker' ? '' : 'warn'}`}><i className="dot" />{platform.runner === 'docker' ? 'Docker isolated' : 'Dev mode (no isolation)'}</span>
      </div>

      <div className="kpis">
        <div className="card stat"><span>Users</span><b>{users.total}</b><small>{users.admins} admin · {users.suspended} suspended · +{users.newLast7d} this week</small></div>
        <div className="card stat"><span>Projects</span><b>{projects.total}</b><small><em className="ok">{projects.live} live</em> · {projects.deploying} building · <em className="bad">{projects.failed} failed</em> · {projects.stopped} stopped</small></div>
        <div className="card stat"><span>Deployments (24h)</span><b>{deployments.last24h}</b><small>{deployments.auto24h} auto-deploys · {deployments.total} all time</small></div>
        <div className="card stat"><span>Failure rate (24h)</span><b style={{ color: failRate > 25 ? 'var(--bad)' : undefined }}>{failRate}%</b><small>{deployments.failed24h} failed of {deployments.last24h}</small></div>
      </div>

      <div className="grid-2">
        <div className="card">
          <h3 className="card-title">Deployments · last 7 days</h3>
          <div className="bars" role="img" aria-label="Deployments per day">
            {deployments.perDay.map((d) => (
              <div className="bar-col" key={d.date} title={`${d.date}: ${d.total} deployments, ${d.failed} failed`}>
                <span className="bar-num">{d.total}</span>
                <div className="bar-track">
                  <div className="bar-fill" style={{ height: `${(d.total / peak) * 100}%` }}>
                    {d.failed > 0 && <div className="bar-fail" style={{ height: `${(d.failed / d.total) * 100}%` }} />}
                  </div>
                </div>
                <span className="bar-label">{new Date(d.date).toLocaleDateString(undefined, { weekday: 'short' })}</span>
              </div>
            ))}
          </div>
          <div className="legend"><span><i /> Succeeded</span><span><i className="f" /> Failed</span></div>
        </div>

        <div className="card stack" style={{ gap: 18 }}>
          <h3 className="card-title">Server</h3>
          <Meter label="Memory" used={usedMem} total={platform.os.totalMem} text={`${bytes(usedMem)} / ${bytes(platform.os.totalMem)}`} calm={platform.os.platform === 'darwin'} />
          <Meter label="CPU load (1 min)" used={platform.os.loadavg[0] ?? 0} total={platform.os.cpus} text={`${(platform.os.loadavg[0] ?? 0).toFixed(2)} on ${platform.os.cpus} cores`} />
          <Meter label="App ports" used={platform.portsUsed} total={platform.portsTotal} text={`${platform.portsUsed} / ${platform.portsTotal}`} />
          <dl className="kv">
            <div><dt>Uptime</dt><dd>{duration(platform.uptimeSeconds)}</dd></div>
            <div><dt>Disk (apps)</dt><dd>{bytes(platform.disk.appsBytes)}</dd></div>
            <div><dt>Disk (data)</dt><dd>{bytes(platform.disk.dataBytes)}</dd></div>
            <div><dt>Node.js</dt><dd>{platform.nodeVersion}</dd></div>
            <div><dt>Base domain</dt><dd className="mono">{platform.baseDomain}</dd></div>
            <div><dt>Git polling</dt><dd>{platform.pollSeconds > 0 ? `every ${platform.pollSeconds}s` : 'off'}</dd></div>
          </dl>
        </div>
      </div>

      <div className="card">
        <h3 className="card-title">Project types</h3>
        <div className="split">
          <div style={{ flex: Math.max(projects.static, 0.01) }} className="split-a">Static sites · {projects.static}</div>
          <div style={{ flex: Math.max(projects.node, 0.01) }} className="split-b">Web services · {projects.node}</div>
        </div>
      </div>
    </div>
  );
}
