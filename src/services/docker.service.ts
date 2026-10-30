import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/index.js';
import { exec, run } from '../utils/exec.js';
import { logger } from '../utils/logger.js';
import { PortService } from './port.service.js';
import { installCommand, type Detection } from './detect.service.js';
import type { AppHealth, DeployContext, Runner, RuntimePatch } from './runner.service.js';
import { Store, limitsFor, type Project } from './store.service.js';

const DOCKERFILE = '.hostx.Dockerfile';
const NGINX_CONF = '.hostx.nginx.conf';

// Every deploy gets its own image tag and container, so the old version keeps serving until the new one is healthy.
const versionedName = (p: Project, version: string) => `hostx-${p.id}-${version}`;
/** Container currently serving the project (projects deployed before versioned names used `hostx-<id>`). */
const containerName = (p: Project) => p.containerName ?? `hostx-${p.id}`;
export const networkName = (p: Project) => `hostx-net-${p.id}`;
const imageName = (p: Project, version: string) => `hostx-${p.id}:${version}`;

// SPA-friendly static server: unknown paths fall back to index.html, hashed assets are cached.
const NGINX_CONFIG = `server {
  listen 80;
  root /usr/share/nginx/html;
  index index.html;
  gzip on;
  gzip_types text/css application/javascript application/json image/svg+xml;
  location / { try_files $uri $uri/ /index.html; }
  location /assets/ { expires 7d; add_header Cache-Control "public, immutable"; }
}
`;

const OUTPUT_CANDIDATES = ['dist', 'build', 'out', 'public'];
const nodeImage = (d: Detection) => `node:${/^\d+$/.test(d.nodeVersion) ? d.nodeVersion : '22'}-alpine`;

/**
 * Runtime image. It only COPIES the folder the sandbox already built: no user code runs during `docker build`,
 * which (with BuildKit) cannot be memory-limited. Env vars are not build args, so they never land in image history.
 */
function dockerfileFor(detection: Detection, outputDir: string): string {
  if (detection.kind === 'static') {
    return `FROM nginx:alpine
COPY ${NGINX_CONF} /etc/nginx/conf.d/default.conf
COPY ${JSON.stringify([outputDir === '.' ? './' : `${outputDir}/`, '/usr/share/nginx/html/'])}
EXPOSE 80
`;
  }
  return `FROM ${nodeImage(detection)}
WORKDIR /app
COPY --chown=node:node . .
USER node
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ${JSON.stringify(['sh', '-c', detection.startCommand])}
`;
}

/** Size of a folder in MB (du is fast and does not follow symlinks). */
async function folderMb(dir: string): Promise<number> {
  const { stdout } = await exec('du', ['-sk', dir]).catch(() => ({ stdout: '0' }));
  return Math.round(Number(stdout.split(/\s/)[0] || 0) / 1024);
}

/** Runs every app inside its own Docker container with hard memory / CPU / process limits. */
export class DockerRunner implements Runner {
  readonly name = 'docker' as const;

  async deploy(ctx: DeployContext): Promise<RuntimePatch> {
    const { project, srcDir, detection, log, stage } = ctx;
    const version = Date.now().toString(36);

    await stage('building');
    await this.buildInSandbox(project, srcDir, detection, ctx.buildEnv ?? project.env, version, log);

    const size = await folderMb(srcDir);
    if (size > config.limits.buildMaxDiskMb) {
      throw new Error(`The build folder is ${size} MB, above the ${config.limits.buildMaxDiskMb} MB limit. Remove unneeded dependencies or files.`);
    }
    const outputDir = detection.kind === 'static' ? await this.findOutput(srcDir, detection) : '.';

    // Remove first so a file (or symlink) shipped in the repo can never redirect these writes.
    const files: Array<[string, string]> = [
      [DOCKERFILE, dockerfileFor(detection, outputDir)],
      [NGINX_CONF, NGINX_CONFIG],
      // A static image needs only the output folder: keep node_modules out of the build context.
      ['.dockerignore', `.git\n${detection.kind === 'static' ? 'node_modules\n' : ''}.hostx.*\n!.hostx.Dockerfile\n!.hostx.nginx.conf\n`],
    ];
    for (const [name, content] of files) {
      await fs.rm(path.join(srcDir, name), { force: true });
      await fs.writeFile(path.join(srcDir, name), content);
    }

    log(`[hostx] Packaging the image (${size} MB)...`);
    const image = imageName(project, version);
    try {
      await run('docker', ['build', '-t', image, '-f', DOCKERFILE, '.'], {
        cwd: srcDir,
        onLine: log,
        timeoutMs: config.limits.buildTimeoutMs,
        label: 'docker build',
      });
    } catch (err) {
      await exec('docker', ['rmi', '-f', image]);
      throw err;
    }

    await stage('starting');
    log('[hostx] Starting new version (the current one keeps serving until it is healthy)...');
    try {
      return await this.startVersion(project, detection.kind, image, version, log);
    } catch (err) {
      await exec('docker', ['rmi', '-f', image]);
      throw err;
    }
  }

