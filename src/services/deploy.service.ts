import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config, projectUrl } from '../config/index.js';
import { HttpError } from '../utils/http.js';
import { logger } from '../utils/logger.js';
import { isReservedSlug, slugify } from '../utils/validator.js';
import { ClonerService } from './cloner.service.js';
import { DetectService, type Detection } from './detect.service.js';
import { AlertService } from './alert.service.js';
import { GitHubService } from './github.service.js';
import { DeployLog, redactPaths } from './log.service.js';
import { MongoService } from './mongo.service.js';
import { PortService } from './port.service.js';
import { RunnerService } from './runner.service.js';
import { billingEnabled } from '../config/plans.js';
import { Store, limitsFor, type Deployment, type DeploymentStatus, type Project } from './store.service.js';

export interface CreateProjectInput {
  userId: string;
  name: string;
  repoUrl: string;
  branch: string | null;
  rootDir: string;
  env: Record<string, string>;
  kindPref: Project['kindPref'];
  buildCommand: string | null;
  startCommand: string | null;
  outputDir: string | null;
  autoDeploy: boolean;
  githubInstallationId: number | null;
  /** Create a managed MongoDB database for the project before the first deploy. */
  database: boolean;
}

const projectDir = (p: Project) => path.join(config.appsDir, p.id);
const sourceDir = (p: Project) => path.join(projectDir(p), 'src');

/** Resolves the chosen sub-folder and makes sure it cannot escape the cloned repository. */
function workDirOf(p: Project): string {
  const root = sourceDir(p);
  const dir = path.resolve(root, p.rootDir);
  if (dir !== root && !dir.startsWith(root + path.sep)) throw new Error('Invalid root directory');
  return dir;
}

/** Same as workDirOf, but also follows symlinks so a repo cannot point the build outside its own folder. */
async function safeWorkDir(p: Project): Promise<string> {
  const dir = workDirOf(p);
  const [realRoot, realDir] = await Promise.all([fs.realpath(sourceDir(p)), fs.realpath(dir).catch(() => null)]);
  if (!realDir) throw new Error(`Folder "${p.rootDir}" does not exist in this repository.`);
  if (realDir !== realRoot && !realDir.startsWith(realRoot + path.sep)) throw new Error('Invalid root directory');
  return realDir;
}

/**
 * Env the app actually runs with: the project's own vars plus MONGODB_URI/MONGO_URI from the database add-on.
 * Web services only: a static site's env is baked into public JavaScript, where a database password must never end up.
 */
function runtimeEnv(project: Project, kind: Detection['kind']): Record<string, string> {
  return kind === 'node' ? { ...MongoService.envFor(project), ...project.env } : project.env;
}

/** Detected defaults for the folder, overridden by whatever the user set on the project. */
async function resolveConfig(project: Project, dir: string): Promise<Detection | null> {
  const detected = (await DetectService.fromDir(dir)) ?? (await DetectService.plainStatic(dir));
  if (!detected) return null;
  const kind = project.kindPref ?? detected.kind;
  return {
    ...detected,
    kind,
    buildCommand: project.buildCommand ?? detected.buildCommand,
    startCommand: project.startCommand ?? detected.startCommand,
    outputDir: project.outputDir ?? detected.outputDir,
  };
}

// Docker restarts an existing image, so it needs no source-based detection.
const PLACEHOLDER: Detection = {
  kind: 'node',
  framework: '',
  outputDir: '',
  buildCommand: '',
  startCommand: '',
  packageName: null,
  hasPackage: true,
  nodeVersion: '22',
  packageManager: 'npm',
};

export class DeployService {
  private static activeBuilds = 0;
  private static waiting: Array<() => void> = [];

  private static async acquireSlot(): Promise<void> {
    if (this.activeBuilds < config.limits.maxConcurrentBuilds) {
      this.activeBuilds++;
      return;
    }
    await new Promise<void>((resolve) => this.waiting.push(resolve)); // slot is handed over, count unchanged
  }

  private static releaseSlot(): void {
    const next = this.waiting.shift();
    if (next) next();
    else this.activeBuilds--;
  }

