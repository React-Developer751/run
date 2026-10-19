import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { config } from '../config/index.js';
import { run } from '../utils/exec.js';
import { DetectService } from './detect.service.js';
import type { ProjectKind } from './store.service.js';

export interface ScanFolder {
  path: string;
  packageName: string | null;
  framework: string;
  kind: ProjectKind;
  buildCommand: string;
  startCommand: string;
  outputDir: string;
}

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build', '.next', 'coverage', 'out', 'vendor']);
const MAX_DEPTH = 3;
const MAX_FOLDERS = 40;

export class ClonerService {
  /** Shallow clone: only the latest commit of one branch, so large histories never slow a deploy down. */
  static async clone(repoUrl: string, branch: string | null, dest: string, onLine?: (line: string) => void): Promise<void> {
    const args = [
      '-c', 'core.symlinks=false',
      '-c', 'protocol.file.allow=never',
      '-c', 'protocol.ext.allow=never',
      // Abort a transfer that stalls (below ~1KB/s for 20s) instead of hanging until the overall timeout.
      '-c', 'http.lowSpeedLimit=1000',
      '-c', 'http.lowSpeedTime=20',
      'clone', '--depth', '1', '--single-branch', ...(branch ? ['--branch', branch] : []), '--', repoUrl, dest];
    const opts = { ...(onLine ? { onLine } : {}), timeoutMs: config.limits.cloneTimeoutMs, label: 'git clone' };
    try {
      await run('git', args, opts);
    } catch (err) {
      // GitHub occasionally stalls or resets a connection; one clean retry fixes nearly all of these.
      onLine?.(`[hostx] Clone failed (${(err as Error).message}), retrying once...`);
      await fs.rm(dest, { recursive: true, force: true });
      await run('git', args, opts);
    }
  }

  static async headCommit(dir: string): Promise<string | null> {
    try {
      const { stdout } = await run('git', ['rev-parse', '--short', 'HEAD'], { cwd: dir });
      return stdout.trim() || null;
    } catch {
      return null;
    }
  }

  /** Clones into a temp folder and lists every sub-folder that contains a package.json (monorepo support). */
  static async scan(repoUrl: string, branch: string | null): Promise<ScanFolder[]> {
    const dest = path.join(config.tmpDir, `scan-${crypto.randomBytes(6).toString('hex')}`);
    await fs.mkdir(config.tmpDir, { recursive: true });
    try {
      await this.clone(repoUrl, branch, dest);
      const found: ScanFolder[] = [];
      const queue: Array<{ rel: string; depth: number }> = [{ rel: '.', depth: 0 }];

      while (queue.length > 0 && found.length < MAX_FOLDERS) {
        const { rel, depth } = queue.shift() as { rel: string; depth: number };
        const abs = path.join(dest, rel);
        const detection = (await DetectService.fromDir(abs)) ?? (await DetectService.plainStatic(abs));
        if (detection) {
          found.push({
            path: rel,
            packageName: detection.packageName,
            framework: detection.framework,
            kind: detection.kind,
            buildCommand: detection.buildCommand,
            startCommand: detection.startCommand,
            outputDir: detection.outputDir,
          });
        }
        if (depth >= MAX_DEPTH) continue;

        const entries = await fs.readdir(abs, { withFileTypes: true });
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
          if (!entry.isDirectory() || entry.name.startsWith('.') || SKIP_DIRS.has(entry.name)) continue;
          queue.push({ rel: rel === '.' ? entry.name : `${rel}/${entry.name}`, depth: depth + 1 });
        }
      }
      return found;
    } finally {
      await fs.rm(dest, { recursive: true, force: true });
    }
  }
}