  /**
   * Runs install + build of the user's code in a throwaway container with hard limits (memory without swap, CPU,
   * process count), no Linux capabilities and as an unprivileged user, writing into the mounted source folder.
   */
  private async buildInSandbox(
    project: Project,
    srcDir: string,
    detection: Detection,
    buildEnv: Record<string, string>,
    version: string,
    log: (l: string) => void,
  ): Promise<void> {
    const steps = [detection.hasPackage ? installCommand(detection.packageManager) : '', detection.buildCommand].filter(Boolean);
    if (steps.length === 0) return;
    const { buildMemory, buildCpus, buildPids, buildTimeoutMs } = config.limits;
    log(`[hostx] Building in a sandbox (${buildMemory} RAM, ${buildCpus} CPU, ${buildTimeoutMs / 60_000} min max)`);
    for (const step of steps) log(`[hostx] $ ${step}`);

    const name = `hostx-build-${project.id}-${version}`;
    const envFile = path.join(config.envDir, `${name}.env`);
    await fs.mkdir(config.envDir, { recursive: true });
    await fs.writeFile(envFile, Object.entries(buildEnv).map(([k, v]) => `${k}=${v}`).join('\n'), { mode: 0o600 });
    // The engine's own user, so files written in the mounted folder stay ours (root has no extra rights here anyway).
    const user = process.getuid && process.getgid ? `${process.getuid()}:${process.getgid()}` : '1000:1000';
    try {
      const { code } = await exec(
        'docker',
        [
          'run', '--rm',
          '--name', name,
          '--label', `hostx.build=${project.id}`,
          `--memory=${buildMemory}`,
          `--memory-swap=${buildMemory}`,
          `--cpus=${buildCpus}`,
          `--pids-limit=${buildPids}`,
          '--ulimit', 'nofile=8192:8192',
          '--cap-drop=ALL',
          '--security-opt', 'no-new-privileges',
          '--user', user,
          '--env-file', envFile,
          // Writable home for npm/yarn/pnpm caches; devDependencies are needed, so NODE_ENV stays unset.
          '-e', 'HOME=/tmp',
          '-e', 'COREPACK_HOME=/tmp/corepack',
          '-e', 'COREPACK_ENABLE_DOWNLOAD_PROMPT=0',
          '-e', 'npm_config_update_notifier=false',
          '-v', `${srcDir}:/app`,
          '-w', '/app',
          nodeImage(detection),
          'sh', '-c', steps.join(' && '),
        ],
        { onLine: log, timeoutMs: buildTimeoutMs, label: 'build' },
      );
      if (code === 137) {
        throw new Error(`The build ran out of memory (limit ${buildMemory}). Reduce what the build loads at once (fewer parallel jobs, smaller bundles), or ask the administrator to raise HOSTX_BUILD_MEMORY.`);
      }
      if (code !== 0) throw new Error(`The build failed with exit code ${code}. See the log above.`);
    } finally {
      // On timeout only the docker CLI is killed: make sure the container goes too.
      await exec('docker', ['rm', '-f', name]);
      await fs.rm(envFile, { force: true });
    }
  }