  // ── public API ─────────────────────────────────────────
  static async createProject(input: CreateProjectInput): Promise<{ project: Project; deployment: Deployment }> {
    const port = await PortService.allocate(Store.usedPorts());

    // Everything from here to addProject() is synchronous, so concurrent requests cannot race on limit/slug.
    const limit = limitsFor(Store.getUserById(input.userId)).projects;
    if (Store.projectsOf(input.userId).length >= limit) {
      const upgrade = billingEnabled() ? ' or upgrade your plan on the Billing page' : '';
      throw new HttpError(403, `Project limit reached (${limit}). Delete a project${upgrade} to create a new one.`);
    }

    if (input.database && !MongoService.available()) throw new HttpError(503, 'Databases are not available on this server');

    let slug = slugify(input.name);
    if (isReservedSlug(slug) || Store.getProjectBySlug(slug)) {
      slug = `${slug.slice(0, 24)}-${Math.random().toString(36).slice(2, 6)}`;
    }

    const now = new Date().toISOString();
    const project = await Store.addProject({
      id: Store.newId('p'),
      userId: input.userId,
      name: input.name,
      slug,
      repoUrl: input.repoUrl,
      branch: input.branch,
      rootDir: input.rootDir,
      kind: null,
      framework: null,
      env: input.env,
      kindPref: input.kindPref,
      buildCommand: input.buildCommand,
      startCommand: input.startCommand,
      outputDir: input.outputDir,
      autoDeploy: input.autoDeploy,
      webhookSecret: crypto.randomBytes(24).toString('hex'),
      status: 'deploying',
      runtime: null,
      port,
      pid: null,
      containerName: null,
      database: null,
      githubInstallationId: input.githubInstallationId,
      liveDeploymentId: null,
      lastRemoteCommit: null,
      currentDeploymentId: null,
      commit: null,
      createdAt: now,
      updatedAt: now,
    });

    if (input.database) {
      try {
        await MongoService.create(project);
      } catch (err) {
        await Store.deleteProject(project.id);
        throw err;
      }
    }
    const deployment = await this.deploy(project, 'create');
    return { project, deployment };
  }

  static async deploy(project: Project, trigger: Deployment['trigger']): Promise<Deployment> {
    const busy = Store.deploymentsOf(project.id).some((d) => ['queued', 'cloning', 'building', 'starting'].includes(d.status));
    if (busy) throw new HttpError(409, 'A deployment is already in progress for this project');

    const deployment = await Store.addDeployment({
      id: Store.newId('d'),
      projectId: project.id,
      status: 'queued',
      trigger,
      commit: null,
      error: null,
      image: null,
      kind: null,
      rollbackOf: null,
      createdAt: new Date().toISOString(),
      finishedAt: null,
    });
    await Store.updateProject(project.id, { status: 'deploying', currentDeploymentId: deployment.id });

    void this.run(project.id, deployment.id);
    return deployment;
  }

  /**
   * One-click rollback: starts the image an earlier successful deployment built (no clone, no build, seconds instead
   * of minutes) next to the current version and switches traffic when it is healthy. Uses the current env vars.
   */
  static async rollback(project: Project, targetId: string): Promise<Deployment> {
    const runner = RunnerService.for(project);
    if (project.runtime !== 'docker' || !runner.startImage) throw new HttpError(409, 'Rollback is available for apps running in Docker');
    const target = Store.getDeployment(targetId);
    if (!target || target.projectId !== project.id || target.status !== 'live' || !target.image || !target.kind) {
      throw new HttpError(404, 'That deployment cannot be rolled back to. Only recent successful deployments can.');
    }
    if (target.id === project.liveDeploymentId) throw new HttpError(409, 'That version is already live');
    const busy = Store.deploymentsOf(project.id).some((d) => ['queued', 'cloning', 'building', 'starting'].includes(d.status));
    if (busy) throw new HttpError(409, 'A deployment is already in progress for this project');

    const deployment = await Store.addDeployment({
      id: Store.newId('d'),
      projectId: project.id,
      status: 'starting',
      trigger: 'rollback',
      commit: target.commit,
      error: null,
      image: target.image,
      kind: target.kind,
      rollbackOf: target.id,
      createdAt: new Date().toISOString(),
      finishedAt: null,
    });
    await Store.updateProject(project.id, { status: 'deploying', currentDeploymentId: deployment.id });
    void this.runRollback(project.id, deployment.id, target);
    return deployment;
  }

