import fs from 'node:fs/promises';
import path from 'node:path';
import { config } from '../config/index.js';
import { exec, run } from '../utils/exec.js';
import { PortService } from './port.service.js';
import type { Detection } from './detect.service.js';
import type { DeployContext, Runner, RuntimePatch } from './runner.service.js';
import type { Project } from './store.service.js';

const DOCKERFILE = '.hostx.Dockerfile';
const NGINX_CONF = '.hostx.nginx.conf';

const containerName = (p: Project) => `hostx-${p.id}`;
const networkName = (p: Project) => `hostx-net-${p.id}`;
const imageName = (p: Project) => `hostx-${p.id}:latest`;

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
  const install = detection.hasPackage ? 'COPY package*.json ./\nRUN npm install --no-audit --no-fund' : '';
  // Exec-form JSON keeps the user's command on one Dockerfile line, whatever characters it contains.
  const build = detection.buildCommand ? `RUN ${JSON.stringify(['sh', '-c', detection.buildCommand])}` : '';

  if (detection.kind === 'static') {
    return `FROM node:20-alpine AS build
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
  return `FROM node:20-alpine
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
    const envKeys = Object.keys(project.env);

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
    const buildArgs = envKeys.flatMap((k) => ['--build-arg', `${k}=${project.env[k]}`]);
    await run('docker', ['build', '-t', imageName(project), '-f', DOCKERFILE, ...buildArgs, '.'], {
      cwd: srcDir,
      onLine: log,
      timeoutMs: config.limits.buildTimeoutMs,
    });

    await stage('starting');
    log('[hostx] Starting container...');
    await exec('docker', ['rm', '-f', containerName(project)]);
    // One private network per project: containers of different users cannot reach each other.
    await exec('docker', ['network', 'create', '--driver', 'bridge', networkName(project)]);
    return this.startContainer(project, detection, log);
  }

  private async startContainer(project: Project, detection: Detection, log: (l: string) => void): Promise<RuntimePatch> {
    const innerPort = detection.kind === 'static' ? 80 : 3000;
    const envFile = path.join(config.envDir, `${project.id}.env`);
    await fs.mkdir(config.envDir, { recursive: true });
    const lines = Object.entries(project.env).map(([k, v]) => `${k}=${v}`);
    if (detection.kind === 'node') lines.push('NODE_ENV=production', 'PORT=3000');
    await fs.writeFile(envFile, lines.join('\n'), { mode: 0o600 });

    try {
      await run(
        'docker',
        [
          'run', '-d',
          '--name', containerName(project),
          `--memory=${config.limits.memory}`,
          `--memory-swap=${config.limits.memory}`,
          `--cpus=${config.limits.cpus}`,
          `--pids-limit=${config.limits.pids}`,
          '--restart', 'unless-stopped',
          '--network', networkName(project),
          '--ulimit', 'nofile=4096:4096',
          '--cap-drop=ALL',
          '--security-opt', 'no-new-privileges',
          '--env-file', envFile,
          '-p', `127.0.0.1:${project.port}:${innerPort}`,
          imageName(project),
        ],
        { onLine: log },
      );
    } finally {
      await fs.rm(envFile, { force: true });
    }

    const ready = await PortService.waitForPort(project.port, config.limits.startTimeoutMs, async () => !(await this.isAlive(project)));
    if (!ready) {
      const logs = await this.runtimeLogs(project, 20);
      if (logs) log(logs);
      await exec('docker', ['rm', '-f', containerName(project)]);
      throw new Error(`App did not respond within ${config.limits.startTimeoutMs / 1000}s (or the container exited). Make sure it listens on process.env.PORT (3000).`);
    }
    return { runtime: 'docker', pid: null, containerName: containerName(project) };
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
    await exec('docker', ['rm', '-f', containerName(project)]);
    await exec('docker', ['rmi', '-f', imageName(project)]);
    await exec('docker', ['network', 'rm', networkName(project)]);
  }

  async isAlive(project: Project): Promise<boolean> {
    const { code, stdout } = await exec('docker', ['inspect', '-f', '{{.State.Running}}', containerName(project)]).catch(() => ({
      code: 1,
      stdout: '',
    }));
    return code === 0 && stdout.trim() === 'true';
  }

  async runtimeLogs(project: Project, lines: number): Promise<string> {
    let out = '';
    await exec('docker', ['logs', '--tail', String(lines), containerName(project)], {
      onLine: (l) => {
        out += `${l}\n`;
      },
    }).catch(() => undefined);
    return out.trimEnd();
  }
}
