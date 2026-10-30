import type { DeploymentStatus, ProjectStatus } from '@/lib/types';

const META: Record<ProjectStatus | DeploymentStatus, { label: string; tone: 'live' | 'busy' | 'bad' | 'idle' }> = {
  live: { label: 'Live', tone: 'live' },
  deploying: { label: 'Deploying', tone: 'busy' },
  queued: { label: 'Queued', tone: 'busy' },
  cloning: { label: 'Cloning', tone: 'busy' },
  building: { label: 'Building', tone: 'busy' },
  starting: { label: 'Starting', tone: 'busy' },
  failed: { label: 'Failed', tone: 'bad' },
  stopped: { label: 'Stopped', tone: 'idle' },
  crashed: { label: 'Crashed', tone: 'bad' },
  paused: { label: 'Paused', tone: 'idle' },
  archived: { label: 'Archived', tone: 'idle' },
};

export const isBusy = (s: ProjectStatus | DeploymentStatus) => META[s].tone === 'busy';

export function StatusBadge({ status }: { status: ProjectStatus | DeploymentStatus }) {
  const { label, tone } = META[status];
  return <span className={`badge badge-${tone}`}>{label}</span>;
}
