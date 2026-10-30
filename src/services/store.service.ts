import fs from 'node:fs/promises';
import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { PLANS, billingEnabled, type PlanId, type PlanLimits } from '../config/plans.js';
import { logger } from '../utils/logger.js';
import { Db } from './db.service.js';
import { DeployLog } from './log.service.js';
import { Vault } from './vault.service.js';

export type ProjectStatus = 'deploying' | 'live' | 'failed' | 'stopped' | 'crashed';
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
  adminNotifications: AdminNotification[];
}

/** Something an administrator should look at (shown in Admin → Notifications, also emailed). */
export interface AdminNotification {
  id: string;
  at: string;
  kind: 'deploy-failed' | 'database-near-limit' | 'disk-near-full';
  severity: 'warning' | 'critical';
  title: string;
  message: string;
  projectId: string | null;
  userId: string | null;
  /** Same key = same situation; used to avoid repeating an alert (e.g. "db:<project>:critical"). */
  dedupeKey: string | null;
  readAt: string | null;
}

/** Runtime incident shown on the project page (crash, automatic restart, recovery, rollback). */
export interface ProjectEvent {
  id: string;
  projectId: string;
  at: string;
  kind: 'crash' | 'restart' | 'recovered' | 'rollback';
  message: string;
}

const normalizeUser = (u: User): User => ({
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
});

/** Fills fields added after a record was written; secrets are decrypted (they are encrypted at rest). */
const loadProject = (p: Project): Project => ({
  ...p,
  // Sleeping mode was removed: such apps count as live again, and DeployService.recover() starts them on boot.
  status: (p.status as string) === 'sleeping' ? 'live' : p.status,
  kindPref: p.kindPref ?? null,
  buildCommand: p.buildCommand ?? null,
  startCommand: p.startCommand ?? null,
  outputDir: p.outputDir ?? null,
  autoDeploy: p.autoDeploy ?? true,
  env: Object.fromEntries(Object.entries(p.env ?? {}).map(([k, v]) => [k, Vault.decrypt(v)])),
  webhookSecret: Vault.decrypt(p.webhookSecret ?? crypto.randomBytes(24).toString('hex')),
  database: p.database ? { ...p.database, password: Vault.decrypt(p.database.password) } : null,
  githubInstallationId: p.githubInstallationId ?? null,
  domains: p.domains ?? [],
  liveDeploymentId: p.liveDeploymentId ?? null,
  lastRemoteCommit: p.lastRemoteCommit ?? null,
});

const projectDoc = (p: Project): string =>
  JSON.stringify({
    ...p,
    env: Object.fromEntries(Object.entries(p.env).map(([k, v]) => [k, Vault.encrypt(v)])),
    webhookSecret: Vault.encrypt(p.webhookSecret),
    database: p.database ? { ...p.database, password: Vault.encrypt(p.database.password) } : null,
  });

const normalizeDeployment = (d: Deployment): Deployment => ({ ...d, image: d.image ?? null, kind: d.kind ?? null, rollbackOf: d.rollbackOf ?? null });

const docs = <T>(table: string, order = ''): T[] => Db.all<{ doc: string }>(`SELECT doc FROM ${table}${order}`).map((r) => JSON.parse(r.doc) as T);

const EVENTS_PER_PROJECT = 50;
const ADMIN_NOTIFICATIONS_KEPT = 500;
const AUDIT_KEPT = 1000;
const WEBHOOK_EVENTS_KEPT = 2000;

/**
 * SQLite-backed store (data/hostx.db, node:sqlite, WAL). Every write is a targeted row change inside a transaction,
 * durable before the call resolves. Records are also kept in memory, so reads stay synchronous and cheap.
 */
export class Store {
  private static db: Database = { users: [], projects: [], deployments: [], settings: { allowSignup: null, maxProjectsPerUser: null }, audit: [], sessions: [], tokens: [], events: [], webhookEvents: [], adminNotifications: [] };

