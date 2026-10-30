import { config } from '../config/index.js';
import { exec } from '../utils/exec.js';
import { logger } from '../utils/logger.js';
import { AdminAlertService } from './admin-alert.service.js';
import { RunnerService } from './runner.service.js';

const INTERVAL_MS = 10 * 60 * 1000;
// Server disks: warning at 85%, critical at 95%.
const DISK_WARN = Number(process.env.HOSTX_DISK_WARN_PERCENT ?? 85);
const DISK_CRITICAL = Number(process.env.HOSTX_DISK_CRITICAL_PERCENT ?? 95);
// The same level is re-announced at most once a day; a jump from warning to critical is announced right away.
const REPEAT_MS = 24 * 60 * 60 * 1000;

export interface DiskUsage {
  path: string;
  mount: string;
  totalMb: number;
  freeMb: number;
  usedPercent: number;
}

export interface StorageReport {
  checkedAt: string | null;
  disks: DiskUsage[];
}

const levelOf = (pct: number, warn: number, critical: number) => (pct >= critical ? 'critical' : pct >= warn ? 'warning' : null);

/** df for one path (POSIX output, 1K blocks). */
async function diskOf(path: string): Promise<DiskUsage | null> {
  const { code, stdout } = await exec('df', ['-Pk', path]).catch(() => ({ code: 1, stdout: '' }));
  const line = stdout.trim().split('\n')[1];
  if (code !== 0 || !line) return null;
  const parts = line.trim().split(/\s+/);
  const used = Number(parts[2]);
  const free = Number(parts[3]);
  const mount = parts.slice(5).join(' ');
  if (!Number.isFinite(used) || !Number.isFinite(free) || used + free === 0) return null;
  return { path, mount, totalMb: Math.round((used + free) / 1024), freeMb: Math.round(free / 1024), usedPercent: Math.round((used / (used + free)) * 1000) / 10 };
}

/**
 * Watches the disks HostX depends on: data/ (SQLite control-plane database, backups, logs) and Docker's data root
 * (images, containers, build folders). A full disk stops deploys and can corrupt writes, so admins hear early.
 */
export class StorageMonitorService {
  private static report: StorageReport = { checkedAt: null, disks: [] };
  private static running = false;

  static start(): void {
    setTimeout(() => void this.check(), 60_000).unref();
    setInterval(() => void this.check(), INTERVAL_MS).unref();
  }

  static lastReport(): StorageReport {
    return this.report;
  }

  static async check(): Promise<StorageReport> {
    if (this.running) return this.report;
    this.running = true;
    try {
      this.report = { checkedAt: new Date().toISOString(), disks: await this.checkDisks() };
      return this.report;
    } catch (err) {
      logger.warn('Storage check failed', err);
      return this.report;
    } finally {
      this.running = false;
    }
  }

  private static async checkDisks(): Promise<DiskUsage[]> {
    const paths = [config.dataDir];
    if (RunnerService.current().name === 'docker') {
      const { stdout } = await exec('docker', ['info', '--format', '{{.DockerRootDir}}']).catch(() => ({ stdout: '' }));
      if (stdout.trim()) paths.push(stdout.trim());
    }
    const seen = new Set<string>();
    const disks: DiskUsage[] = [];
    for (const p of paths) {
      const d = await diskOf(p);
      if (!d || seen.has(d.mount)) continue;
      seen.add(d.mount);
      disks.push(d);
      const level = levelOf(d.usedPercent, DISK_WARN, DISK_CRITICAL);
      if (!level) continue;
      await AdminAlertService.notify({
        kind: 'disk-near-full',
        severity: level,
        title: `Server disk ${d.usedPercent}% full (${d.mount})`,
        message: `Only ${(d.freeMb / 1024).toFixed(1)} GB of ${(d.totalMb / 1024).toFixed(1)} GB is free on ${d.mount}. The HostX database, backups, images and builds live here; when it is full, deploys fail and the platform cannot save changes. Free space or grow the disk.`,
        dedupeKey: `disk:${d.mount}:${level}`,
        repeatAfterMs: REPEAT_MS,
      });
    }
    return disks;
  }
}
