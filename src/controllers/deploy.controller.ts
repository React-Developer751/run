import { config, projectUrl } from '../config/index.js';
import type { Ctx } from '../utils/http.js';
import { HttpError } from '../utils/http.js';
import { RateLimiter } from '../utils/rateLimit.js';
import {
  validateBranch,
  validateCommand,
  validateKind,
  validateOutputDir,
  validateEnv,
  validateProjectName,
  validateRepoUrl,
  validateRootDir,
} from '../utils/validator.js';
import { AuthService } from '../services/auth.service.js';
import { ClonerService } from '../services/cloner.service.js';
import { DeployService } from '../services/deploy.service.js';
import { GitHubService } from '../services/github.service.js';
import { DeployLog } from '../services/log.service.js';
import { MongoService } from '../services/mongo.service.js';
import { DomainService } from '../services/domain.service.js';
import { billingEnabled } from '../config/plans.js';
import { RunnerService } from '../services/runner.service.js';
import { Store, type Deployment, type Project } from '../services/store.service.js';

export const toPublicProject = (p: Project) => ({
  id: p.id,
  name: p.name,
  slug: p.slug,
  url: projectUrl(p.slug),
  repoUrl: p.repoUrl,
  branch: p.branch,
  rootDir: p.rootDir,
  config: { kind: p.kindPref, buildCommand: p.buildCommand, startCommand: p.startCommand, outputDir: p.outputDir },
  kind: p.kind,
  framework: p.framework,
  env: p.env,
  autoDeploy: p.autoDeploy,
  viaGitHubApp: p.githubInstallationId !== null,
  domains: p.domains.map((d) => ({
    name: d.name,
    url: `https://${d.name}`,
    verified: d.verifiedAt !== null,
    verifiedAt: d.verifiedAt,
    dns: d.dns,
    lastCheckedAt: d.lastCheckedAt,
    lastError: d.lastError,
    // DNS records the owner has to create.
    records: [
      { type: 'TXT', name: DomainService.challengeName(d.name), value: d.token },
      d.name.split('.').length === 2 && config.publicIp
        ? { type: 'A', name: d.name, value: config.publicIp }
        : { type: 'CNAME', name: d.name, value: DomainService.target(p) },
    ],
  })),
  // Owner-only view (like env): the connection string includes the password.
  database: p.database ? { name: p.database.name, user: p.database.user, uri: MongoService.uri(p.database), createdAt: p.database.createdAt } : null,
  webhook: { url: `${config.apiPublicUrl}/api/webhooks/github/${p.id}`, secret: p.webhookSecret },
  status: p.status,
  commit: p.commit,
  currentDeploymentId: p.currentDeploymentId,
  liveDeploymentId: p.liveDeploymentId,
  createdAt: p.createdAt,
  updatedAt: p.updatedAt,
});

/** Successful deployments whose image is still kept on disk (see DockerRunner.retire). */
function rollbackTargets(p: Project): Set<string> {
  if (p.runtime !== 'docker') return new Set();
  const kept = Store.deploymentsOf(p.id)
    .filter((d) => d.status === 'live' && d.image)
    .slice(0, config.limits.rollbackImages);
  return new Set(kept.filter((d) => d.id !== p.liveDeploymentId).map((d) => d.id));
}

export const toPublicDeployment = (d: Deployment, targets?: Set<string>) => ({
  id: d.id,
  status: d.status,
  trigger: d.trigger,
  commit: d.commit,
  error: d.error,
  rollbackOf: d.rollbackOf,
  canRollback: targets?.has(d.id) ?? false,
  createdAt: d.createdAt,
  finishedAt: d.finishedAt,
});

function ownedProject(ctx: Ctx): Project {
  const user = AuthService.requireUser(ctx.user);
  const project = Store.getProject(ctx.params.id ?? '');
  // Same answer for "missing" and "someone else's" so ids cannot be probed.
  if (!project || project.userId !== user.id) throw new HttpError(404, 'Project not found');
  return project;
}

let activeScans = 0;
const domainLimiter = new RateLimiter(20, 60 * 1000, 'Too many checks. DNS changes take a few minutes anyway.');
// Builds burn CPU: cap how often one user can start them (auto-deploys on new commits are exempt).
const deployLimiter = new RateLimiter(30, 60 * 60 * 1000, 'You are deploying too often. Please wait a while before starting another build.');

