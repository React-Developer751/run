import crypto from 'node:crypto';
import os from 'node:os';
import { config, projectUrl } from '../config/index.js';
import type { Ctx } from '../utils/http.js';
import { HttpError } from '../utils/http.js';
import { exec } from '../utils/exec.js';
import { AuthService } from '../services/auth.service.js';
import { PLANS, PLAN_IDS, billingEnabled, getPlan, isPlanId, paymentSettings, razorpayReady, razorpayPlanId, type EditablePlan, type PaymentSettings, type PlanId, type PlanOverrides } from '../config/plans.js';
import { UpiService } from '../services/upi.service.js';
import { BillingService } from '../services/billing.service.js';
import { AccountService } from '../services/account.service.js';
import { DeployService, assertCanStart, assertCanStop } from '../services/deploy.service.js';
import { StorageMonitorService } from '../services/storage-monitor.service.js';
import { DeployLog } from '../services/log.service.js';
import { RunnerService } from '../services/runner.service.js';
import { Store, BUSINESS_FIELDS, type BusinessDetails, DEFAULT_SITE_NAME, SITE_NAME_PATTERN, siteName, type Project, type User } from '../services/store.service.js';
import { toPublicDeployment } from './deploy.controller.js';
import { MailService } from '../services/mail.service.js';

const DAY = 24 * 60 * 60 * 1000;
const admin = (ctx: Ctx): User => AuthService.requireAdmin(ctx.user);

// ── shapes ────────────────────────────────────────────────
const userRow = (u: User) => {
  const mine = Store.projectsOf(u.id);
  return {
    id: u.id,
    name: u.name,
    email: u.email,
    role: u.role,
    suspended: u.suspended,
    maxProjects: u.maxProjects,
    plan: u.plan,
    subscriptionStatus: u.subscription?.status ?? null,
    createdAt: u.createdAt,
    lastLoginAt: u.lastLoginAt,
    projects: mine.length,
    liveProjects: mine.filter((p) => p.status === 'live').length,
  };
};

/** Admin view of a project: operational data only. Env values and webhook secrets stay with the owner. */
const projectRow = (p: Project) => {
  const owner = Store.getUserById(p.userId);
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    url: projectUrl(p.slug),
    repoUrl: p.repoUrl,
    branch: p.branch,
    rootDir: p.rootDir,
    kind: p.kind,
    framework: p.framework,
    status: p.status,
    suspendedAt: p.suspendedAt,
    suspendedReason: p.suspendedReason,
    runtime: p.runtime,
    port: p.port,
    commit: p.commit,
    autoDeploy: p.autoDeploy,
    currentDeploymentId: p.currentDeploymentId,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    owner: { id: p.userId, name: owner?.name ?? 'deleted user', email: owner?.email ?? '' },
  };
};

function projectOf(ctx: Ctx): Project {
  const project = Store.getProject(ctx.params.id ?? '');
  if (!project) throw new HttpError(404, 'Project not found');
  return project;
}

// ── disk usage (cached: walking apps/ with node_modules is slow) ──
let diskCache: { at: number; data: number; apps: number } | null = null;
async function dirBytes(dir: string): Promise<number> {
  try {
    const { stdout } = await exec('du', ['-sk', dir], { timeoutMs: 10_000 });
    return (Number.parseInt(stdout.split(/\s/)[0] ?? '0', 10) || 0) * 1024;
  } catch {
    return 0;
  }
}
async function diskUsage() {
  if (!diskCache || Date.now() - diskCache.at > 60_000) {
    diskCache = { at: Date.now(), data: await dirBytes(config.dataDir), apps: await dirBytes(config.appsDir) };
  }
  return diskCache;
}

