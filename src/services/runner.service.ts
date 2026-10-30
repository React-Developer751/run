import { config } from '../config/index.js';
import { exec } from '../utils/exec.js';
import { logger } from '../utils/logger.js';
import type { Detection } from './detect.service.js';
import type { DeploymentStatus, Project, RuntimeKind } from './store.service.js';
import { DockerRunner } from './docker.service.js';
import { ProcessRunner } from './process.service.js';

export interface DeployContext {
  project: Project;
  /** Absolute path of the folder to build (repo root or chosen sub-folder). */
  srcDir: string;
  detection: Detection;
  /** Variables passed to the image build. Defaults to project.env. */
  buildEnv?: Record<string, string>;
  log: (line: string) => void;
  stage: (status: DeploymentStatus) => Promise<void>;
}

export interface RuntimePatch {
  runtime: RuntimeKind;
  pid: number | null;
  containerName: string | null;
  /** Set when the new version listens on a different port than the old one (zero-downtime switch). */
  port?: number;
  /** Image built for this version (Docker), kept so the deployment can be rolled back to. */
  image?: string;
}

export interface AppHealth {
  running: boolean;
  /** How often the runtime restarted the app by itself (Docker restart policy). */
  restartCount: number;
  exitCode: number | null;
  oomKilled: boolean;
}

export interface Runner {
  readonly name: 'docker' | 'process';
  /** Builds the project and starts it. Resolves once the app answers on its port. */
  deploy(ctx: DeployContext): Promise<RuntimePatch>;
  /**
   * Called after the project record points at the new version (traffic has switched over).
   * Removes what the previous version left running. `previous` is the project as it was before the deploy.
   */
  retire?(previous: Project, current: RuntimePatch): Promise<void>;
  /** Starts an already built app again (after a stop or a HostX restart). */
  start(project: Project, srcDir: string, detection: Detection): Promise<RuntimePatch>;
  /** Runs an image built by an earlier deployment again (rollback). Docker only. */
  startImage?(project: Project, kind: Detection['kind'], image: string, log: (line: string) => void): Promise<RuntimePatch>;
  /** Removes leftovers of interrupted deploys and builds (Docker only), run at boot. */
  cleanupOrphans?(): Promise<void>;
  /** Changes memory/CPU of the running app in place (Docker only). */
  updateLimits?(project: Project, memory: string, cpus: string): Promise<void>;
  stop(project: Project): Promise<void>;
  /** Stops the app and deletes everything it left behind (images, static files, logs). */
  remove(project: Project): Promise<void>;
  isAlive(project: Project): Promise<boolean>;
  health(project: Project): Promise<AppHealth>;
  runtimeLogs(project: Project, lines: number): Promise<string>;
}

export class RunnerService {
  private static docker = new DockerRunner();
  private static process = new ProcessRunner();
  private static dockerAvailable = false;

  static async init(): Promise<void> {
    if (config.runner !== 'process') {
      try {
        const { code } = await exec('docker', ['info', '--format', '{{.ServerVersion}}'], { timeoutMs: 8000 });
        this.dockerAvailable = code === 0;
      } catch {
        this.dockerAvailable = false;
      }
    }
    if (config.runner === 'docker' && !this.dockerAvailable) {
      throw new Error('HOSTX_RUNNER=docker but the Docker engine is not reachable. Start Docker or use HOSTX_RUNNER=auto.');
    }
    if (this.current().name === 'process') {
      if (config.isProduction && !config.allowUnsafeProcess) {
        throw new Error('Production needs Docker: refusing to run untrusted code as plain local processes. Install/start Docker (or set HOSTX_ALLOW_UNSAFE_PROCESS=1 if you really accept the risk).');
      }
      logger.warn('Docker not available: apps run as plain local processes (NO isolation). Use this for development only.');
    }
  }

  /** Runner used for new deployments. */
  static current(): Runner {
    return config.runner !== 'process' && this.dockerAvailable ? this.docker : this.process;
  }

  /** Runner that owns an already deployed project. */
  static for(project: Project): Runner {
    return project.runtime === 'docker' ? this.docker : this.process;
  }
}