export class DeployController {
  static health() {
    return {
      status: 'ok',
      runner: RunnerService.current().name,
      urlTemplate: projectUrl('{slug}'),
      databases: MongoService.available(),
      github: GitHubService.enabled(),
      billing: billingEnabled(),
      signupOpen: Store.allUsers().length === 0 || (Store.settings().allowSignup ?? config.allowSignup),
      time: new Date().toISOString(),
    };
  }

  /** Clones the repo to a temp folder and lists every sub-folder holding a package.json. */
  static async scan(ctx: Ctx) {
    const user = AuthService.requireVerified(ctx.user);
    const body = await ctx.json();
    const { url, repoName } = validateRepoUrl(body.repoUrl);
    const branch = validateBranch(body.branch);
    const installationId = await GitHubService.authorizeRepo(user, body.githubInstallationId, url);

    if (activeScans >= 3) throw new HttpError(429, 'Too many scans running, try again in a moment');
    activeScans++;
    try {
      const folders = await ClonerService.scan(url, branch, await GitHubService.gitEnv(installationId));
      return { repoName, folders };
    } catch (err) {
      throw new HttpError(422, `Could not read the repository. Is it public (or connected through GitHub), and does the branch exist? (${(err as Error).message})`);
    } finally {
      activeScans--;
    }
  }

  static list(ctx: Ctx) {
    const user = AuthService.requireUser(ctx.user);
    return { projects: Store.projectsOf(user.id).map(toPublicProject) };
  }

  static async create(ctx: Ctx) {
    const user = AuthService.requireVerified(ctx.user);
    const body = await ctx.json();
    const { url, repoName } = validateRepoUrl(body.repoUrl);
    deployLimiter.hit(user.id);
    const githubInstallationId = await GitHubService.authorizeRepo(user, body.githubInstallationId, url);

    const { project, deployment } = await DeployService.createProject({
      userId: user.id,
      name: validateProjectName(body.name, repoName),
      repoUrl: url,
      branch: validateBranch(body.branch),
      rootDir: validateRootDir(body.rootDir),
      env: validateEnv(body.env),
      kindPref: validateKind(body.kind),
      buildCommand: validateCommand(body.buildCommand, 'buildCommand'),
      startCommand: validateCommand(body.startCommand, 'startCommand'),
      outputDir: validateOutputDir(body.outputDir),
      autoDeploy: body.autoDeploy === undefined ? true : body.autoDeploy === true,
      database: body.database === true,
      githubInstallationId,
    });
    ctx.status = 201;
    return { project: toPublicProject(project), deployment: toPublicDeployment(deployment) };
  }

  static get(ctx: Ctx) {
    const project = ownedProject(ctx);
    const targets = rollbackTargets(project);
    return {
      project: toPublicProject(project),
      deployments: Store.deploymentsOf(project.id).map((d) => toPublicDeployment(d, targets)),
    };
  }

  static async update(ctx: Ctx) {
    const project = ownedProject(ctx);
    const body = await ctx.json();
    const patch: Partial<Project> = {};
    if (body.name !== undefined) patch.name = validateProjectName(body.name, project.name);
    if (body.env !== undefined) patch.env = validateEnv(body.env);
    if (body.autoDeploy !== undefined) patch.autoDeploy = body.autoDeploy === true;
    if (body.rootDir !== undefined) patch.rootDir = validateRootDir(body.rootDir);
    if (body.kind !== undefined) patch.kindPref = validateKind(body.kind);
    if (body.buildCommand !== undefined) patch.buildCommand = validateCommand(body.buildCommand, 'buildCommand');
    if (body.startCommand !== undefined) patch.startCommand = validateCommand(body.startCommand, 'startCommand');
    if (body.outputDir !== undefined) patch.outputDir = validateOutputDir(body.outputDir);
    if (project.status === 'deploying' && Object.keys(patch).some((k) => k !== 'name' && k !== 'env')) {
      throw new HttpError(409, 'Wait for the current deployment to finish before changing build settings');
    }
    const updated = await Store.updateProject(project.id, patch);
    return { project: toPublicProject(updated) };
  }

  static async redeploy(ctx: Ctx) {
    AuthService.requireVerified(ctx.user);
    const project = ownedProject(ctx);
    deployLimiter.hit(project.userId);
    const deployment = await DeployService.deploy(project, 'redeploy');
    ctx.status = 202;
    return { deployment: toPublicDeployment(deployment) };
  }

  /** Puts the image of an earlier successful deployment back live (no rebuild). */
  static async rollback(ctx: Ctx) {
    AuthService.requireVerified(ctx.user);
    const project = ownedProject(ctx);
    const deployment = await DeployService.rollback(project, ctx.params.did ?? '');
    ctx.status = 202;
    return { deployment: toPublicDeployment(deployment) };
  }

