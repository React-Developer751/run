import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProjectKind } from './store.service.js';

interface PackageJson {
  name?: string;
  main?: string;
  scripts?: Record<string, string>;
  engines?: { node?: string };
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
}

/** What HostX will do with a folder. Every field can be overridden by the user per project. */
export interface Detection {
  kind: ProjectKind;
  framework: string;
  /** Folder produced by the build command, relative to the source directory (static sites). */
  outputDir: string;
  /** Shell command run after `npm install`. Empty string = no build step. */
  buildCommand: string;
  /** Shell command that starts a web service. It must listen on process.env.PORT. */
  startCommand: string;
  packageName: string | null;
  /** false for plain folders without a package.json (e.g. hand-written HTML). */
  hasPackage: boolean;
  /** Node.js major version for the Docker image, from package.json "engines.node". */
  nodeVersion: string;
  /** Picked from the lockfile in the folder. */
  packageManager: PackageManager;
}

export type PackageManager = 'npm' | 'yarn' | 'pnpm';

// Node.js majors we build with. 22 is the default (Active LTS); 20 reached end-of-life in April 2026.
const NODE_MAJORS = [18, 20, 22, 24];
const DEFAULT_NODE = 22;

/** "^20", "20.x", "20.11.1" -> 20; ">=18" -> the default (22) because any newer version satisfies it. */
export function nodeMajorFor(spec: string | undefined): string {
  const major = Number(/(\d+)/.exec(spec ?? '')?.[1]);
  if (!spec || !Number.isFinite(major)) return String(DEFAULT_NODE);
  if (spec.trim().startsWith('>')) return String(Math.max(DEFAULT_NODE, ...NODE_MAJORS.filter((m) => m <= major)));
  if (NODE_MAJORS.includes(major)) return String(major);
  return String(NODE_MAJORS.find((m) => m >= major) ?? NODE_MAJORS[NODE_MAJORS.length - 1]);
}

/** Shell command that installs dependencies with the package manager the repo actually uses. */
export function installCommand(pm: PackageManager): string {
  // `corepack yarn` (not `corepack enable`) works without root: the build sandbox runs as an unprivileged user.
  if (pm === 'yarn') return 'corepack yarn install';
  if (pm === 'pnpm') return 'corepack pnpm install';
  return 'npm install --no-audit --no-fund';
}

const exists = (file: string) => fs.access(file).then(() => true, () => false);

const SERVER_LIBS: Record<string, string> = {
  express: 'Express',
  fastify: 'Fastify',
  koa: 'Koa',
  '@nestjs/core': 'NestJS',
  hono: 'Hono',
  '@hapi/hapi': 'Hapi',
  restify: 'Restify',
};

export class DetectService {
  static async fromDir(dir: string): Promise<Detection | null> {
    try {
      const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8')) as PackageJson;
      const packageManager: PackageManager = (await exists(path.join(dir, 'pnpm-lock.yaml')))
        ? 'pnpm'
        : (await exists(path.join(dir, 'yarn.lock'))) && !(await exists(path.join(dir, 'package-lock.json')))
          ? 'yarn'
          : 'npm';
      return { ...this.fromPackage(pkg), packageManager };
    } catch {
      return null;
    }
  }

  /** A folder with an index.html but no package.json is deployed as-is. */
  static async plainStatic(dir: string): Promise<Detection | null> {
    if (!(await exists(path.join(dir, 'index.html')))) return null;
    return {
      kind: 'static',
      framework: 'Static HTML',
      outputDir: '.',
      buildCommand: '',
      startCommand: '',
      packageName: null,
      hasPackage: false,
      nodeVersion: String(DEFAULT_NODE),
      packageManager: 'npm',
    };
  }

  static fromPackage(pkg: PackageJson): Detection {
    const deps = { ...pkg.dependencies, ...pkg.devDependencies };
    const has = (name: string) => name in deps;
    const scripts = pkg.scripts ?? {};
    const serverLib = Object.keys(SERVER_LIBS).find(has);
    const hasStart = Boolean(scripts.start);

    const base = {
      buildCommand: scripts.build ? 'npm run build' : '',
      startCommand: hasStart ? 'npm start' : `node ${pkg.main ?? 'index.js'}`,
      packageName: pkg.name ?? null,
      hasPackage: true,
      nodeVersion: nodeMajorFor(pkg.engines?.node),
      packageManager: 'npm' as PackageManager,
    };

    if (has('next')) return { ...base, kind: 'node', framework: 'Next.js', outputDir: '.next', startCommand: 'npm start' };
    if (has('nuxt')) return { ...base, kind: 'node', framework: 'Nuxt', outputDir: '.output' };

    if (has('react-scripts') && !serverLib) {
      return { ...base, kind: 'static', framework: 'Create React App', outputDir: 'build' };
    }

    const isVite = has('vite') || has('@vitejs/plugin-react') || has('@vitejs/plugin-react-swc');
    if (isVite && !(serverLib && hasStart)) {
      return { ...base, kind: 'static', framework: 'Vite', outputDir: 'dist' };
    }

    if (serverLib || hasStart || pkg.main) {
      return { ...base, kind: 'node', framework: serverLib ? (SERVER_LIBS[serverLib] as string) : 'Node.js', outputDir: 'dist' };
    }

    if (base.buildCommand) return { ...base, kind: 'static', framework: 'Static site', outputDir: 'dist' };
    return { ...base, kind: 'node', framework: 'Node.js', outputDir: 'dist' };
  }
}