  private static async runRollback(projectId: string, deploymentId: string, target: Deployment): Promise<void> {
    const log = new DeployLog(deploymentId);
    try {
      const project = Store.getProject(projectId);
      if (!project) return;
      const kind = target.kind as Detection['kind'];
      const runner = RunnerService.for(project);
      log.system(`Rolling back to deployment ${target.id}${target.commit ? ` (commit ${target.commit})` : ''}: reusing its image, nothing is rebuilt.`);
      log.system('The current environment variables are used.');
      if (project.database && kind === 'node') await MongoService.attach(project);

      const previous = { ...project };
      const patch = await (runner.startImage as NonNullable<typeof runner.startImage>)(
        { ...project, env: runtimeEnv(project, kind) },
        kind,
        target.image as string,
        log.write,
      );
      const { image: _image, ...runtime } = patch;
      await Store.updateProject(projectId, { ...runtime, kind, commit: target.commit, status: 'live', liveDeploymentId: deploymentId });
      await Store.updateDeployment(deploymentId, { status: 'live', finishedAt: new Date().toISOString() });
      await Store.addEvent(projectId, 'rollback', `Rolled back to ${target.commit ? `commit ${target.commit}` : `deployment ${target.id}`}.`);
      await runner.retire?.(previous, patch).catch((err) => logger.warn(`Cleanup after rollback of ${project.slug} failed`, err));
      log.system(`Live at ${projectUrl(project.slug)}`);
    } catch (err) {
      await this.fail(projectId, deploymentId, log, err as Error);
    } finally {
      await log.close();
    }
  }

  /** Marks a deployment failed without taking down a version that is still serving traffic. */
  private static async fail(projectId: string, deploymentId: string, log: DeployLog, err: Error): Promise<void> {
    const message = redactPaths(err.message);
    logger.warn(`Deployment ${deploymentId} failed: ${message}`);
    log.system(`Deployment failed: ${message}`);
    const deployment = await Store.updateDeployment(deploymentId, { status: 'failed', error: message, finishedAt: new Date().toISOString() }).catch(() => null);
    const project = Store.getProject(projectId);
    if (!project) return;
    const stillServing = project.runtime !== null && (await RunnerService.for(project).isAlive(project).catch(() => false));
    await Store.updateProject(projectId, { status: stillServing ? 'live' : 'failed' }).catch(() => undefined);
    // Nobody is watching an automatic deploy: tell the owner.
    if (deployment?.trigger === 'auto') {
      AlertService.notify(
        project,
        'deploy-failed',
        `Auto-deploy of ${project.name} failed`,
        `the automatic deployment of "${project.name}" after a new commit failed: ${message.split('\n')[0]?.slice(0, 300)}. ${stillServing ? 'The previous version is still live.' : 'The app is offline.'}`,
      );
    }
  }

  static async stop(project: Project): Promise<void> {
    await RunnerService.for(project).stop(project);
    await Store.updateProject(project.id, { status: 'stopped', pid: null });
  }

  static async start(project: Project): Promise<void> {
    if (project.runtime === null) throw new HttpError(409, 'Nothing to start yet. Deploy this project first.');
    try {
      const srcDir = project.runtime === 'docker' ? sourceDir(project) : await safeWorkDir(project);
      const detection = (project.runtime === 'docker' ? null : await resolveConfig(project, srcDir)) ?? PLACEHOLDER;
      const runnable = { ...project, env: runtimeEnv(project, detection.kind) };
      const patch = await RunnerService.for(project).start(runnable, srcDir, detection);
      await Store.updateProject(project.id, { ...patch, status: 'live' });
    } catch (err) {
      throw new HttpError(500, `Could not start the app: ${(err as Error).message}`);
    }
  }

  static async remove(project: Project): Promise<void> {
    // Before the runner: the project network can only be removed once Mongo has left it.
    await MongoService.drop(project).catch((err) => logger.warn(`Database of ${project.id} was not dropped`, err));
    await RunnerService.for(project).remove(project).catch((err) => logger.warn(`Cleanup of ${project.id} was incomplete`, err));
    await fs.rm(projectDir(project), { recursive: true, force: true });
    await Store.deleteProject(project.id);
  }

