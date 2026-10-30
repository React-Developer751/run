import fs from 'node:fs/promises';
import { createWriteStream, mkdirSync, type WriteStream } from 'node:fs';
import path from 'node:path';
import { config } from '../config/index.js';
import { siteSlug } from './brand.js';

const deployLogPath = (deploymentId: string) => path.join(config.logsDir, `${deploymentId}.log`);
export const runtimeLogPath = (projectId: string) => path.join(config.logsDir, `runtime-${projectId}.log`);

/** Users must not learn where HostX lives on the server. */
export const redactPaths = (text: string): string => text.split(config.rootDir).join('~');

/** Append-only build log for one deployment, readable by line offset while it is still being written. */
export class DeployLog {
  private stream: WriteStream;
  private bytes = 0;
  private truncated = false;

  constructor(deploymentId: string) {
    mkdirSync(config.logsDir, { recursive: true });
    this.stream = createWriteStream(deployLogPath(deploymentId), { flags: 'a' });
    // A full disk must lose log lines, not crash the engine (and with it every hosted app's proxy).
    this.stream.on('error', () => {
      this.truncated = true;
    });
  }

  write = (line: string): void => {
    if (this.truncated) return;
    if (this.bytes > config.limits.maxLogBytes) {
      this.truncated = true;
      this.stream.write(`[${siteSlug()}] Log limit reached, further output is truncated.\n`);
      return;
    }
    const text = redactPaths(line.slice(0, 2000));
    this.bytes += text.length + 1;
    this.stream.write(`${text}\n`);
  };

  system = (line: string): void => this.write(`[${siteSlug()}] ${line}`);

  close(): Promise<void> {
    return new Promise((resolve) => this.stream.end(resolve));
  }

  static async read(deploymentId: string, after: number): Promise<{ lines: string[]; next: number }> {
    try {
      const text = await fs.readFile(deployLogPath(deploymentId), 'utf8');
      const all = text.split('\n');
      if (all[all.length - 1] === '') all.pop();
      return { lines: all.slice(after), next: all.length };
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === 'ENOENT') return { lines: [], next: after };
      throw err;
    }
  }

  static async remove(deploymentId: string): Promise<void> {
    await fs.rm(deployLogPath(deploymentId), { force: true });
  }
}

/** Last `lines` lines of a (possibly large) log file. */
export async function tailFile(file: string, lines: number): Promise<string> {
  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(file, 'r');
    const { size } = await handle.stat();
    const length = Math.min(size, 256 * 1024);
    const buffer = Buffer.alloc(length);
    await handle.read(buffer, 0, length, size - length);
    const all = buffer.toString('utf8').split('\n');
    if (all[all.length - 1] === '') all.pop();
    return all.slice(-lines).join('\n');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return '';
    throw err;
  } finally {
    await handle?.close();
  }
}
