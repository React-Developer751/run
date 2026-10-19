import fs from 'node:fs/promises';
import path from 'node:path';
import type { ProjectKind } from './store.service.js';

interface PackageJson {
  name?: string;
  main?: string;
  scripts?: Record<string, string>;
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
}

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
      return this.fromPackage(pkg);
    } catch {
      return null;
    }
  }

  /** A folder with an index.html but no package.json is deployed as-is. */
  static async plainStatic(dir: string): Promise<Detection | null> {
    const exists = await fs.access(path.join(dir, 'index.html')).then(() => true, () => false);
    if (!exists) return null;
    return {
      kind: 'static',
      framework: 'Static HTML',
      outputDir: '.',
      buildCommand: '',
      startCommand: '',
      packageName: null,
      hasPackage: false,
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
