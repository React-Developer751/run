import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { PLANS, billingEnabled, type PlanId, type PlanLimits } from '../config/plans.js';
import { logger } from '../utils/logger.js';
import { DeployLog } from './log.service.js';
import { Vault } from './vault.service.js';

export type ProjectStatus = 'deploying' | 'live' | 'failed' | 'stopped' | 'crashed' | 'sleeping';
export type DeploymentStatus = 'queued' | 'cloning' | 'building' | 'starting' | 'live' | 'failed';
export type ProjectKind = 'static' | 'node';
export type RuntimeKind = 'docker' | 'process' | 'static';

export type Role = 'admin' | 'user';

export interface User {
  id: string;
  name: string;
  email: string;
  passwordHash: string;
  role: Role;
  suspended: boolean;
  /** Per-user override of the project limit. null = platform default. */
  maxProjects: number | null;
  lastLoginAt: string | null;
  /** Tokens issued before this moment are rejected (set on password change/reset). */
  passwordChangedAt: string | null;
  /** null = the address was never confirmed. Accounts from before verification existed count as verified. */
  emailVerifiedAt: string | null;
  /** Linked GitHub account and the GitHub App installations it can use. */
  github: { login: string; installationIds: number[]; linkedAt: string } | null;
  plan: PlanId;
  /** When the user accepted the Terms and Privacy Policy, and which version (null = before acceptance was recorded). */
  termsAcceptedAt: string | null;
  termsVersion: string | null;
  /** Razorpay subscription behind a paid plan (null for free / plans granted by an admin). */
  subscription: Subscription | null;
  createdAt: string;
}

export interface Subscription {
  id: string;
  plan: PlanId;
  /** created = waiting for the first payment; pending = a renewal payment failed and Razorpay is retrying. */
  status: 'created' | 'active' | 'pending' | 'cancelling' | 'cancelled' | 'halted';
  currentPeriodEnd: string | null;
  shortUrl: string | null;
  updatedAt: string;
}

/** Single-use secret sent by email (verify address, reset password). Only its hash is stored. */
export interface OneTimeToken {
  id: string;
  userId: string;
  kind: 'verify-email' | 'reset-password';
  hash: string;
  createdAt: string;
  expiresAt: string;
  usedAt: string | null;
}

/** Runtime-editable platform settings. null = fall back to the environment default. */
export interface Settings {
  allowSignup: boolean | null;
  maxProjectsPerUser: number | null;
}