  static async init(): Promise<void> {
    await fs.mkdir(config.dataDir, { recursive: true, mode: 0o700 });
    await fs.chmod(config.dataDir, 0o700).catch(() => undefined);
    Db.open(config.sqliteFile);
    await this.importLegacyJson();

    const settings = Db.all<{ doc: string }>(`SELECT doc FROM settings WHERE key = 'platform'`)[0];
    this.db = {
      users: docs<User>('users').map(normalizeUser),
      projects: docs<Project>('projects').map(loadProject),
      deployments: docs<Deployment>('deployments').map(normalizeDeployment),
      sessions: docs<Session>('sessions'),
      tokens: docs<OneTimeToken>('tokens'),
      events: docs<ProjectEvent>('events', ' ORDER BY at DESC'),
      audit: docs<AuditEntry>('audit', ' ORDER BY at DESC'),
      webhookEvents: Db.all<{ id: string }>('SELECT id FROM webhook_events ORDER BY at DESC').map((r) => r.id),
      adminNotifications: docs<AdminNotification>('admin_notifications', ' ORDER BY at DESC'),
      settings: settings ? (JSON.parse(settings.doc) as Settings) : { allowSignup: null, maxProjectsPerUser: null },
    };

    // Accounts created before roles existed: make sure somebody can administer the platform.
    if (this.db.users.length > 0 && !this.db.users.some((u) => u.role === 'admin')) {
      const oldest = [...this.db.users].sort((a, b) => a.createdAt.localeCompare(b.createdAt))[0];
      if (oldest) {
        await this.updateUser(oldest.id, { role: 'admin' });
        logger.info(`No admin existed: promoted ${oldest.email}`);
      }
    }
  }

  /** One-time move from the old data/db.json into SQLite. The JSON file is kept (renamed) as a backup. */
  private static async importLegacyJson(): Promise<void> {
    let raw: string;
    try {
      raw = await fs.readFile(config.legacyDbFile, 'utf8');
    } catch {
      return;
    }
    const empty = Db.all<{ n: number }>('SELECT COUNT(*) AS n FROM users')[0]?.n === 0;
    if (!empty) {
      logger.warn(`${config.legacyDbFile} exists but the SQLite database already has data: ignoring the JSON file`);
      return;
    }
    const parsed = JSON.parse(raw) as Partial<Database>;
    const users = (parsed.users ?? []).map(normalizeUser);
    const projects = (parsed.projects ?? []).map(loadProject);
    Db.tx(() => {
      for (const u of users) this.writeUser(u);
      for (const p of projects) this.writeProject(p);
      for (const d of (parsed.deployments ?? []).map(normalizeDeployment)) this.writeDeployment(d);
      for (const s of parsed.sessions ?? []) this.writeSession(s);
      for (const t of parsed.tokens ?? []) this.writeToken(t);
      for (const e of parsed.events ?? []) Db.put('events', { id: e.id, project_id: e.projectId, at: e.at, doc: JSON.stringify(e) });
      for (const a of parsed.audit ?? []) Db.put('audit', { id: a.id, at: a.at, doc: JSON.stringify(a) });
      for (const id of parsed.webhookEvents ?? []) Db.put('webhook_events', { id, at: new Date().toISOString() });
      if (parsed.settings) Db.put('settings', { key: 'platform', doc: JSON.stringify(parsed.settings) }, 'key');
    });
    const moved = `${config.legacyDbFile}.migrated-${new Date().toISOString().slice(0, 10)}`;
    await fs.rename(config.legacyDbFile, moved);
    logger.info(`Migrated ${users.length} users and ${projects.length} projects from db.json to SQLite (old file kept as ${moved})`);
  }

  // ── row writers (the only code that talks to SQLite) ────
  private static writeUser(u: User): void {
    Db.put('users', { id: u.id, email: u.email, doc: JSON.stringify(u) });
  }

  private static writeProject(p: Project): void {
    Db.put('projects', { id: p.id, user_id: p.userId, slug: p.slug, doc: projectDoc(p) });
  }

  private static writeDeployment(d: Deployment): void {
    Db.put('deployments', { id: d.id, project_id: d.projectId, created_at: d.createdAt, doc: JSON.stringify(d) });
  }

