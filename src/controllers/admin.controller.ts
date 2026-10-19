import crypto from 'node:crypto';
import os from 'node:os';
import { config, projectUrl } from '../config/index.js';
import type { Ctx } from '../utils/http.js';
import { HttpError } from '../utils/http.js';
import { exec } from '../utils/exec.js';
import { AuthService } from '../services/auth.service.js';
import { DeployService } from '../services/deploy.service.js';
import { DeployLog } from '../services/log.service.js';
import { RunnerService } from '../services/runner.service.js';
import { Store, type Project, type User } from '../services/store.service.js';
import { toPublicDeployment } from './deploy.controller.js';

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
      return { date: start.toISOString().slice(0, 10), total: inDay.length, failed: inDay.filter((d) => d.status === 'failed').length };
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
      patch.maxProjects = v as number | null;
      notes.push(`maxProjects=${String(v)}`);
    }

    const losesAdmin = (patch.role === 'user' && target.role === 'admin') || (patch.suspended === true && target.role === 'admin');
    if (losesAdmin && !Store.allUsers().some((u) => u.id !== target.id && u.role === 'admin' && !u.suspended)) {
      throw new HttpError(400, 'At least one active administrator must remain');
    }

    const updated = await Store.updateUser(target.id, patch);
    if (patch.suspended === true || patch.role !== undefined) await Store.revokeUserSessions(target.id);
    if (patch.suspended === true) {
      // A suspended account's apps go offline immediately.
      for (const p of Store.projectsOf(target.id)) {
        if (p.status === 'live') await DeployService.stop(p).catch(() => undefined);
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
    const theirs = Store.projectsOf(target.id);
    if (theirs.some((p) => p.status === 'deploying')) throw new HttpError(409, 'This user has a deployment in progress. Try again in a minute.');

    for (const p of theirs) await DeployService.remove(p);
    await Store.revokeUserSessions(target.id);
    await Store.deleteUser(target.id);
    await Store.addAudit(actor, 'user.delete', target.email, `removed ${theirs.length} project(s)`);
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
    if (p.status === 'deploying') throw new HttpError(409, 'A deployment is in progress');
    await DeployService.stop(p);
    await Store.addAudit(actor, 'project.stop', p.slug);
    return { project: projectRow(p) };
  }

  static async start(ctx: Ctx) {
    const actor = admin(ctx);
    const p = projectOf(ctx);
    if (p.status === 'deploying') throw new HttpError(409, 'A deployment is in progress');
    if (Store.getUserById(p.userId)?.suspended) throw new HttpError(409, 'The owner is suspended. Reactivate the account first.');
    await DeployService.start(p);
    await Store.addAudit(actor, 'project.start', p.slug);
    return { project: projectRow(p) };
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
    if (body.maxProjectsPerUser !== undefined) {
      const v = body.maxProjectsPerUser;
      if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 100) throw new HttpError(400, 'maxProjectsPerUser must be a whole number 0-100');
      patch.maxProjectsPerUser = v;
    }
    await Store.updateSettings(patch);
    await Store.addAudit(actor, 'settings.update', 'platform', JSON.stringify(patch));
    return { settings: effectiveSettings() };
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
    allowSignup: s.allowSignup ?? config.allowSignup,
    maxProjectsPerUser: s.maxProjectsPerUser ?? config.limits.maxProjectsPerUser,
  };
}