/** One refresh token. Rotated on every use; rows of one login share a familyId so theft can revoke them all. */
export interface Session {
  id: string;
  familyId: string;
  userId: string;
  tokenHash: string;
  createdAt: string;
  expiresAt: string;
  rotatedAt: string | null;
  revokedAt: string | null;
  ip: string;
  userAgent: string;
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

export interface Project {
  id: string;
  userId: string;
  name: string;
  slug: string;
  repoUrl: string;
  branch: string | null;
  rootDir: string;
  kind: ProjectKind | null;
  framework: string | null;
  env: Record<string, string>;
  /** User overrides. null = use what HostX detects. '' (build only) = explicitly no build step. */
  kindPref: ProjectKind | null;
  buildCommand: string | null;
  startCommand: string | null;
  outputDir: string | null;
  /** Redeploy automatically when the repository gets a new commit. */
  autoDeploy: boolean;
  /** HMAC secret for the GitHub webhook of this project. */
  webhookSecret: string;
  status: ProjectStatus;
  runtime: RuntimeKind | null;
  port: number;
  pid: number | null;
  containerName: string | null;
  /** Managed MongoDB add-on (null = none). The password is encrypted at rest like env vars. */
  database: ProjectDatabase | null;
  /** Custom domains (e.g. www.myshop.com). Only verified ones receive traffic and TLS certificates. */
  domains: CustomDomain[];
  /** GitHub App installation used to clone (private repos). null = public clone. */
  githubInstallationId: number | null;
  /** Deployment whose build is serving traffic right now (changes on success and on rollback). */
  liveDeploymentId: string | null;
  /** Newest commit HostX has seen on the branch. Auto-deploy compares against it, so a rollback is not undone by polling. */
  lastRemoteCommit: string | null;
  currentDeploymentId: string | null;
  commit: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CustomDomain {
  name: string;
  /** Value of the TXT record _hostx-challenge.<name> that proves ownership. */
  token: string;
  verifiedAt: string | null;
  /** Whether the domain's DNS points at HostX (informational: routing works by Host header once verified). */
  dns: 'ok' | 'not-pointing' | 'unknown';
  lastCheckedAt: string | null;
  lastError: string | null;
  createdAt: string;
}

export interface ProjectDatabase {
  name: string;
  user: string;
  password: string;
  createdAt: string;
}

export interface Deployment {
  id: string;
  projectId: string;
  status: DeploymentStatus;
  trigger: 'create' | 'redeploy' | 'auto' | 'rollback';
  commit: string | null;
  error: string | null;
  /** Docker image this deployment produced (kept for the latest few, so it can be rolled back to). */
  image: string | null;
  kind: ProjectKind | null;
  /** For rollbacks: the deployment whose image was restored. */
  rollbackOf: string | null;
  createdAt: string;
  finishedAt: string | null;
}

interface Database {
  users: User[];
  projects: Project[];
  deployments: Deployment[];
  settings: Settings;
  audit: AuditEntry[];
  sessions: Session[];
  tokens: OneTimeToken[];
  events: ProjectEvent[];
  /** Ids of processed payment webhooks (Razorpay retries deliveries). */
  webhookEvents: string[];
}

/** Runtime incident shown on the project page (crash, automatic restart, recovery, rollback). */
export interface ProjectEvent {
  id: string;
  projectId: string;
  at: string;
  kind: 'crash' | 'restart' | 'recovered' | 'rollback';
  message: string;
}

/** Small JSON-file database: in-memory reads, atomic serialized writes. No third-party packages. */
export class Store {
  private static db: Database = { users: [], projects: [], deployments: [], settings: { allowSignup: null, maxProjectsPerUser: null }, audit: [], sessions: [], tokens: [], events: [], webhookEvents: [] };
  private static queue: Promise<void> = Promise.resolve();

