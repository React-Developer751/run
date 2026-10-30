export type ProjectStatus = 'deploying' | 'live' | 'failed' | 'stopped' | 'crashed';
export type DeploymentStatus = 'queued' | 'cloning' | 'building' | 'starting' | 'live' | 'failed';

export interface User {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  emailVerified: boolean;
  /** true when unverified accounts cannot deploy on this server. */
  verificationRequired: boolean;
  github: { login: string } | null;
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
  /** Cloned through the HostX GitHub App (private repository support). */
  viaGitHubApp: boolean;
  domains: CustomDomain[];
  webhook: { url: string; secret: string };
  status: ProjectStatus;
  commit: string | null;
  currentDeploymentId: string | null;
  /** Deployment whose build is serving traffic. */
  liveDeploymentId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomDomain {
  name: string;
  url: string;
  verified: boolean;
  verifiedAt: string | null;
  /** Whether DNS points at HostX yet. */
  dns: 'ok' | 'not-pointing' | 'unknown';
  lastCheckedAt: string | null;
  lastError: string | null;
  records: Array<{ type: 'TXT' | 'CNAME' | 'A'; name: string; value: string }>;
}

export interface ProjectEvent {
  id: string;
  at: string;
  kind: 'crash' | 'restart' | 'recovered' | 'rollback';
  message: string;
}

export interface Deployment {
  id: string;
  status: DeploymentStatus;
  trigger: 'create' | 'redeploy' | 'auto' | 'rollback';
  commit: string | null;
  error: string | null;
  /** Rollbacks: the deployment that was restored. */
  rollbackOf?: string | null;
  /** Its image is still kept, so it can be put back live in seconds. */
  canRollback?: boolean;
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
  /** Public IP apps connect from (for MongoDB Atlas Network Access), when the admin set HOSTX_PUBLIC_IP. */
  serverIp?: string | null;
  github?: boolean;
  billing?: boolean;
}

export type PlanId = 'free' | 'starter' | 'pro';

export interface PlanLimits {
  projects: number;
  customDomains: number;
  memory: string;
  cpus: string;
}

export interface Plan extends PlanLimits {
  id: PlanId;
  name: string;
  priceInr: number;
  available: boolean;
}

export interface BillingInfo {
  enabled: boolean;
  plan: PlanId;
  limits: PlanLimits;
  usage: { projects: number; customDomains: number };
  subscription: {
    plan: PlanId;
    status: 'created' | 'active' | 'pending' | 'cancelling' | 'cancelled' | 'halted';
    currentPeriodEnd: string | null;
    paymentUrl: string | null;
  } | null;
}

export interface GitHubStatus {
  enabled: boolean;
  connected: boolean;
  login: string | null;
  installations: number;
  installUrl?: string;
  authorizeUrl?: string;
}

export interface GitHubRepo {
  fullName: string;
  url: string;
  private: boolean;
  defaultBranch: string;
  installationId: number;
  pushedAt: string | null;
}

export interface AdminUser {
  id: string;
  name: string;
  email: string;
  role: 'admin' | 'user';
  suspended: boolean;
  maxProjects: number | null;
  plan: PlanId;
  subscriptionStatus: string | null;
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

export interface AdminNotification {
  id: string;
  at: string;
  kind: 'deploy-failed' | 'disk-near-full';
  severity: 'warning' | 'critical';
  title: string;
  message: string;
  projectId: string | null;
  projectName: string | null;
  userId: string | null;
  readAt: string | null;
}

export interface StorageReport {
  checkedAt: string | null;
  disks: Array<{ path: string; mount: string; totalMb: number; freeMb: number; usedPercent: number }>;
}
