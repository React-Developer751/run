import { spawn } from 'node:child_process';
import type { Readable } from 'node:stream';

export interface ExecOptions {
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  onLine?: (line: string) => void;
  timeoutMs?: number;
  /** Human name used in error messages, e.g. "git clone". */
  label?: string;
}

export interface ExecResult {
  code: number | null;
  stdout: string;
}

export function killGroup(pid: number | undefined, signal: NodeJS.Signals = 'SIGKILL'): void {
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch {
    try {
      process.kill(pid, signal);
    } catch {
      /* already gone */
    }
  }
}

/** Runs a command (no shell) and streams its output line by line. Never throws on a non-zero exit. */
export function exec(command: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: opts.cwd,
      env: { ...(opts.env ?? process.env), GIT_TERMINAL_PROMPT: '0' },
      detached: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    let timedOut = false;

    const feed = (stream: Readable, capture: boolean) => {
      let buffer = '';
      stream.setEncoding('utf8');
      stream.on('data', (chunk: string) => {
        if (capture && stdout.length < 1_000_000) stdout += chunk;
        buffer += chunk;
        const parts = buffer.split(/\r\n|\n|\r/);
        buffer = parts.pop() ?? '';
        for (const part of parts) if (part.trim()) opts.onLine?.(part);
      });
      stream.on('end', () => {
        if (buffer.trim()) opts.onLine?.(buffer);
      });
    };
    feed(child.stdout, true);
    feed(child.stderr, false);

    const timer = opts.timeoutMs
      ? setTimeout(() => {
          timedOut = true;
          killGroup(child.pid);
        }, opts.timeoutMs)
      : null;

    child.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(new Error(`Failed to start '${command}': ${err.message}`));
    });
    child.on('close', (code) => {
      if (timer) clearTimeout(timer);
      if (timedOut) reject(new Error(`${opts.label ?? `'${command} ${args[0] ?? ''}'`} timed out after ${Math.round((opts.timeoutMs ?? 0) / 1000)}s`));
      else resolve({ code, stdout });
    });
  });
}

/** Like exec, but rejects when the command exits with a non-zero code. */
export async function run(command: string, args: string[], opts: ExecOptions = {}): Promise<ExecResult> {
  const result = await exec(command, args, opts);
  if (result.code !== 0) {
    throw new Error(`${opts.label ?? `'${command} ${args[0] ?? ''}'`} failed with exit code ${result.code}`);
  }
  return result;
}