  static async init(): Promise<void> {
    await fs.mkdir(config.dataDir, { recursive: true, mode: 0o700 });
    await fs.chmod(config.dataDir, 0o700).catch(() => undefined);
    try {
      const parsed = JSON.parse(await fs.readFile(config.dbFile, 'utf8')) as Partial<Database>;
      this.db = {
        users: (parsed.users ?? []).map((u) => ({
          ...u,
          role: u.role ?? 'user',
          suspended: u.suspended ?? false,
          maxProjects: u.maxProjects ?? null,
          lastLoginAt: u.lastLoginAt ?? null,
          passwordChangedAt: u.passwordChangedAt ?? null,
          emailVerifiedAt: u.emailVerifiedAt === undefined ? u.createdAt : u.emailVerifiedAt,
          github: u.github ?? null,
          plan: u.plan ?? 'free',
          termsAcceptedAt: u.termsAcceptedAt ?? null,
          termsVersion: u.termsVersion ?? null,
          subscription: u.subscription ?? null,
        })),
        settings: { allowSignup: parsed.settings?.allowSignup ?? null, maxProjectsPerUser: parsed.settings?.maxProjectsPerUser ?? null },
        audit: parsed.audit ?? [],
        sessions: parsed.sessions ?? [],
        tokens: parsed.tokens ?? [],
        events: parsed.events ?? [],
        webhookEvents: parsed.webhookEvents ?? [],
        projects: (parsed.projects ?? []).map((p) => ({
          ...p,
          kindPref: p.kindPref ?? null,
          buildCommand: p.buildCommand ?? null,
          startCommand: p.startCommand ?? null,
          outputDir: p.outputDir ?? null,
          autoDeploy: p.autoDeploy ?? true,
          webhookSecret: p.webhookSecret ?? crypto.randomBytes(24).toString('hex'),
          database: p.database ?? null,
          githubInstallationId: p.githubInstallationId ?? null,
          domains: p.domains ?? [],
          liveDeploymentId: p.liveDeploymentId ?? null,
          lastRemoteCommit: p.lastRemoteCommit ?? null,
        })),
        deployments: (parsed.deployments ?? []).map((d) => ({ ...d, image: d.image ?? null, kind: d.kind ?? null, rollbackOf: d.rollbackOf ?? null })),
      };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== 'ENOENT') throw err;
    }
    for (const p of this.db.projects) {
      p.env = Object.fromEntries(Object.entries(p.env ?? {}).map(([k, v]) => [k, Vault.decrypt(v)]));
      p.webhookSecret = Vault.decrypt(p.webhookSecret);
      if (p.database) p.database = { ...p.database, password: Vault.decrypt(p.database.password) };
    }
    // Accounts created before roles existed: make sure somebody can administer the platform.
    if (this.db.users.length > 0 && !this.db.users.some((u) => u.role === 'admin')) {
      const oldest = [...this.db.users].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (oldest) {
        oldest.role = 'admin';
        logger.info(`No admin existed: promoted ${oldest.email}`);
      }
    }
    await this.save(); // re-write once so legacy plaintext secrets get encrypted
  }

  private static save(): Promise<void> {
    const onDisk = {
      ...this.db,
      projects: this.db.projects.map((p) => ({
        ...p,
        env: Object.fromEntries(Object.entries(p.env).map(([k, v]) => [k, Vault.encrypt(v)])),
        webhookSecret: Vault.encrypt(p.webhookSecret),
        database: p.database ? { ...p.database, password: Vault.encrypt(p.database.password) } : null,
      })),
    };
    const snapshot = JSON.stringify(onDisk, null, 2);
    this.queue = this.queue
      .then(async () => {
        const tmp = `${config.dbFile}.tmp`;
        await fs.writeFile(tmp, snapshot, { mode: 0o600 });
        await fs.rename(tmp, config.dbFile);
      })
      .catch((err) => logger.error('Failed to persist database', err));
    return this.queue;
  }

  static newId(prefix: string): string {
    return `${prefix}_${crypto.randomBytes(5).toString('hex')}`;
  }

  // ── users ──────────────────────────────────────────────
  static getUserById(id: string): User | undefined {
    return this.db.users.find((u) => u.id === id);
  }

  static getUserByEmail(email: string): User | undefined {
    return this.db.users.find((u) => u.email === email);
  }

  static allUsers(): User[] {
    return this.db.users;
  }

  static async updateUser(id: string, patch: Partial<User>): Promise<User> {
    const user = this.getUserById(id);
    if (!user) throw new Error(`User ${id} not found`);
    Object.assign(user, patch);
    await this.save();
    return user;
  }

  static async deleteUser(id: string): Promise<void> {
    this.db.users = this.db.users.filter((u) => u.id !== id);
    this.db.tokens = this.db.tokens.filter((t) => t.userId !== id);
    await this.save();
  }

  // ── sessions (refresh tokens) ──────────────────────────
  static getSession(id: string): Session | undefined {
    return this.db.sessions.find((s) => s.id === id);
  }

  static findSessionByHash(hash: string): Session | undefined {
    return this.db.sessions.find((s) => s.tokenHash === hash);
  }

  static async addSession(session: Session): Promise<void> {
    const now = Date.now();
    // Keep rotated rows 24h so a replayed (stolen) token is still recognised; drop everything older/expired.
    this.db.sessions = this.db.sessions.filter(
      (s) => new Date(s.expiresAt).getTime() > now && !(s.rotatedAt && now - new Date(s.rotatedAt).getTime() > 24 * 3600_000),
    );
    this.db.sessions.push(session);
    await this.save();
  }