  private static writeSession(s: Session): void {
    Db.put('sessions', { id: s.id, user_id: s.userId, family_id: s.familyId, token_hash: s.tokenHash, expires_at: s.expiresAt, doc: JSON.stringify(s) });
  }

  private static writeToken(t: OneTimeToken): void {
    Db.put('tokens', { id: t.id, user_id: t.userId, hash: t.hash, expires_at: t.expiresAt, doc: JSON.stringify(t) });
  }

  /** Consistent snapshot of the database file (see BackupService). */
  static backupTo(file: string): void {
    Db.backupTo(file);
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
    this.writeUser({ ...user, ...patch }); // memory changes only once the row is saved
    Object.assign(user, patch);
    return user;
  }

  static async deleteUser(id: string): Promise<void> {
    Db.tx(() => {
      Db.run('DELETE FROM tokens WHERE user_id = ?', id);
      Db.run('DELETE FROM sessions WHERE user_id = ?', id);
      Db.run('DELETE FROM users WHERE id = ?', id);
    });
    this.db.users = this.db.users.filter((u) => u.id !== id);
    this.db.tokens = this.db.tokens.filter((t) => t.userId !== id);
    this.db.sessions = this.db.sessions.filter((s) => s.userId !== id);
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
    const keep = (s: Session) => new Date(s.expiresAt).getTime() > now && !(s.rotatedAt && now - new Date(s.rotatedAt).getTime() > 24 * 3600_000);
    const dropped = this.db.sessions.filter((s) => !keep(s));
    Db.tx(() => {
      for (const s of dropped) Db.run('DELETE FROM sessions WHERE id = ?', s.id);
      this.writeSession(session);
    });
    this.db.sessions = this.db.sessions.filter(keep);
    this.db.sessions.push(session);
  }

  static async updateSession(id: string, patch: Partial<Session>): Promise<void> {
    const s = this.getSession(id);
    if (!s) return;
    this.writeSession({ ...s, ...patch });
    Object.assign(s, patch);
  }

  private static revokeWhere(match: (s: Session) => boolean): void {
    const at = new Date().toISOString();
    const targets = this.db.sessions.filter((s) => match(s) && !s.revokedAt);
    Db.tx(() => {
      for (const s of targets) this.writeSession({ ...s, revokedAt: at });
    });
    for (const s of targets) s.revokedAt = at;
  }

  static async revokeFamily(familyId: string): Promise<void> {
    this.revokeWhere((s) => s.familyId === familyId);
  }

  static async revokeUserSessions(userId: string): Promise<void> {
    this.revokeWhere((s) => s.userId === userId);
  }

  // ── one-time tokens (email links) ──────────────────────
  /** Stores a new token and invalidates older unused ones of the same kind for that user. */
  static async addToken(token: OneTimeToken): Promise<void> {
    const now = Date.now();
    const keep = (t: OneTimeToken) => new Date(t.expiresAt).getTime() > now && !t.usedAt && !(t.userId === token.userId && t.kind === token.kind);
    const dropped = this.db.tokens.filter((t) => !keep(t));
    Db.tx(() => {
      for (const t of dropped) Db.run('DELETE FROM tokens WHERE id = ?', t.id);
      this.writeToken(token);
    });
    this.db.tokens = this.db.tokens.filter(keep);
    this.db.tokens.push(token);
  }

  /** A valid (unused, unexpired) token of that kind, or undefined. */
  static findToken(hash: string, kind: OneTimeToken['kind']): OneTimeToken | undefined {
    const t = this.db.tokens.find((x) => x.hash === hash && x.kind === kind);
    return t && !t.usedAt && new Date(t.expiresAt).getTime() > Date.now() ? t : undefined;
  }

  static async useToken(id: string): Promise<void> {
    const t = this.db.tokens.find((x) => x.id === id);
    if (!t) return;
    const usedAt = new Date().toISOString();
    this.writeToken({ ...t, usedAt });
    t.usedAt = usedAt;
  }

