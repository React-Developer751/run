import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/index.js';
import { exec, run } from '../utils/exec.js';
import { logger } from '../utils/logger.js';
import { PortService } from './port.service.js';
import { installCommand, type Detection } from './detect.service.js';
import type { AppHealth, DeployContext, Runner, RuntimePatch } from './runner.service.js';
import { Store, type Project } from './store.service.js';

const DOCKERFILE = '.hostx.Dockerfile';
const NGINX_CONF = '.hostx.nginx.conf';

// Every deploy gets its own image tag and container, so the old version keeps serving until the new one is healthy.
const versionedName = (p: Project, version: string) => `hostx-${p.id}-${version}`;
/** Container currently serving the project (projects deployed before versioned names used `hostx-<id>`). */
const containerName = (p: Project) => p.containerName ?? `hostx-${p.id}`;
export const networkName = (p: Project) => `hostx-net-${p.id}`;
const imageName = (p: Project, version: string) => `hostx-${p.id}:${version}`;

const LOCKFILES = { npm: 'package*.json', yarn: 'package.json yarn.lock*', pnpm: 'package.json pnpm-lock.yaml*' } as const;

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

function dockerfileFor(detection: Detection, envKeys: string[]): string {
  const args = envKeys.map((k) => `ARG ${k}`).join('\n');
  const install = detection.hasPackage
    ? `COPY ${LOCKFILES[detection.packageManager]} ./\nRUN ${JSON.stringify(['sh', '-c', installCommand(detection.packageManager)])}`
    : '';
  const node = `node:${/^\d+$/.test(detection.nodeVersion) ? detection.nodeVersion : '22'}-alpine`;
  // Exec-form JSON keeps the user's command on one Dockerfile line, whatever characters it contains.
  const build = detection.buildCommand ? `RUN ${JSON.stringify(['sh', '-c', detection.buildCommand])}` : '';

  if (detection.kind === 'static') {
    return `FROM ${node} AS build
WORKDIR /app
${install}
COPY . .
${args}
${build}

FROM nginx:alpine
COPY ${NGINX_CONF} /etc/nginx/conf.d/default.conf
COPY --from=build /app/${detection.outputDir} /usr/share/nginx/html
EXPOSE 80
`;
  }

  const cmd = JSON.stringify(['sh', '-c', detection.startCommand]);
  return `FROM ${node}
WORKDIR /app
${install}
COPY . .
${args}
${build}
RUN chown -R node:node /app
USER node
ENV NODE_ENV=production PORT=3000
EXPOSE 3000
CMD ${cmd}
`;
}

/** Runs every app inside its own Docker container with hard memory / CPU / process limits. */
export class DockerRunner implements Runner {
  readonly name = 'docker' as const;

  async deploy(ctx: DeployContext): Promise<RuntimePatch> {
    const { project, srcDir, detection, log, stage } = ctx;
    const buildEnv = ctx.buildEnv ?? project.env;
    const envKeys = Object.keys(buildEnv);

    // Remove first so a file (or symlink) shipped in the repo can never redirect these writes.
    const files: Array<[string, string]> = [
      [DOCKERFILE, dockerfileFor(detection, envKeys)],
      [NGINX_CONF, NGINX_CONFIG],
      ['.dockerignore', 'node_modules\n.git\n.hostx.*\n!.hostx.Dockerfile\n!.hostx.nginx.conf\n'],
    ];
    for (const [name, content] of files) {
      await fs.rm(path.join(srcDir, name), { force: true });
      await fs.writeFile(path.join(srcDir, name), content);
    }

    await stage('building');
    log('[hostx] Building Docker image...');
    const version = Date.now().toString(36);
    const image = imageName(project, version);
    const buildArgs = envKeys.flatMap((k) => ['--build-arg', `${k}=${buildEnv[k]}`]);
    try {
      await run('docker', ['build', '-t', image, '-f', DOCKERFILE, ...buildArgs, '.'], {
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
    try {
      await run(
        'docker',
        [
          'run', '-d',
          '--name', name,
          '--label', `hostx.project=${project.id}`,
          `--memory=${config.limits.memory}`,
          `--memory-swap=${config.limits.memory}`,
          `--cpus=${config.limits.cpus}`,
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