  static async updateSession(id: string, patch: Partial<Session>): Promise<void> {
    const s = this.getSession(id);
    if (s) Object.assign(s, patch);
    await this.save();
  }

  static async revokeFamily(familyId: string): Promise<void> {
    const at = new Date().toISOString();
    for (const s of this.db.sessions) if (s.familyId === familyId && !s.revokedAt) s.revokedAt = at;
    await this.save();
  }

  static async revokeUserSessions(userId: string): Promise<void> {
    const at = new Date().toISOString();
    for (const s of this.db.sessions) if (s.userId === userId && !s.revokedAt) s.revokedAt = at;
    await this.save();
  }

  // ── one-time tokens (email links) ──────────────────────
  /** Stores a new token and invalidates older unused ones of the same kind for that user. */
  static async addToken(token: OneTimeToken): Promise<void> {
    const now = Date.now();
    this.db.tokens = this.db.tokens.filter(
      (t) => new Date(t.expiresAt).getTime() > now && !t.usedAt && !(t.userId === token.userId && t.kind === token.kind),
    );
    this.db.tokens.push(token);
    await this.save();
  }

  /** A valid (unused, unexpired) token of that kind, or undefined. */
  static findToken(hash: string, kind: OneTimeToken['kind']): OneTimeToken | undefined {
    const t = this.db.tokens.find((x) => x.hash === hash && x.kind === kind);
    return t && !t.usedAt && new Date(t.expiresAt).getTime() > Date.now() ? t : undefined;
  }

  static async useToken(id: string): Promise<void> {
    const t = this.db.tokens.find((x) => x.id === id);
    if (t) t.usedAt = new Date().toISOString();
    await this.save();
  }

  static settings(): Settings {
    return this.db.settings;
  }

  static async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    Object.assign(this.db.settings, patch);
    await this.save();
    return this.db.settings;
  }

  static async addAudit(actor: User, action: string, target: string, detail = ''): Promise<void> {
    this.db.audit.unshift({ id: this.newId('a'), at: new Date().toISOString(), actorId: actor.id, actorEmail: actor.email, action, target, detail });
    if (this.db.audit.length > 1000) this.db.audit.length = 1000;
    await this.save();
  }

  static auditLog(limit: number): AuditEntry[] {
    return this.db.audit.slice(0, limit);
  }

  static async addUser(user: User): Promise<User> {
    if (this.getUserByEmail(user.email)) throw new Error('EMAIL_TAKEN');
    this.db.users.push(user);
    await this.save();
    return user;
  }

  // ── projects ───────────────────────────────────────────
  static allProjects(): Project[] {
    return this.db.projects;
  }