  private async findOutput(srcDir: string, detection: Detection): Promise<string> {
    for (const dir of [detection.outputDir, ...OUTPUT_CANDIDATES]) {
      if (await fs.access(path.join(srcDir, dir, 'index.html')).then(() => true, () => false)) return dir;
    }
    throw new Error(`Build finished but no index.html was found in ${detection.outputDir}/. Check your build output folder.`);
  }

  /** Starts `image` next to the running version on a fresh port; the caller switches traffic once it resolves. */
  private async startVersion(project: Project, kind: Detection['kind'], image: string, version: string, log: (l: string) => void): Promise<RuntimePatch> {
    // One private network per project: containers of different users cannot reach each other.
    await exec('docker', ['network', 'create', '--driver', 'bridge', networkName(project)]);
    const port = await PortService.reserve(Store.usedPorts());
    try {
      const patch = await this.startContainer(project, kind, versionedName(project, version), image, port, log);
      return { ...patch, image };
    } finally {
      PortService.release(port);
    }
  }

  /** Rollback: runs the image of an earlier deployment again (no rebuild), with the project's current env. */
  async startImage(project: Project, kind: Detection['kind'], image: string, log: (l: string) => void): Promise<RuntimePatch> {
    const { code } = await exec('docker', ['image', 'inspect', image]);
    if (code !== 0) throw new Error('The image of that deployment no longer exists. Redeploy instead.');
    return this.startVersion(project, kind, image, Date.now().toString(36), log);
  }

  private async startContainer(
    project: Project,
    kind: Detection['kind'],
    name: string,
    image: string,
    port: number,
    log: (l: string) => void,
  ): Promise<RuntimePatch> {
    const innerPort = kind === 'static' ? 80 : 3000;
    const envFile = path.join(config.envDir, `${name}.env`);
    await fs.mkdir(config.envDir, { recursive: true });
    const lines = Object.entries(project.env).map(([k, v]) => `${k}=${v}`);
    if (kind === 'node') lines.push('NODE_ENV=production', 'PORT=3000');
    await fs.writeFile(envFile, lines.join('\n'), { mode: 0o600 });

    await exec('docker', ['rm', '-f', name]);
    // Memory and CPU come from the owner's plan (or the global HOSTX_APP_* limits when billing is off).
    const limits = limitsFor(Store.getUserById(project.userId));
    try {
      await run(
        'docker',
        [
          'run', '-d',
          '--name', name,
          '--label', `hostx.project=${project.id}`,
          `--memory=${limits.memory}`,
          `--memory-swap=${limits.memory}`,
          `--cpus=${limits.cpus}`,
          `--pids-limit=${config.limits.pids}`,
          '--restart', 'unless-stopped',
          '--network', networkName(project),
          '--ulimit', 'nofile=4096:4096',
          '--cap-drop=ALL',
          '--security-opt', 'no-new-privileges',
          '--log-opt', 'max-size=10m',
          '--log-opt', 'max-file=3',
          '--env-file', envFile,
          '-p', `127.0.0.1:${port}:${innerPort}`,
          image,
        ],
        { onLine: log },
      );
    } finally {
      await fs.rm(envFile, { force: true });
    }

    const isRunning = () => this.containerRunning(name);
    const ready = await PortService.waitForPort(port, config.limits.startTimeoutMs, async () => !(await isRunning()));
    if (!ready) {
      const logs = await this.containerLogs(name, 20);
      if (logs) log(logs);
      await exec('docker', ['rm', '-f', name]);
      throw new Error(`App did not respond within ${config.limits.startTimeoutMs / 1000}s (or the container exited). Make sure it listens on process.env.PORT (3000).`);
    }
    return { runtime: 'docker', pid: null, containerName: name, port };
  }