  static settings(): Settings {
    return this.db.settings;
  }

  static async updateSettings(patch: Partial<Settings>): Promise<Settings> {
    const next = { ...this.db.settings, ...patch };
    Db.put('settings', { key: 'platform', doc: JSON.stringify(next) }, 'key');
    Object.assign(this.db.settings, patch);
    return this.db.settings;
  }

  static async addAudit(actor: User, action: string, target: string, detail = ''): Promise<void> {
    const entry: AuditEntry = { id: this.newId('a'), at: new Date().toISOString(), actorId: actor.id, actorEmail: actor.email, action, target, detail };
    const dropped = this.db.audit.slice(AUDIT_KEPT - 1);
    Db.tx(() => {
      Db.put('audit', { id: entry.id, at: entry.at, doc: JSON.stringify(entry) });
      for (const a of dropped) Db.run('DELETE FROM audit WHERE id = ?', a.id);
    });
    this.db.audit.unshift(entry);
    if (this.db.audit.length > AUDIT_KEPT) this.db.audit.length = AUDIT_KEPT;
  }

  static auditLog(limit: number): AuditEntry[] {
    return this.db.audit.slice(0, limit);
  }

  static async addUser(user: User): Promise<User> {
    if (this.getUserByEmail(user.email)) throw new Error('EMAIL_TAKEN');
    try {
      this.writeUser(user);
    } catch (err) {
      // UNIQUE(email) in the database is the final guard against two sign-ups racing.
      if (/UNIQUE/i.test((err as Error).message)) throw new Error('EMAIL_TAKEN');
      throw err;
    }
    this.db.users.push(user);
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
    this.writeProject(project);
    this.db.projects.push(project);
    return project;
  }

  static async updateProject(id: string, patch: Partial<Project>): Promise<Project> {
    const project = this.getProject(id);
    if (!project) throw new Error(`Project ${id} not found`);
    const full = { ...patch, updatedAt: new Date().toISOString() };
    this.writeProject({ ...project, ...full });
    Object.assign(project, full);
    return project;
  }

  static async deleteProject(id: string): Promise<void> {
    for (const d of this.db.deployments.filter((x) => x.projectId === id)) await DeployLog.remove(d.id);
    Db.tx(() => {
      Db.run('DELETE FROM deployments WHERE project_id = ?', id);
      Db.run('DELETE FROM events WHERE project_id = ?', id);
      Db.run('DELETE FROM projects WHERE id = ?', id);
    });
    this.db.deployments = this.db.deployments.filter((d) => d.projectId !== id);
    this.db.projects = this.db.projects.filter((p) => p.id !== id);
    this.db.events = this.db.events.filter((e) => e.projectId !== id);
  }

  // ── billing ────────────────────────────────────────────
  static hasWebhookEvent(id: string): boolean {
    return this.db.webhookEvents.includes(id);
  }

  /** true the first time an event id is seen; later deliveries of the same event are ignored. */
  static async markWebhookEvent(id: string): Promise<boolean> {
    if (this.db.webhookEvents.includes(id)) return false;
    const dropped = this.db.webhookEvents.slice(WEBHOOK_EVENTS_KEPT - 1);
    Db.tx(() => {
      Db.put('webhook_events', { id, at: new Date().toISOString() });
      for (const old of dropped) Db.run('DELETE FROM webhook_events WHERE id = ?', old);
    });
    this.db.webhookEvents.unshift(id);
    this.db.webhookEvents.length = Math.min(this.db.webhookEvents.length, WEBHOOK_EVENTS_KEPT);
    return true;
  }

  static userBySubscription(subscriptionId: string): User | undefined {
    return this.db.users.find((u) => u.subscription?.id === subscriptionId);
  }

