'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import type { DeploymentStatus } from '@/lib/types';
import { LogViewer } from './LogViewer';
import { Modal } from './Modal';
import { StatusBadge } from './StatusBadge';

/** Admin log viewer: build log of a deployment (live-polled) plus the app's runtime output. */
export function LogModal({ projectId, deploymentId, title, onClose }: { projectId: string; deploymentId: string | null; title: string; onClose: () => void }) {
  const [tab, setTab] = useState<'build' | 'runtime'>(deploymentId ? 'build' : 'runtime');
  const [lines, setLines] = useState<string[]>([]);
  const [status, setStatus] = useState<DeploymentStatus | null>(null);
  const [runtime, setRuntime] = useState<string[]>([]);

  useEffect(() => {
    if (tab !== 'build' || !deploymentId) return;
    let cancelled = false;
    let next = 0;
    let timer: ReturnType<typeof setTimeout>;
    setLines([]);
    const tick = async () => {
      try {
        const r = await api.admin.deploymentLogs(projectId, deploymentId, next);
        if (cancelled) return;
        next = r.next;
        if (r.lines.length) setLines((p) => [...p, ...r.lines]);
        setStatus(r.status);
        if (r.status === 'live' || r.status === 'failed') return;
      } catch {
        /* retry */
      }
      timer = setTimeout(tick, 1200);
    };
    void tick();
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [tab, projectId, deploymentId]);

  useEffect(() => {
    if (tab !== 'runtime') return;
    let cancelled = false;
    const load = () => api.admin.runtimeLogs(projectId).then((r) => !cancelled && setRuntime(r.logs ? r.logs.split('\n') : [])).catch(() => undefined);
    void load();
    const t = setInterval(load, 4000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, [tab, projectId]);

  return (
    <Modal title={title} onClose={onClose} wide>
      <div className="tabs" style={{ marginBottom: 16 }}>
        {deploymentId && <button className={`tab ${tab === 'build' ? 'on' : ''}`} onClick={() => setTab('build')}>Build log</button>}
        <button className={`tab ${tab === 'runtime' ? 'on' : ''}`} onClick={() => setTab('runtime')}>Runtime output</button>
      </div>
      {tab === 'build' ? (
        <LogViewer title="build log" lines={lines} footer={status ? <StatusBadge status={status} /> : undefined} />
      ) : (
        <LogViewer title="runtime output (last 300 lines)" lines={runtime} empty="No output yet (static sites have none)." />
      )}
    </Modal>
  );
}
