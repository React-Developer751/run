import fs from 'node:fs/promises';
import { closeSync, openSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { config } from '../config/index.js';
import { killGroup, run } from '../utils/exec.js';
import { PortService } from './port.service.js';
import { runtimeLogPath, tailFile } from './log.service.js';
import { installCommand, type Detection } from './detect.service.js';
import type { AppHealth, DeployContext, Runner, RuntimePatch } from './runner.service.js';
import type { Project } from './store.service.js';
import { siteSlug } from './brand.js';

const staticPath = (p: Project) => path.join(config.staticDir, p.id);
const OUTPUT_CANDIDATES = ['dist', 'build', 'out', 'public'];

/** The engine's own environment minus its secrets (HOSTX_SECRET etc.): user code must never see them. */
function hostEnv(): NodeJS.ProcessEnv {
  const env: NodeJS.ProcessEnv = {};
  for (const [k, v] of Object.entries(process.env)) if (!k.startsWith('HOSTX_')) env[k] = v;
  return env;
}

const isPidAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

/**
 * Development fallback used when Docker is not installed.
 * Static sites are built and served straight from disk; Node apps run as detached local processes.
 * There is NO isolation here - never expose this mode to untrusted users.
 */
export class ProcessRunner implements Runner {
  readonly name = 'process' as const;

  private cleanEnv(extra: Record<string, string>): NodeJS.ProcessEnv {
    const env: NodeJS.ProcessEnv = { ...hostEnv(), ...extra, npm_config_update_notifier: 'false' };
    delete env.NODE_ENV; // devDependencies are needed for the build
    return env;
  }

  async deploy(ctx: DeployContext): Promise<RuntimePatch> {
    const { project, srcDir, detection, log, stage } = ctx;

    // The old process keeps serving during the build; it is only stopped right before the new one starts.
    await stage('building');
    const buildEnv = this.cleanEnv(project.env);
    const opts = { cwd: srcDir, env: buildEnv, onLine: log, timeoutMs: config.limits.buildTimeoutMs };

    if (detection.hasPackage) {
      const install = installCommand(detection.packageManager);
      log(`[${siteSlug()}] ${install}`);
      await run('sh', ['-c', install], opts);
    }
    if (detection.buildCommand) {
      log(`[${siteSlug()}] ${detection.buildCommand}`);
      await run('sh', ['-c', detection.buildCommand], opts);
    }

    await stage('starting');
    if (detection.kind === 'static') {
      const outDir = await this.findOutput(srcDir, detection);
      const target = staticPath(project);
      await fs.rm(target, { recursive: true, force: true });
      await fs.mkdir(path.dirname(target), { recursive: true });
      await fs.cp(outDir, target, { recursive: true });
      log(`[${siteSlug()}] Static files published from ${path.relative(srcDir, outDir) || '.'}`);
      return { runtime: 'static', pid: null, containerName: null };
    }

    log(`[${siteSlug()}] Starting app...`);
    await this.stop(project);
    return this.spawnApp(project, srcDir, detection);
  }

  private async findOutput(srcDir: string, detection: Detection): Promise<string> {
    for (const name of [detection.outputDir, ...OUTPUT_CANDIDATES]) {
      const dir = path.join(srcDir, name);
      if (await fs.access(path.join(dir, 'index.html')).then(() => true, () => false)) return dir;
    }
    throw new Error(`Build finished but no index.html was found in ${detection.outputDir}/. Check your build output folder.`);
  }

  private async spawnApp(project: Project, srcDir: string, detection: Detection): Promise<RuntimePatch> {
    const logFile = runtimeLogPath(project.id);
    await fs.mkdir(path.dirname(logFile), { recursive: true });
    const fd = openSync(logFile, 'a');

    const state: { exited: number | undefined } = { exited: undefined };
    const child = spawn('sh', ['-c', detection.startCommand], {
      cwd: srcDir,
      env: { ...hostEnv(), ...project.env, PORT: String(project.port), NODE_ENV: 'production' },
      detached: true,
      stdio: ['ignore', fd, fd],
    });
    closeSync(fd);
    child.on('exit', (code) => {
      state.exited = code ?? -1;
    });
    child.on('error', () => {
      state.exited = -1;
    });
    child.unref();

    let ready = await PortService.waitForPort(project.port, config.limits.startTimeoutMs, () => state.exited !== undefined);
    if (ready) {
      // Something answering on the port is only ours if our process is still alive a moment later.
      await new Promise((r) => setTimeout(r, 400));
      ready = state.exited === undefined;
    }
    if (!ready) {
      killGroup(child.pid);
      const tail = await tailFile(logFile, 15);
      const reason =
        state.exited !== undefined
          ? `App exited with code ${state.exited} before it opened port ${project.port}.`
          : `App did not start listening on port ${project.port} within ${config.limits.startTimeoutMs / 1000}s. Make sure it reads process.env.PORT.`;
      throw new Error(tail ? `${reason}\n${tail}` : reason);
    }
    return { runtime: 'process', pid: child.pid ?? null, containerName: null };
  }

  async start(project: Project, srcDir: string, detection: Detection): Promise<RuntimePatch> {
    if (project.runtime === 'static' || detection.kind === 'static') {
      await fs.access(staticPath(project));
      return { runtime: 'static', pid: null, containerName: null };
    }
    await this.stop(project);
    return this.spawnApp(project, srcDir, detection);
  }

  async stop(project: Project): Promise<void> {
    const pid = project.pid;
    if (!pid || !isPidAlive(pid)) return;
    killGroup(pid, 'SIGTERM');
    for (let i = 0; i < 20 && isPidAlive(pid); i++) await new Promise((r) => setTimeout(r, 250));
    if (isPidAlive(pid)) killGroup(pid, 'SIGKILL');
  }

  async remove(project: Project): Promise<void> {
    await this.stop(project);
    await fs.rm(staticPath(project), { recursive: true, force: true });
    await fs.rm(runtimeLogPath(project.id), { force: true });
  }

  async isAlive(project: Project): Promise<boolean> {
    if (project.runtime === 'static') return fs.access(staticPath(project)).then(() => true, () => false);
    return project.pid !== null && isPidAlive(project.pid);
  }

  async health(project: Project): Promise<AppHealth> {
    return { running: await this.isAlive(project), restartCount: 0, exitCode: null, oomKilled: false };
  }

  async runtimeLogs(project: Project, lines: number): Promise<string> {
    if (project.runtime === 'static') return 'Static sites have no runtime logs.';
    return tailFile(runtimeLogPath(project.id), lines);
  }
}
