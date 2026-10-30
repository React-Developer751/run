export type ProjectStatus = 'deploying' | 'live' | 'failed' | 'stopped';
export type DeploymentStatus = 'queued' | 'cloning' | 'building' | 'starting' | 'live' | 'failed';

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
}

export interface Project {
  id: string;
  name: string;
  slug: string;
  url: string;
  repoUrl: string;
  branch: string | null;
  rootDir: string;
  /** User overrides; null means "auto-detected". */
  config: { kind: 'static' | 'node' | null; buildCommand: string | null; startCommand: string | null; outputDir: string | null };
  kind: 'static' | 'node' | null;
  framework: string | null;
  env: Record<string, string>;
  autoDeploy: boolean;
  /** Managed MongoDB add-on; the URI contains the password (owner-only). */
  database: { name: string; user: string; uri: string; createdAt: string } | null;
  webhook: { url: string; secret: string };
  status: ProjectStatus;
  commit: string | null;
  currentDeploymentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface Deployment {
  id: string;
  status: DeploymentStatus;
  trigger: 'create' | 'redeploy' | 'auto';
  commit: string | null;
  error: string | null;
  createdAt: string;
  finishedAt: string | null;
}

export interface ScanFolder {
  path: string;
  packageName: string | null;
  framework: string;
  kind: 'static' | 'node';
  buildCommand: string;
  startCommand: string;
  outputDir: string;
}

export interface BuildConfig {
  rootDir: string;
  kind: 'static' | 'node';
  buildCommand: string;
  startCommand: string;
  outputDir: string;
}

export interface Health {
  status: string;
  runner: 'docker' | 'process';
  urlTemplate: string;
  /** true when the server can create MongoDB databases. */
  databases?: boolean;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  suspended: boolean;
  maxProjects: number | null;
  createdAt: string;
  lastLoginAt: string | null;
  projects: number;
  liveProjects: number;
}

export interface AdminProject {
  id: string;
  name: string;
  slug: string;
  url: string;
  repoUrl: string;
  branch: string | null;
  rootDir: string;
  kind: 'static' | 'node' | null;
  framework: string | null;
  status: ProjectStatus;
  runtime: 'docker' | 'process' | 'static' | null;
  port: number;
  commit: string | null;
  autoDeploy: boolean;
  currentDeploymentId: string | null;
  createdAt: string;
  updatedAt: string;
  owner: { id: string; name: string; email: string };
}

export interface AdminDeployment extends Deployment {
  projectId: string;
  projectName: string;
  slug: string;
  owner: string;
}

export interface AuditEntry {
  id: string;
  at: string;
  actorId: string;
  actorEmail: string;
  action: string;
  target: string;
  detail: string;
}

export interface PlatformSettings {
  allowSignup: boolean;
  maxProjectsPerUser: number;
}

export interface AdminStats {
  users: { total: number; admins: number; suspended: number; newLast7d: number };
  projects: { total: number; live: number; deploying: number; failed: number; stopped: number; static: number; node: number };
  deployments: { total: number; last24h: number; failed24h: number; auto24h: number; perDay: Array<{ date: string; total: number; failed: number }> };
  platform: {
    runner: 'docker' | 'process';
    pollSeconds: number;
    portsUsed: number;
    portsTotal: number;
    uptimeSeconds: number;
    nodeVersion: string;
    os: { platform: string; cpus: number; loadavg: number[]; totalMem: number; freeMem: number };
    disk: { dataBytes: number; appsBytes: number };
    baseDomain: string;
  };
  settings: PlatformSettings;
}