  /** On boot: close dangling deployments and bring back apps that were live before the restart. */
  static async recover(): Promise<void> {
    for (const d of Store.allDeployments()) {
      if (['queued', 'cloning', 'building', 'starting'].includes(d.status)) {
        await Store.updateDeployment(d.id, {
          status: 'failed',
          error: 'Interrupted by a HostX restart',
          finishedAt: new Date().toISOString(),
        });
      }
    }
    for (const project of Store.allProjects()) {
      try {
        if (project.status === 'deploying') {
          await Store.updateProject(project.id, { status: 'failed' });
        } else if (project.status === 'live' && !(await RunnerService.for(project).isAlive(project))) {
          logger.info(`Restoring ${project.slug}...`);
          await this.start(project);
        }
      } catch (err) {
        logger.warn(`Could not restore ${project.slug}`, err);
        await Store.updateProject(project.id, { status: 'failed', pid: null });
      }
    }
  }

  // ── pipeline ───────────────────────────────────────────
  private static async run(projectId: string, deploymentId: string): Promise<void> {
    const log = new DeployLog(deploymentId);
    const setStage = async (status: DeploymentStatus) => {
      await Store.updateDeployment(deploymentId, { status });
    };

    let slot = false;
    try {
      const project = Store.getProject(projectId);
      if (!project) return;

      log.system('Deployment queued...');
      await this.acquireSlot();
      slot = true;

      const runner = RunnerService.current();
      log.system(`Runner: ${runner.name === 'docker' ? 'Docker (isolated container)' : 'local process (dev mode, no isolation)'}`);

      await setStage('cloning');
      await fs.rm(sourceDir(project), { recursive: true, force: true });
      await fs.mkdir(projectDir(project), { recursive: true });
      log.system(`Cloning ${project.repoUrl}${project.branch ? ` (${project.branch})` : ''}`);
      await ClonerService.clone(project.repoUrl, project.branch, sourceDir(project), log.write, await GitHubService.gitEnv(project.githubInstallationId));

      const commit = await ClonerService.headCommit(sourceDir(project));
      if (commit) await Store.updateProject(projectId, { lastRemoteCommit: commit });
      const srcDir = await safeWorkDir(project);
      const detection = await resolveConfig(project, srcDir);
      if (!detection) {
        throw new Error(
          `No package.json (or index.html) found in "${project.rootDir === '.' ? 'the repository root' : project.rootDir}". Set "Source directory" to the folder that contains your app.`,
        );
      }
      if (detection.kind === 'node' && !detection.startCommand.trim()) {
        throw new Error('A web service needs a start command (for example: npm start).');
      }
      log.system(`Detected ${detection.framework} (${detection.kind === 'static' ? 'static site' : 'web service'}), commit ${commit ?? 'unknown'}`);
      if (detection.hasPackage) log.system(`Node.js ${detection.nodeVersion} · install: ${detection.packageManager}`);
      log.system(`Build: ${detection.buildCommand || '(none)'} · ${detection.kind === 'static' ? `Output: ${detection.outputDir}` : `Start: ${detection.startCommand}`}`);
      await Store.updateDeployment(deploymentId, { commit });

      if (project.database) {
        if (!MongoService.available()) log.system('Warning: the database add-on is unavailable right now; MONGODB_URI is not set.');
        else if (detection.kind === 'static') log.system('Note: static sites do not receive MONGODB_URI (it would be visible in the browser). Use it from your backend service.');
        else {
          if (runner.name === 'docker') await MongoService.attach(project);
          log.system('Database attached: MONGODB_URI is set for this app.');
        }
      }

      const previous = { ...project };
      const patch = await runner.deploy({
        project: { ...project, env: MongoService.available() ? runtimeEnv(project, detection.kind) : project.env },
        srcDir,
        detection,
        buildEnv: project.env,
        log: log.write,
        stage: setStage,
      });

      const { image, ...runtime } = patch;
      await Store.updateProject(projectId, {
        ...runtime,
        kind: detection.kind,
        framework: detection.framework,
        commit,
        status: 'live',
        liveDeploymentId: deploymentId,
      });
      await Store.updateDeployment(deploymentId, { status: 'live', image: image ?? null, kind: detection.kind, finishedAt: new Date().toISOString() });
      // Traffic now goes to the new version: tear down the old one.
      await runner.retire?.(previous, patch).catch((err) => logger.warn(`Cleanup of the previous version of ${project.slug} failed`, err));
      // The image already contains everything; keep disk usage flat.
      if (patch.runtime === 'docker') await fs.rm(sourceDir(project), { recursive: true, force: true });
      log.system(`Live at ${projectUrl(project.slug)}`);
    } catch (err) {
      await this.fail(projectId, deploymentId, log, err as Error);
    } finally {
      if (slot) this.releaseSlot();
      await log.close();
    }
  }
}