  static projectsOf(userId: string): Project[] {
    return this.db.projects.filter((p) => p.userId === userId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  static getProject(id: string): Project | undefined {
    return this.db.projects.find((p) => p.id === id);
  }

  static getProjectBySlug(slug: string): Project | undefined {
    return this.db.projects.find((p) => p.slug === slug);
  }

  /** Project that owns a VERIFIED custom domain (exact host name, lower case). */
  static getProjectByDomain(name: string): Project | undefined {
    return this.db.projects.find((p) => p.domains.some((d) => d.name === name && d.verifiedAt));
  }

  static usedPorts(): Set<number> {
    return new Set(this.db.projects.map((p) => p.port));
  }

  static async addProject(project: Project): Promise<Project> {
    this.db.projects.push(project);
    await this.save();
    return project;
  }

  static async updateProject(id: string, patch: Partial<Project>): Promise<Project> {
    const project = this.getProject(id);
    if (!project) throw new Error(`Project ${id} not found`);
    Object.assign(project, patch, { updatedAt: new Date().toISOString() });
    await this.save();
    return project;
  }

  static async deleteProject(id: string): Promise<void> {
    for (const d of this.db.deployments.filter((x) => x.projectId === id)) await DeployLog.remove(d.id);
    this.db.deployments = this.db.deployments.filter((d) => d.projectId !== id);
    this.db.projects = this.db.projects.filter((p) => p.id !== id);
    this.db.events = this.db.events.filter((e) => e.projectId !== id);
    await this.save();
  }

  // ── billing ────────────────────────────────────────────
  /** true the first time an event id is seen; later deliveries of the same event are ignored. */
  static async markWebhookEvent(id: string): Promise<boolean> {
    if (this.db.webhookEvents.includes(id)) return false;
    this.db.webhookEvents.unshift(id);
    this.db.webhookEvents.length = Math.min(this.db.webhookEvents.length, 2000);
    await this.save();
    return true;
  }

  static userBySubscription(subscriptionId: string): User | undefined {
    return this.db.users.find((u) => u.subscription?.id === subscriptionId);
  }

  // ── runtime events ─────────────────────────────────────
  static async addEvent(projectId: string, kind: ProjectEvent['kind'], message: string): Promise<void> {
    this.db.events.unshift({ id: this.newId('e'), projectId, at: new Date().toISOString(), kind, message });
    // 50 per project, 5000 overall.
    const seen = new Map<string, number>();
    this.db.events = this.db.events
      .filter((e) => {
        const n = (seen.get(e.projectId) ?? 0) + 1;
        seen.set(e.projectId, n);
        return n <= 50;
      })
      .slice(0, 5000);
    await this.save();
  }

  static eventsOf(projectId: string, limit = 50): ProjectEvent[] {
    return this.db.events.filter((e) => e.projectId === projectId).slice(0, limit);
  }

  // ── deployments ────────────────────────────────────────
  static getDeployment(id: string): Deployment | undefined {
    return this.db.deployments.find((d) => d.id === id);
  }

  static deploymentsOf(projectId: string): Deployment[] {
    return this.db.deployments
      .filter((d) => d.projectId === projectId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  static allDeployments(): Deployment[] {
    return this.db.deployments;
  }

  static async addDeployment(deployment: Deployment): Promise<Deployment> {
    this.db.deployments.push(deployment);

    const mine = this.deploymentsOf(deployment.projectId);
    for (const old of mine.slice(config.limits.deploymentsKept)) {
      await DeployLog.remove(old.id);
      this.db.deployments = this.db.deployments.filter((d) => d.id !== old.id);
    }
    await this.save();
    return deployment;
  }

  static async updateDeployment(id: string, patch: Partial<Deployment>): Promise<Deployment> {
    const deployment = this.getDeployment(id);
    if (!deployment) throw new Error(`Deployment ${id} not found`);
    Object.assign(deployment, patch);
    await this.save();
    return deployment;
  }
}

/**
 * What a user may use. With billing off, the old behaviour stays: per-user override, admin setting or
 * HOSTX_MAX_PROJECTS, and the global HOSTX_APP_MEMORY / HOSTX_APP_CPUS without sleeping.
 */
export function limitsFor(user: User | undefined): PlanLimits {
  const legacyProjects = Store.settings().maxProjectsPerUser ?? config.limits.maxProjectsPerUser;
  const base: PlanLimits = billingEnabled() && user
    ? PLANS[user.plan]
    : { projects: legacyProjects, databases: 1000, customDomains: 1000, memory: config.limits.memory, cpus: config.limits.cpus, sleepAfterMinutes: null };
  // Admins are never limited by plans; an admin-set project limit always wins.
  const admin = user?.role === 'admin';
  return {
    ...base,
    projects: user?.maxProjects ?? (admin ? Math.max(base.projects, 100) : base.projects),
    sleepAfterMinutes: admin ? null : base.sleepAfterMinutes,
  };
}