  /** Crashes, automatic restarts, recoveries and rollbacks (newest first). */
  static events(ctx: Ctx) {
    const project = ownedProject(ctx);
    return { events: Store.eventsOf(project.id).map((e) => ({ id: e.id, at: e.at, kind: e.kind, message: e.message })) };
  }

  static async stop(ctx: Ctx) {
    const project = ownedProject(ctx);
    if (project.status === 'deploying') throw new HttpError(409, 'Wait for the deployment to finish first');
    await DeployService.stop(project);
    return { project: toPublicProject(project) };
  }

  static async start(ctx: Ctx) {
    const project = ownedProject(ctx);
    if (project.status === 'deploying') throw new HttpError(409, 'A deployment is in progress');
    await DeployService.start(project);
    return { project: toPublicProject(project) };
  }

  static async remove(ctx: Ctx) {
    const project = ownedProject(ctx);
    if (project.status === 'deploying') throw new HttpError(409, 'Wait for the deployment to finish before deleting');
    await DeployService.remove(project);
    return { ok: true };
  }

  static async createDatabase(ctx: Ctx) {
    const project = ownedProject(ctx);
    if (project.status === 'deploying') throw new HttpError(409, 'Wait for the current deployment to finish first');
    const updated = await MongoService.create(project);
    ctx.status = 201;
    return { project: toPublicProject(updated) };
  }

  /** Permanently deletes the project's database and all of its data. */
  static async deleteDatabase(ctx: Ctx) {
    const project = ownedProject(ctx);
    if (!project.database) throw new HttpError(404, 'This project has no database');
    if (project.status === 'deploying') throw new HttpError(409, 'Wait for the current deployment to finish first');
    try {
      await MongoService.drop(project);
    } catch {
      throw new HttpError(502, 'Could not delete the database. Please try again.');
    }
    return { project: toPublicProject(Store.getProject(project.id) ?? project) };
  }

  static async addDomain(ctx: Ctx) {
    AuthService.requireVerified(ctx.user);
    const project = ownedProject(ctx);
    const body = await ctx.json();
    const updated = await DomainService.add(project, body.domain);
    ctx.status = 201;
    return { project: toPublicProject(updated) };
  }

  static async verifyDomain(ctx: Ctx) {
    const project = ownedProject(ctx);
    domainLimiter.hit(project.id);
    return { project: toPublicProject(await DomainService.verify(project, (ctx.params.name ?? '').toLowerCase())) };
  }

  static async removeDomain(ctx: Ctx) {
    const project = ownedProject(ctx);
    return { project: toPublicProject(await DomainService.remove(project, (ctx.params.name ?? '').toLowerCase())) };
  }

  /**
   * Caddy's on-demand TLS "ask" endpoint: 200 = issue a certificate for this host name, anything else = refuse.
   * Only verified custom domains (and the platform's own app hosts) qualify, so nobody can make us request
   * certificates for arbitrary names and burn the Let's Encrypt rate limits.
   */
  static checkDomain(ctx: Ctx) {
    const name = (ctx.query.get('domain') ?? '').toLowerCase().replace(/\.$/, '');
    const base = config.baseDomain;
    const slug = name.endsWith(`.${base}`) ? name.slice(0, -base.length - 1) : null;
    const ok = (slug !== null && !slug.includes('.') && Store.getProjectBySlug(slug) !== undefined) || Store.getProjectByDomain(name) !== undefined;
    if (!ok) throw new HttpError(404, 'Unknown domain');
    return { ok: true };
  }

  /** Build log of one deployment. Poll with ?after=<next> to receive only new lines. */
  static async deploymentLogs(ctx: Ctx) {
    const project = ownedProject(ctx);
    const deployment = Store.getDeployment(ctx.params.did ?? '');
    if (!deployment || deployment.projectId !== project.id) throw new HttpError(404, 'Deployment not found');

    const after = Math.max(0, Number.parseInt(ctx.query.get('after') ?? '0', 10) || 0);
    const { lines, next } = await DeployLog.read(deployment.id, after);
    return { lines, next, status: deployment.status, error: deployment.error };
  }

  static async runtimeLogs(ctx: Ctx) {
    const project = ownedProject(ctx);
    const lines = Math.min(500, Math.max(10, Number.parseInt(ctx.query.get('lines') ?? '200', 10) || 200));
    if (!project.runtime) return { logs: '' };
    return { logs: await RunnerService.for(project).runtimeLogs(project, lines) };
  }
}