export class AdminController {
  static async stats(ctx: Ctx) {
    admin(ctx);
    const now = Date.now();
    const users = Store.allUsers();
    const projects = Store.allProjects();
    const deployments = Store.allDeployments();
    const recent = deployments.filter((d) => now - new Date(d.createdAt).getTime() < DAY);
    const count = (s: Project['status']) => projects.filter((p) => p.status === s).length;

    const days = Array.from({ length: 7 }, (_, i) => {
      const start = new Date();
      start.setHours(0, 0, 0, 0);
      start.setDate(start.getDate() - (6 - i));
      const end = start.getTime() + DAY;
      const inDay = deployments.filter((d) => {
        const t = new Date(d.createdAt).getTime();
        return t >= start.getTime() && t < end;
      });
      const date = `${start.getFullYear()}-${String(start.getMonth() + 1).padStart(2, '0')}-${String(start.getDate()).padStart(2, '0')}`;
      return { date, total: inDay.length, failed: inDay.filter((d) => d.status === 'failed').length };
    });

    const disk = await diskUsage();
    return {
      users: {
        total: users.length,
        admins: users.filter((u) => u.role === 'admin').length,
        suspended: users.filter((u) => u.suspended).length,
        newLast7d: users.filter((u) => now - new Date(u.createdAt).getTime() < 7 * DAY).length,
      },
      projects: {
        total: projects.length,
        live: count('live'),
        deploying: count('deploying'),
        failed: count('failed'),
        stopped: count('stopped'),
        crashed: count('crashed'),
        paused: count('paused'),
        archived: count('archived'),
        suspended: count('suspended'),
        static: projects.filter((p) => p.kind === 'static').length,
        node: projects.filter((p) => p.kind === 'node').length,
      },
      deployments: {
        total: deployments.length,
        last24h: recent.length,
        failed24h: recent.filter((d) => d.status === 'failed').length,
        auto24h: recent.filter((d) => d.trigger === 'auto').length,
        perDay: days,
      },
      platform: {
        runner: RunnerService.current().name,
        pollSeconds: config.pollSeconds,
        portsUsed: Store.usedPorts().size,
        portsTotal: config.portRange.max - config.portRange.min + 1,
        uptimeSeconds: Math.round(process.uptime()),
        nodeVersion: process.version,
        os: { platform: os.platform(), cpus: os.cpus().length, loadavg: os.loadavg(), totalMem: os.totalmem(), freeMem: os.freemem() },
        disk: { dataBytes: disk.data, appsBytes: disk.apps },
        baseDomain: config.baseDomain,
      },
      settings: effectiveSettings(),
    };
  }