  // ── admin notifications ────────────────────────────────
  static async addAdminNotification(n: AdminNotification): Promise<void> {
    const dropped = this.db.adminNotifications.slice(ADMIN_NOTIFICATIONS_KEPT - 1);
    Db.tx(() => {
      Db.put('admin_notifications', { id: n.id, at: n.at, dedupe_key: n.dedupeKey, doc: JSON.stringify(n) });
      for (const old of dropped) Db.run('DELETE FROM admin_notifications WHERE id = ?', old.id);
    });
    const droppedIds = new Set(dropped.map((x) => x.id));
    this.db.adminNotifications = [n, ...this.db.adminNotifications.filter((x) => !droppedIds.has(x.id))];
  }

  static adminNotifications(limit = 200): AdminNotification[] {
    return this.db.adminNotifications.slice(0, limit);
  }

  /** Newest notification with this dedupe key (to decide whether an alert is a repeat). */
  static lastAdminNotification(dedupeKey: string): AdminNotification | undefined {
    return this.db.adminNotifications.find((n) => n.dedupeKey === dedupeKey);
  }

  /** Marks the given notifications (or all when `ids` is null) as read. */
  static async markAdminNotificationsRead(ids: string[] | null): Promise<number> {
    const at = new Date().toISOString();
    const targets = this.db.adminNotifications.filter((n) => !n.readAt && (ids === null || ids.includes(n.id)));
    Db.tx(() => {
      for (const n of targets) Db.put('admin_notifications', { id: n.id, at: n.at, dedupe_key: n.dedupeKey, doc: JSON.stringify({ ...n, readAt: at }) });
    });
    for (const n of targets) n.readAt = at;
    return targets.length;
  }

  // ── runtime events ─────────────────────────────────────
  static async addEvent(projectId: string, kind: ProjectEvent['kind'], message: string): Promise<void> {
    const event: ProjectEvent = { id: this.newId('e'), projectId, at: new Date().toISOString(), kind, message };
    const dropped = this.eventsOf(projectId, Number.MAX_SAFE_INTEGER).slice(EVENTS_PER_PROJECT - 1);
    Db.tx(() => {
      Db.put('events', { id: event.id, project_id: projectId, at: event.at, doc: JSON.stringify(event) });
      for (const e of dropped) Db.run('DELETE FROM events WHERE id = ?', e.id);
    });
    const droppedIds = new Set(dropped.map((e) => e.id));
    this.db.events = [event, ...this.db.events.filter((e) => !droppedIds.has(e.id))];
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
    const older = this.deploymentsOf(deployment.projectId).slice(config.limits.deploymentsKept - 1);
    Db.tx(() => {
      this.writeDeployment(deployment);
      for (const old of older) Db.run('DELETE FROM deployments WHERE id = ?', old.id);
    });
    const olderIds = new Set(older.map((d) => d.id));
    this.db.deployments = [...this.db.deployments.filter((d) => !olderIds.has(d.id)), deployment];
    for (const old of older) await DeployLog.remove(old.id);
    return deployment;
  }

  static async updateDeployment(id: string, patch: Partial<Deployment>): Promise<Deployment> {
    const deployment = this.getDeployment(id);
    if (!deployment) throw new Error(`Deployment ${id} not found`);
    this.writeDeployment({ ...deployment, ...patch });
    Object.assign(deployment, patch);
    return deployment;
  }
}

/**
 * What a user may use. With billing off, the old behaviour stays: per-user override, admin setting or
 * HOSTX_MAX_PROJECTS, and the global HOSTX_APP_MEMORY / HOSTX_APP_CPUS.
 */
export function limitsFor(user: User | undefined): PlanLimits {
  const legacyProjects = Store.settings().maxProjectsPerUser ?? config.limits.maxProjectsPerUser;
  const base: PlanLimits = billingEnabled() && user
    ? PLANS[user.plan]
    : { projects: legacyProjects, databases: 1000, customDomains: 1000, databaseMb: Number(process.env.HOSTX_DATABASE_MB ?? 5120), memory: config.limits.memory, cpus: config.limits.cpus };
  // Admins are never limited by plans; an admin-set project limit always wins.
  const admin = user?.role === 'admin';
  return {
    ...base,
    projects: user?.maxProjects ?? (admin ? Math.max(base.projects, 100) : base.projects),
  };
}
