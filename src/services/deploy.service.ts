import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { config, projectUrl } from '../config/index.js';
import { HttpError } from '../utils/http.js';
import { logger } from '../utils/logger.js';
import { isReservedSlug, slugify } from '../utils/validator.js';
import { ClonerService } from './cloner.service.js';
import { DetectService, type Detection } from './detect.service.js';
import { DeployLog, redactPaths } from './log.service.js';
import { PortService } from './port.service.js';
import { RunnerService } from './runner.service.js';
import { Store, type Deployment, type DeploymentStatus, type Project } from './store.service.js';

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
const PLACEHOLDER: Detection = { kind: 'node', framework: '', outputDir: '', buildCommand: '', startCommand: '', packageName: null, hasPackage: true };

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
    const limit = Store.getUserById(input.userId)?.maxProjects ?? Store.settings().maxProjectsPerUser ?? config.limits.maxProjectsPerUser;
    if (Store.projectsOf(input.userId).length >= limit) {
      throw new HttpError(403, `Project limit reached (${limit}). Delete a project to create a new one.`);
    }

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
      currentDeploymentId: null,
      commit: null,
      createdAt: now,
      updatedAt: now,
    });

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
      createdAt: new Date().toISOString(),
      finishedAt: null,
    });
    await Store.updateProject(project.id, { status: 'deploying', currentDeploymentId: deployment.id });

    void this.run(project.id, deployment.id);
    return deployment;
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
      const patch = await RunnerService.for(project).start(project, srcDir, detection);
      await Store.updateProject(project.id, { ...patch, status: 'live' });
    } catch (err) {
      throw new HttpError(500, `Could not start the app: ${(err as Error).message}`);
    }
  }

  static async remove(project: Project): Promise<void> {
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
      await ClonerService.clone(project.repoUrl, project.branch, sourceDir(project), log.write);

      const commit = await ClonerService.headCommit(sourceDir(project));
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
      log.system(`Build: ${detection.buildCommand || '(none)'} · ${detection.kind === 'static' ? `Output: ${detection.outputDir}` : `Start: ${detection.startCommand}`}`);
      await Store.updateDeployment(deploymentId, { commit });

      const patch = await runner.deploy({
        project: { ...project },
        srcDir,
        detection,
        log: log.write,
        stage: setStage,
      });

      await Store.updateProject(projectId, {
        ...patch,
        kind: detection.kind,
        framework: detection.framework,
        commit,
        status: 'live',
      });
      await Store.updateDeployment(deploymentId, { status: 'live', finishedAt: new Date().toISOString() });
      // The image already contains everything; keep disk usage flat.
      if (patch.runtime === 'docker') await fs.rm(sourceDir(project), { recursive: true, force: true });
      log.system(`Live at ${projectUrl(project.slug)}`);
    } catch (err) {
      const message = redactPaths((err as Error).message);
      logger.warn(`Deployment ${deploymentId} failed: ${message}`);
      log.system(`Deployment failed: ${message}`);
      await Store.updateDeployment(deploymentId, { status: 'failed', error: message, finishedAt: new Date().toISOString() }).catch(() => undefined);

      // A failed redeploy must not take down a version that is still serving traffic.
      const project = Store.getProject(projectId);
      if (project) {
        const stillServing = project.runtime !== null && (await RunnerService.for(project).isAlive(project).catch(() => false));
        await Store.updateProject(projectId, { status: stillServing ? 'live' : 'failed' }).catch(() => undefined);
      }
    } finally {
      if (slot) this.releaseSlot();
      await log.close();
    }
  }
}