  // ── users ───────────────────────────────────────────────
  static users(ctx: Ctx) {
    admin(ctx);
    return { users: [...Store.allUsers()].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).map(userRow) };
  }

  static async updateUser(ctx: Ctx) {
    const actor = admin(ctx);
    const target = Store.getUserById(ctx.params.id ?? '');
    if (!target) throw new HttpError(404, 'User not found');
    const body = await ctx.json();
    const patch: Partial<User> = {};
    const notes: string[] = [];

    if (body.role !== undefined) {
      if (body.role !== 'admin' && body.role !== 'user') throw new HttpError(400, 'role must be "admin" or "user"');
      if (body.role !== target.role) {
        if (target.id === actor.id) throw new HttpError(400, 'You cannot change your own role');
        patch.role = body.role;
        notes.push(`role=${body.role}`);
      }
    }
    if (body.suspended !== undefined) {
      if (typeof body.suspended !== 'boolean') throw new HttpError(400, 'suspended must be true or false');
      if (body.suspended !== target.suspended) {
        if (target.id === actor.id) throw new HttpError(400, 'You cannot suspend yourself');
        patch.suspended = body.suspended;
        notes.push(body.suspended ? 'suspended' : 'reactivated');
      }
    }
    if (body.maxProjects !== undefined) {
      const v = body.maxProjects;
      if (v !== null && (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 100)) throw new HttpError(400, 'maxProjects must be a whole number 0-100, or null for the default');
      if (v !== target.maxProjects) {
        patch.maxProjects = v as number | null;
        notes.push(`maxProjects=${String(v)}`);
      }
    }

    let newPlan: string | null = null;
    if (body.plan !== undefined) {
      if (!isPlanId(body.plan)) throw new HttpError(400, 'plan must be free, starter or pro');
      if (body.plan !== target.plan) {
        const sub = target.subscription;
        if (sub && ['created', 'active', 'pending', 'cancelling'].includes(sub.status)) {
          throw new HttpError(409, 'This user has a Razorpay subscription. Cancel it (or wait for it to end) before changing the plan by hand.');
        }
        newPlan = body.plan;
        notes.push(`plan=${body.plan}`);
      }
    }

    const losesAdmin = (patch.role === 'user' && target.role === 'admin') || (patch.suspended === true && target.role === 'admin');
    if (losesAdmin && !Store.allUsers().some((u) => u.id !== target.id && u.role === 'admin' && !u.suspended)) {
      throw new HttpError(400, 'At least one active administrator must remain');
    }

    let updated = await Store.updateUser(target.id, patch);
    // Granted by hand (e.g. a free upgrade): applied to running apps right away, independent of any payment.
    if (newPlan && isPlanId(newPlan)) {
      await BillingService.setPlan(updated, newPlan, `set by admin ${actor.email}`);
      // A plan set by hand has no end date (it replaces any UPI-paid period).
      updated = await Store.updateUser(target.id, { manualPlanUntil: null, manualPlanRemindedAt: null });
    }
    if (patch.suspended === true || patch.role !== undefined) await Store.revokeUserSessions(target.id);
    if (patch.suspended === true) {
      // A suspended account's apps go offline immediately.
      for (const p of Store.projectsOf(target.id)) {
        if (p.runtime !== null && ['live', 'crashed', 'paused'].includes(p.status)) await DeployService.stop(p).catch(() => undefined);
      }
    }
    if (notes.length) await Store.addAudit(actor, 'user.update', target.email, notes.join(', '));
    return { user: userRow(updated) };
  }

  /** Sets a random temporary password (shown once) and signs the user out everywhere. */
  static async resetPassword(ctx: Ctx) {
    const actor = admin(ctx);
    const target = Store.getUserById(ctx.params.id ?? '');
    if (!target) throw new HttpError(404, 'User not found');
    if (target.id === actor.id) throw new HttpError(400, 'Use the Account page to change your own password');

    const password = crypto.randomBytes(9).toString('base64url'); // 12 URL-safe characters
    await Store.updateUser(target.id, { passwordHash: await AuthService.hashPassword(password), passwordChangedAt: new Date().toISOString() });
    await Store.revokeUserSessions(target.id);
    await Store.addAudit(actor, 'user.reset-password', target.email);
    return { password };
  }

  static async deleteUser(ctx: Ctx) {
    const actor = admin(ctx);
    const target = Store.getUserById(ctx.params.id ?? '');
    if (!target) throw new HttpError(404, 'User not found');
    if (target.id === actor.id) throw new HttpError(400, 'You cannot delete your own account');
    if (target.role === 'admin' && !Store.allUsers().some((u) => u.id !== target.id && u.role === 'admin' && !u.suspended)) {
      throw new HttpError(400, 'At least one active administrator must remain');
    }
    const removed = await AccountService.delete(target, true);
    await Store.addAudit(actor, 'user.delete', target.email, `removed ${removed} project(s)`);
    return { ok: true };
  }

  // ── projects ────────────────────────────────────────────
  static projects(ctx: Ctx) {
    admin(ctx);
    return { projects: [...Store.allProjects()].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).map(projectRow) };
  }

  static async stop(ctx: Ctx) {
    const actor = admin(ctx);
    const p = projectOf(ctx);
    assertCanStop(p);
    await DeployService.stop(p);
    await Store.addAudit(actor, 'project.stop', p.slug);
    return { project: projectRow(p) };
  }

  static async start(ctx: Ctx) {
    const actor = admin(ctx);
    const p = projectOf(ctx);
    assertCanStart(p);
    if (Store.getUserById(p.userId)?.suspended) throw new HttpError(409, 'The owner is suspended. Reactivate the account first.');
    await DeployService.start(p);
    await Store.addAudit(actor, 'project.start', p.slug);
    return { project: projectRow(p) };
  }

  /** Render-style "suspend service": offline, owner locked out of start/deploy until an admin lifts it. */
  static async suspendProject(ctx: Ctx) {
    const actor = admin(ctx);
    const p = projectOf(ctx);
    if (p.suspendedAt) throw new HttpError(409, 'This app is already suspended');
    const body = await ctx.json();
    const reason = typeof body.reason === 'string' ? body.reason.replace(/[\u0000-\u001f\u007f]/g, ' ').trim() : '';
    if (reason.length < 5 || reason.length > 300) throw new HttpError(400, 'Give a reason the owner will see (5-300 characters)');
    const updated = await DeployService.suspend(p, reason);
    await Store.addEvent(p.id, 'suspended', `Suspended by the administrators: ${reason}`);
    await Store.addAudit(actor, 'project.suspend', p.slug, reason);
    const owner = Store.getUserById(p.userId);
    if (owner) {
      void MailService.appAlert(
        owner.email,
        owner.name,
        `${p.name} was suspended`,
        `your app "${p.name}" was suspended by the ${siteName()} administrators and is offline. Reason: ${reason}. Your code, settings and data are kept. If you think this is a mistake, or once you have fixed the problem, open a Support request from your dashboard to have it reviewed.`,
        `${config.dashboardUrl}/projects/${p.id}`,
      );
    }
    return { project: projectRow(updated) };
  }

  static async unsuspendProject(ctx: Ctx) {
    const actor = admin(ctx);
    const p = projectOf(ctx);
    if (!p.suspendedAt) throw new HttpError(409, 'This app is not suspended');
    const updated = await DeployService.unsuspend(p);
    await Store.addEvent(p.id, 'unsuspended', 'Suspension lifted by the administrators.');
    await Store.addAudit(actor, 'project.unsuspend', p.slug, p.suspendedReason ?? '');
    const owner = Store.getUserById(p.userId);
    if (owner) {
      void MailService.appAlert(
        owner.email,
        owner.name,
        `${p.name} is no longer suspended`,
        `the suspension of your app "${p.name}" was lifted. ${updated.status === 'live' ? 'It is running again.' : 'Start or redeploy it from your dashboard.'}`,
        `${config.dashboardUrl}/projects/${p.id}`,
      );
    }
    return { project: projectRow(updated) };
  }

  // ── UPI payments ────────────────────────────────────────
  static payments(ctx: Ctx) {
    admin(ctx);
    const rows = Store.allUpiPayments().map((p) => {
      const u = Store.getUserById(p.userId);
      return { ...p, userName: u?.name ?? 'Deleted user', userEmail: u?.email ?? '', userPlan: u?.plan ?? null, userPaidUntil: u?.manualPlanUntil ?? null };
    });
    return { payments: rows, pending: rows.filter((p) => p.status === 'pending').length };
  }

  static async approvePayment(ctx: Ctx) {
    const actor = admin(ctx);
    return { payment: await UpiService.approve(ctx.params.id ?? '', actor) };
  }

  static async rejectPayment(ctx: Ctx) {
    const actor = admin(ctx);
    const body = await ctx.json();
    return { payment: await UpiService.reject(ctx.params.id ?? '', actor, body.reason) };
  }

  static async redeploy(ctx: Ctx) {
    const actor = admin(ctx);
    const p = projectOf(ctx);
    const deployment = await DeployService.deploy(p, 'redeploy');
    await Store.addAudit(actor, 'project.redeploy', p.slug);
    ctx.status = 202;
    return { deployment: toPublicDeployment(deployment) };
  }

  static async remove(ctx: Ctx) {
    const actor = admin(ctx);
    const p = projectOf(ctx);
    if (p.status === 'deploying') throw new HttpError(409, 'Wait for the deployment to finish before deleting');
    await DeployService.remove(p);
    await Store.addAudit(actor, 'project.delete', p.slug, `owner ${Store.getUserById(p.userId)?.email ?? 'unknown'}`);
    return { ok: true };
  }

  static async deploymentLogs(ctx: Ctx) {
    admin(ctx);
    const p = projectOf(ctx);
    const d = Store.getDeployment(ctx.params.did ?? '');
    if (!d || d.projectId !== p.id) throw new HttpError(404, 'Deployment not found');
    const after = Math.max(0, Number.parseInt(ctx.query.get('after') ?? '0', 10) || 0);
    const { lines, next } = await DeployLog.read(d.id, after);
    return { lines, next, status: d.status, error: d.error };
  }

  static async runtimeLogs(ctx: Ctx) {
    admin(ctx);
    const p = projectOf(ctx);
    return { logs: p.runtime ? await RunnerService.for(p).runtimeLogs(p, 300) : '' };
  }

  // ── deployments feed ────────────────────────────────────
  static deployments(ctx: Ctx) {
    admin(ctx);
    const limit = Math.min(200, Math.max(10, Number.parseInt(ctx.query.get('limit') ?? '60', 10) || 60));
    const rows = [...Store.allDeployments()]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, limit)
      .map((d) => {
        const p = Store.getProject(d.projectId);
        return {
          ...toPublicDeployment(d),
          projectId: d.projectId,
          projectName: p?.name ?? 'deleted',
          slug: p?.slug ?? '',
          owner: p ? (Store.getUserById(p.userId)?.email ?? '') : '',
        };
      });
    return { deployments: rows };
  }

  // ── settings & audit ────────────────────────────────────
  static getSettings(ctx: Ctx) {
    admin(ctx);
    return { settings: effectiveSettings() };
  }

  static async updateSettings(ctx: Ctx) {
    const actor = admin(ctx);
    const body = await ctx.json();
    const patch: Partial<ReturnType<typeof Store.settings>> = {};
    if (body.allowSignup !== undefined) {
      if (typeof body.allowSignup !== 'boolean') throw new HttpError(400, 'allowSignup must be true or false');
      patch.allowSignup = body.allowSignup;
    }
    if (body.siteName !== undefined) {
      // null or "" = back to the default name.
      if (body.siteName !== null && typeof body.siteName !== 'string') throw new HttpError(400, 'siteName must be text');
      const name = typeof body.siteName === 'string' ? body.siteName.trim().replace(/\s+/g, ' ') : '';
      if (name && !SITE_NAME_PATTERN.test(name)) {
        throw new HttpError(400, 'Website name: 2-40 characters, letters, numbers, spaces and . & \' ! + _ - only');
      }
      const next = name && name !== DEFAULT_SITE_NAME ? name : null;
      if (next !== (Store.settings().siteName ?? null)) patch.siteName = next;
    }
    if (body.payments !== undefined) {
      const next = validatePayments(body.payments);
      if (JSON.stringify(next) !== JSON.stringify(paymentSettings())) patch.payments = next;
    }
    if (body.business !== undefined) {
      const next = validateBusiness(body.business);
      if (JSON.stringify(next) !== JSON.stringify(Store.settings().business ?? {})) patch.business = next;
    }
    if (body.maxProjectsPerUser !== undefined) {
      const v = body.maxProjectsPerUser;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 100) throw new HttpError(400, 'maxProjectsPerUser must be a whole number 0-100');
      patch.maxProjectsPerUser = v;
    }
    // Plans: `plans: { starter: { webServices: 20 } }` changes fields, `resetPlan: "starter"` goes back to the defaults.
    const resized: PlanId[] = [];
    if (body.plans !== undefined || body.resetPlan !== undefined) {
      const next: PlanOverrides = structuredClone(Store.settings().plans ?? {});
      if (body.resetPlan !== undefined) {
        if (!isPlanId(body.resetPlan)) throw new HttpError(400, 'resetPlan must be free, starter or pro');
        delete next[body.resetPlan];
        resized.push(body.resetPlan);
      }
      if (body.plans !== undefined) {
        if (!body.plans || typeof body.plans !== 'object') throw new HttpError(400, 'plans must be an object');
        for (const [id, raw] of Object.entries(body.plans as Record<string, unknown>)) {
          if (!isPlanId(id)) throw new HttpError(400, `Unknown plan ${id}`);
          const changes = validatePlanPatch(id, raw);
          next[id] = { ...(next[id] ?? {}), ...changes };
          // An empty Razorpay plan id means "use the one from the server environment".
          if (next[id]?.razorpayPlanId === '') delete next[id]!.razorpayPlanId;
          if (changes.memory !== undefined || changes.cpus !== undefined) resized.push(id);
        }
      }
      for (const id of PLAN_IDS) {
        const merged = { ...PLANS[id], ...next[id] };
        if (merged.pauseAfterDays !== null && merged.archiveAfterDays !== null && merged.archiveAfterDays <= merged.pauseAfterDays + 7) {
          throw new HttpError(400, `${merged.name}: archive must be at least 8 days after pause (a warning email goes out 7 days before)`);
        }
      }
      patch.plans = next;
    }
    if (!Object.keys(patch).length) return { settings: effectiveSettings() };
    await Store.updateSettings(patch);
    await Store.addAudit(actor, 'settings.update', 'platform', JSON.stringify({ ...patch, ...(body.resetPlan ? { resetPlan: body.resetPlan } : {}) }));
    // New RAM/CPU apply to running apps right away (Docker), not only on their next deploy.
    for (const id of new Set(resized)) await BillingService.applyPlanLimits(id);
    return { settings: effectiveSettings() };
  }

  // ── notifications & storage ─────────────────────────────
  static notifications(ctx: Ctx) {
    admin(ctx);
    const limit = Math.min(500, Math.max(1, Number.parseInt(ctx.query.get('limit') ?? '200', 10) || 200));
    const all = Store.adminNotifications(500);
    const names = (id: string | null) => (id ? (Store.getProject(id)?.name ?? null) : null);
    return {
      unread: all.filter((n) => !n.readAt).length,
      notifications: all.slice(0, limit).map((n) => ({ ...n, projectName: names(n.projectId) })),
    };
  }

  /** Marks notifications read: `ids` given -> those, otherwise all. */
  static async readNotifications(ctx: Ctx) {
    admin(ctx);
    const body = await ctx.json();
    const ids = Array.isArray(body.ids) ? body.ids.filter((x): x is string => typeof x === 'string').slice(0, 500) : null;
    return { marked: await Store.markAdminNotificationsRead(ids) };
  }

  static storage(ctx: Ctx) {
    admin(ctx);
    return StorageMonitorService.lastReport();
  }

  static async checkStorage(ctx: Ctx) {
    admin(ctx);
    return StorageMonitorService.check();
  }

  static audit(ctx: Ctx) {
    admin(ctx);
    const limit = Math.min(500, Math.max(10, Number.parseInt(ctx.query.get('limit') ?? '100', 10) || 100));
    return { entries: Store.auditLog(limit) };
  }
}