  async retire(previous: Project, current: RuntimePatch): Promise<void> {
    if (previous.runtime !== 'docker') return;
    const old = containerName(previous);
    if (old === current.containerName) return;
    // Give requests that were already in flight on the old version a moment to finish.
    await new Promise((r) => setTimeout(r, 2000));
    await exec('docker', ['rm', '-f', old]);
    // Keep the images of the last few successful deployments (rollback targets) and the one now serving.
    const keep = new Set(
      Store.deploymentsOf(previous.id)
        .filter((d) => d.status === 'live' && d.image)
        .slice(0, config.limits.rollbackImages)
        .map((d) => d.image as string),
    );
    if (current.image) keep.add(current.image);
    const { stdout } = await exec('docker', ['images', '--format', '{{.Repository}}:{{.Tag}}', `hostx-${previous.id}`]);
    for (const image of stdout.split('\n').map((s) => s.trim()).filter(Boolean)) {
      if (!keep.has(image)) await exec('docker', ['rmi', image]);
    }
    // Intermediate build stages and replaced layers would otherwise fill the disk over time.
    void exec('docker', ['image', 'prune', '-f', '--filter', 'dangling=true']).catch(() => undefined);
    void exec('docker', ['builder', 'prune', '-f', '--filter', 'until=168h']).catch(() => undefined);
  }

  async start(project: Project): Promise<RuntimePatch> {
    await run('docker', ['start', containerName(project)]);
    if (!(await PortService.waitForPort(project.port, config.limits.startTimeoutMs, async () => !(await this.isAlive(project))))) {
      throw new Error('Container started but the app is not responding');
    }
    return { runtime: 'docker', pid: null, containerName: containerName(project) };
  }

  async stop(project: Project): Promise<void> {
    await exec('docker', ['stop', '-t', '10', containerName(project)]);
  }

  async remove(project: Project): Promise<void> {
    // Every container and image this project ever had (old versions included).
    const { stdout: ids } = await exec('docker', ['ps', '-aq', '--filter', `label=hostx.project=${project.id}`]);
    const containers = [containerName(project), ...ids.split('\n').map((s) => s.trim()).filter(Boolean)];
    await exec('docker', ['rm', '-f', ...new Set(containers)]);
    const { stdout: images } = await exec('docker', ['images', '-q', `hostx-${project.id}`]);
    const imageIds = [...new Set(images.split('\n').map((s) => s.trim()).filter(Boolean))];
    if (imageIds.length > 0) await exec('docker', ['rmi', '-f', ...imageIds]);
    await exec('docker', ['network', 'rm', networkName(project)]);
  }

  async isAlive(project: Project): Promise<boolean> {
    return this.containerRunning(containerName(project));
  }

  /** Applies new memory/CPU limits to the running container without a restart (plan change). */
  async updateLimits(project: Project, memory: string, cpus: string): Promise<void> {
    await exec('docker', ['update', `--memory=${memory}`, `--memory-swap=${memory}`, `--cpus=${cpus}`, containerName(project)]);
  }

  async health(project: Project): Promise<AppHealth> {
    const { code, stdout } = await exec('docker', [
      'inspect', '-f', '{{.State.Running}}|{{.RestartCount}}|{{.State.ExitCode}}|{{.State.OOMKilled}}', containerName(project),
    ]).catch(() => ({ code: 1, stdout: '' }));
    if (code !== 0) return { running: false, restartCount: 0, exitCode: null, oomKilled: false };
    const [running, restarts, exit, oom] = stdout.trim().split('|');
    return { running: running === 'true', restartCount: Number(restarts) || 0, exitCode: Number.isFinite(Number(exit)) ? Number(exit) : null, oomKilled: oom === 'true' };
  }

  private async containerRunning(name: string): Promise<boolean> {
    const { code, stdout } = await exec('docker', ['inspect', '-f', '{{.State.Running}}', name]).catch(() => ({ code: 1, stdout: '' }));
    return code === 0 && stdout.trim() === 'true';
  }

  async runtimeLogs(project: Project, lines: number): Promise<string> {
    return this.containerLogs(containerName(project), lines);
  }

  private async containerLogs(name: string, lines: number): Promise<string> {
    let out = '';
    await exec('docker', ['logs', '--tail', String(lines), name], {
      onLine: (l) => {
        out += `${l}\n`;
      },
    }).catch(() => undefined);
    return out.trimEnd();
  }
}
