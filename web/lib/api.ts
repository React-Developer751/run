import type { AdminDeployment, AdminProject, AdminStats, AdminUser, AuditEntry, BuildConfig, Deployment, PlatformSettings, Health, Project, ScanFolder, User } from './types';

const BASE = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Auth endpoints that must never trigger the silent-refresh retry (it would loop or hide real login errors). */
const NO_REFRESH = ['/api/auth/login', '/api/auth/register', '/api/auth/refresh', '/api/auth/logout'];

let refreshing: Promise<boolean> | null = null;

/**
 * Trades the HttpOnly refresh cookie for new cookies. Concurrent callers share one request.
 * JavaScript never sees or stores a token: the browser attaches the cookies by itself.
 */
function refreshSession(): Promise<boolean> {
  refreshing ??= fetch(`${BASE}/api/auth/refresh`, { method: 'POST', credentials: 'include', cache: 'no-store' })
    .then((r) => r.ok)
    .catch(() => false)
    .finally(() => {
      refreshing = null;
    });
  return refreshing;
}

async function request<T>(path: string, method = 'GET', body?: unknown, retried = false): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${BASE}${path}`, {
      method,
      credentials: 'include',
      cache: 'no-store',
      ...(body !== undefined ? { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) } : {}),
    });
  } catch {
    throw new ApiError(0, 'Cannot reach the HostX engine. Is it running on ' + BASE + '?');
  }

  if (res.status === 401 && !retried && !NO_REFRESH.some((p) => path.startsWith(p))) {
    if (await refreshSession()) return request<T>(path, method, body, true);
    window.dispatchEvent(new Event('hostx:signed-out'));
  }

  const data = (await res.json().catch(() => ({}))) as { error?: string };
  if (!res.ok) throw new ApiError(res.status, data.error ?? 'Something went wrong');
  return data as T;
}

export const api = {
  health: () => request<Health>('/api/health'),

  register: (name: string, email: string, password: string) =>
    request<{ user: User }>('/api/auth/register', 'POST', { name, email, password }),
  login: (email: string, password: string) =>
    request<{ user: User }>('/api/auth/login', 'POST', { email, password }),
  me: () => request<{ user: User }>('/api/auth/me'),
  logout: () => request<{ ok: true }>('/api/auth/logout', 'POST', {}),
  logoutAll: () => request<{ ok: true }>('/api/auth/logout-all', 'POST', {}),
  changePassword: (currentPassword: string, newPassword: string) =>
    request<{ ok: true }>('/api/auth/password', 'POST', { currentPassword, newPassword }),

  scan: (repoUrl: string, branch?: string) =>
    request<{ repoName: string; folders: ScanFolder[] }>('/api/scan', 'POST', { repoUrl, branch: branch || undefined }),

  projects: () => request<{ projects: Project[] }>('/api/projects'),
  createProject: (
    input: Partial<BuildConfig> & { repoUrl: string; branch?: string; name: string; env: Record<string, string>; autoDeploy?: boolean },
  ) => request<{ project: Project; deployment: Deployment }>('/api/projects', 'POST', input),
  project: (id: string) => request<{ project: Project; deployments: Deployment[] }>(`/api/projects/${id}`),
  updateProject: (id: string, patch: Partial<BuildConfig> & { name?: string; env?: Record<string, string>; autoDeploy?: boolean }) =>
    request<{ project: Project }>(`/api/projects/${id}`, 'PATCH', patch),
  redeploy: (id: string) => request<{ deployment: Deployment }>(`/api/projects/${id}/deploy`, 'POST', {}),
  stop: (id: string) => request<{ project: Project }>(`/api/projects/${id}/stop`, 'POST', {}),
  start: (id: string) => request<{ project: Project }>(`/api/projects/${id}/start`, 'POST', {}),
  remove: (id: string) => request<{ ok: true }>(`/api/projects/${id}`, 'DELETE'),

  deploymentLogs: (id: string, deploymentId: string, after: number) =>
    request<{ lines: string[]; next: number; status: Deployment['status']; error: string | null }>(
      `/api/projects/${id}/deployments/${deploymentId}/logs?after=${after}`,
    ),
  admin: {
    stats: () => request<AdminStats>('/api/admin/stats'),
    users: () => request<{ users: AdminUser[] }>('/api/admin/users'),
    updateUser: (id: string, patch: { role?: 'admin' | 'user'; suspended?: boolean; maxProjects?: number | null }) =>
      request<{ user: AdminUser }>(`/api/admin/users/${id}`, 'PATCH', patch),
    resetPassword: (id: string) => request<{ password: string }>(`/api/admin/users/${id}/reset-password`, 'POST', {}),
    deleteUser: (id: string) => request<{ ok: true }>(`/api/admin/users/${id}`, 'DELETE'),
    projects: () => request<{ projects: AdminProject[] }>('/api/admin/projects'),
    stopProject: (id: string) => request<unknown>(`/api/admin/projects/${id}/stop`, 'POST', {}),
    startProject: (id: string) => request<unknown>(`/api/admin/projects/${id}/start`, 'POST', {}),
    redeployProject: (id: string) => request<unknown>(`/api/admin/projects/${id}/deploy`, 'POST', {}),
    deleteProject: (id: string) => request<{ ok: true }>(`/api/admin/projects/${id}`, 'DELETE'),
    deploymentLogs: (id: string, did: string, after: number) =>
      request<{ lines: string[]; next: number; status: Deployment['status']; error: string | null }>(
        `/api/admin/projects/${id}/deployments/${did}/logs?after=${after}`,
      ),
    runtimeLogs: (id: string) => request<{ logs: string }>(`/api/admin/projects/${id}/logs`),
    deployments: () => request<{ deployments: AdminDeployment[] }>('/api/admin/deployments?limit=100'),
    settings: () => request<{ settings: PlatformSettings }>('/api/admin/settings'),
    updateSettings: (patch: Partial<PlatformSettings>) => request<{ settings: PlatformSettings }>('/api/admin/settings', 'PATCH', patch),
    audit: () => request<{ entries: AuditEntry[] }>('/api/admin/audit?limit=200'),
  },
  runtimeLogs: (id: string) => request<{ logs: string }>(`/api/projects/${id}/logs?lines=300`),
};