function effectiveSettings() {
  const s = Store.settings();
  return {
    siteName: siteName(),
    defaultSiteName: DEFAULT_SITE_NAME,
    business: s.business ?? {},
    // Where users' apps live (<slug>.<appsDomain>); set by HOSTX_BASE_DOMAIN or derived from the dashboard domain.
    appUrlTemplate: projectUrl('{name}'),
    appsDomain: config.baseDomain,
    appsDomainAuto: config.baseDomainAuto,
    allowSignup: s.allowSignup ?? config.allowSignup,
    maxProjectsPerUser: s.maxProjectsPerUser ?? config.limits.maxProjectsPerUser,
    billingEnabled: billingEnabled(),
    // Keys set but no plan id yet: the plan editor is shown so the admin can paste one.
    razorpayKeys: BillingService.hasKeys(),
    // Razorpay keys + webhook secret + a plan id: what "Razorpay on" needs to actually work.
    razorpayReady: razorpayReady(),
    payments: paymentSettings(),
    pendingPayments: Store.allUpiPayments().filter((p) => p.status === 'pending').length,
    // Current plan values, which of them the admin changed, and the defaults to go back to.
    plans: PLAN_IDS.map((id) => {
      const { projects: _total, id: _id, ...current } = getPlan(id);
      const { projects: _t, id: _i, ...defaults } = PLANS[id];
      return {
        id,
        ...current,
        razorpayPlanId: razorpayPlanId(id),
        customized: Object.keys(s.plans?.[id] ?? {}),
        defaults: { ...defaults, razorpayPlanId: id === 'free' ? '' : config.razorpay.planIds[id] },
        users: Store.allUsers().filter((u) => u.plan === id).length,
      };
    }),
  };
}

