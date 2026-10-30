import { config } from '../config/index.js';
import { exec } from '../utils/exec.js';
import { logger } from '../utils/logger.js';
import { AdminAlertService } from './admin-alert.service.js';
import { MongoService } from './mongo.service.js';
import { RunnerService } from './runner.service.js';
import { Store, limitsFor } from './store.service.js';

const INTERVAL_MS = 10 * 60 * 1000;
// A database at 80% of its plan's storage is a warning, 95% is critical. Server disks: 85% / 95%.
const DB_WARN = 80;
const DB_CRITICAL = 95;
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

export interface DatabaseUsage {
  projectId: string;
  projectName: string;
  ownerEmail: string;
  database: string;
  usedMb: number;
  limitMb: number;
  usedPercent: number;
}

export interface StorageReport {
  checkedAt: string | null;
  disks: DiskUsage[];
  databases: DatabaseUsage[];
  /** Why database sizes could not be read (e.g. MongoDB add-on off). */
  databaseNote: string | null;
}

const mb = (bytes: number) => Math.round((bytes / 1024 / 1024) * 10) / 10;
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
 * Watches storage so a database never fills up unnoticed: each project's MongoDB database against its plan's
 * storage limit, and the disks holding the databases (Docker's data root with the Mongo volume, and data/ with
 * the SQLite control-plane database and backups).
 */
export class StorageMonitorService {
  private static report: StorageReport = { checkedAt: null, disks: [], databases: [], databaseNote: null };
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
      const disks = await this.checkDisks();
      const { databases, note } = await this.checkDatabases();
      this.report = { checkedAt: new Date().toISOString(), disks, databases, databaseNote: note };
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
        message: `Only ${(d.freeMb / 1024).toFixed(1)} GB of ${(d.totalMb / 1024).toFixed(1)} GB is free on ${d.mount}. MongoDB data, the HostX database, backups and builds live here; when it is full, databases stop accepting writes and deploys fail. Free space or grow the disk.`,
        dedupeKey: `disk:${d.mount}:${level}`,
        repeatAfterMs: REPEAT_MS,
      });
    }
    return disks;
  }

  private static async checkDatabases(): Promise<{ databases: DatabaseUsage[]; note: string | null }> {
    const projects = Store.allProjects().filter((p) => p.database);
    if (projects.length === 0) return { databases: [], note: null };
    if (!MongoService.available()) return { databases: [], note: 'The MongoDB add-on is not running, so database sizes cannot be read.' };
    let sizes: Map<string, number>;
    try {
      sizes = await MongoService.sizes();
    } catch (err) {
      return { databases: [], note: `Could not read database sizes: ${(err as Error).message}` };
    }
    const databases: DatabaseUsage[] = [];
    for (const p of projects) {
      const db = p.database;
      if (!db) continue;
      const owner = Store.getUserById(p.userId);
      const limitMb = limitsFor(owner).databaseMb;
      const usedMb = mb(sizes.get(db.name) ?? 0);
      const usedPercent = limitMb > 0 ? Math.round((usedMb / limitMb) * 1000) / 10 : 0;
      databases.push({ projectId: p.id, projectName: p.name, ownerEmail: owner?.email ?? '', database: db.name, usedMb, limitMb, usedPercent });
      const level = levelOf(usedPercent, DB_WARN, DB_CRITICAL);
      if (!level) continue;
      await AdminAlertService.notify({
        kind: 'database-near-limit',
        severity: level,
        title: `Database of ${p.name} is ${usedPercent}% full`,
        message: `${owner?.email ?? 'unknown user'} · database ${db.name} uses ${usedMb} MB of the ${limitMb} MB allowed on the ${owner?.plan ?? 'current'} plan. Ask the owner to clean up or upgrade, or raise the limit.`,
        projectId: p.id,
        userId: p.userId,
        dedupeKey: `db:${p.id}:${level}`,
        repeatAfterMs: REPEAT_MS,
      });
    }
    databases.sort((a, b) => b.usedPercent - a.usedPercent);
    return { databases, note: null };
  }
}