/** Payment methods from the admin form, merged over the current ones. */
function validatePayments(raw: unknown): PaymentSettings {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, 'payments must be an object');
  const b = raw as { razorpayEnabled?: unknown; upi?: Record<string, unknown> };
  const current = paymentSettings();
  const next: PaymentSettings = { razorpayEnabled: current.razorpayEnabled, upi: { ...current.upi } };
  if (b.razorpayEnabled !== undefined) {
    if (typeof b.razorpayEnabled !== 'boolean') throw new HttpError(400, 'razorpayEnabled must be true or false');
    next.razorpayEnabled = b.razorpayEnabled;
  }
  if (b.upi !== undefined) {
    if (!b.upi || typeof b.upi !== 'object') throw new HttpError(400, 'upi must be an object');
    const u = b.upi;
    const text = (v: unknown, field: string, max: number) => {
      if (typeof v !== 'string') throw new HttpError(400, `${field} must be text`);
      const t = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
      if (t.length > max) throw new HttpError(400, `${field} is too long (max ${max} characters)`);
      return t;
    };
    if (u.vpa !== undefined) {
      const vpa = text(u.vpa, 'UPI ID', 100).toLowerCase();
      if (vpa && !/^[a-z0-9._-]{2,64}@[a-z][a-z0-9]{1,63}$/.test(vpa)) throw new HttpError(400, 'UPI ID looks like yourname@bank (e.g. deploykaro@okicici)');
      next.upi.vpa = vpa;
    }
    if (u.payeeName !== undefined) {
      const name = text(u.payeeName, 'Payee name', 60);
      if (name && !/^[\p{L}\p{N} .&'-]{2,60}$/u.test(name)) throw new HttpError(400, 'Payee name: letters, numbers, spaces and . & \' - only');
      next.upi.payeeName = name;
    }
    if (u.note !== undefined) next.upi.note = text(u.note, 'Note', 200);
    if (u.enabled !== undefined) {
      if (typeof u.enabled !== 'boolean') throw new HttpError(400, 'upi.enabled must be true or false');
      next.upi.enabled = u.enabled;
    }
    if (next.upi.enabled && (!next.upi.vpa || !next.upi.payeeName)) throw new HttpError(400, 'Enter the UPI ID and payee name before switching UPI on');
  }
  return next;
}

const EMAIL_FIELDS = new Set(['email', 'abuseEmail', 'grievanceEmail']);
const BUSINESS_LIMITS: Record<(typeof BUSINESS_FIELDS)[number], number> = {
  company: 120, address: 300, email: 254, phone: 30, abuseEmail: 254, grievanceOfficer: 120, grievanceEmail: 254, jurisdiction: 120,
};

/** Business details from the admin form. Every field optional; "" removes it (the page then uses the env value). */
function validateBusiness(raw: unknown): BusinessDetails {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, 'business must be an object');
  const b = raw as Record<string, unknown>;
  const out: BusinessDetails = {};
  for (const field of BUSINESS_FIELDS) {
    const v = b[field];
    if (v === undefined || v === null) continue;
    if (typeof v !== 'string') throw new HttpError(400, `${field} must be text`);
    // One line, no control characters (these values end up in pages, mailto: links and emails).
    const value = v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    if (!value) continue;
    if (value.length > BUSINESS_LIMITS[field]) throw new HttpError(400, `${field} is too long (max ${BUSINESS_LIMITS[field]} characters)`);
    if (EMAIL_FIELDS.has(field) && !/^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(value)) throw new HttpError(400, `${field} must be a valid email address`);
    if (field === 'phone' && !/^\+?[0-9][0-9 ()-]{5,28}$/.test(value)) throw new HttpError(400, 'phone may contain digits, spaces, + ( ) and - only');
    out[field] = value;
  }
  return out;
}

const intIn = (v: unknown, min: number, max: number, field: string): number => {
  if (typeof v !== 'number' || !Number.isInteger(v) || v < min || v > max) throw new HttpError(400, `${field} must be a whole number ${min}-${max}`);
  return v;
};

/** Validates one plan's changes from the admin form. Only known fields; days may be null (= never). */
function validatePlanPatch(id: PlanId, raw: unknown): Partial<EditablePlan> {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new HttpError(400, `plans.${id} must be an object`);
  const b = raw as Record<string, unknown>;
  const out: Partial<EditablePlan> = {};
  const label = (f: string) => `${getPlan(id).name}: ${f}`;
  if (b.name !== undefined) {
    if (typeof b.name !== 'string' || b.name.trim().length < 2 || b.name.trim().length > 30) throw new HttpError(400, label('name must be 2-30 characters'));
    out.name = b.name.trim();
  }
  if (b.priceInr !== undefined) out.priceInr = intIn(b.priceInr, 0, 1_000_000, label('price'));
  if (b.webServices !== undefined) out.webServices = intIn(b.webServices, 0, 10_000, label('web services'));
  if (b.staticSites !== undefined) out.staticSites = intIn(b.staticSites, 0, 10_000, label('static sites'));
  if (b.customDomains !== undefined) out.customDomains = intIn(b.customDomains, 0, 10_000, label('custom domains'));
  if (b.rollbackImages !== undefined) out.rollbackImages = intIn(b.rollbackImages, 1, 10, label('rollback versions'));
  if (b.memory !== undefined) {
    if (typeof b.memory !== 'string' || !/^\d{2,5}m$|^\d{1,2}(\.\d)?g$/.test(b.memory)) throw new HttpError(400, label('memory must look like 512m or 1g'));
    out.memory = b.memory;
  }
  if (b.cpus !== undefined) {
    const n = Number(b.cpus);
    if (typeof b.cpus !== 'string' || !Number.isFinite(n) || n < 0.1 || n > 32) throw new HttpError(400, label('CPU must be between 0.1 and 32'));
    out.cpus = String(n);
  }
  for (const key of ['pauseAfterDays', 'archiveAfterDays'] as const) {
    if (b[key] === undefined) continue;
    out[key] = b[key] === null ? null : intIn(b[key], 1, 3650, label(key === 'pauseAfterDays' ? 'pause after (days)' : 'archive after (days)'));
  }
  if (b.razorpayPlanId !== undefined) {
    if (id === 'free') throw new HttpError(400, 'The Free plan has no Razorpay plan');
    if (typeof b.razorpayPlanId !== 'string' || (b.razorpayPlanId !== '' && !/^plan_[A-Za-z0-9]{6,30}$/.test(b.razorpayPlanId))) {
      throw new HttpError(400, label('Razorpay plan id looks like plan_XXXXXXXXXXXXXX'));
    }
    out.razorpayPlanId = b.razorpayPlanId;
  }
  return out;
}
