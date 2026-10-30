import { readFile } from 'node:fs/promises';
import os from 'node:os';
import { config } from '../config/index.js';
import { exec } from '../utils/exec.js';
import { logger } from '../utils/logger.js';
import { AdminAlertService } from './admin-alert.service.js';
import { RunnerService } from './runner.service.js';
import { Store } from './store.service.js';

const INTERVAL_MS = 10 * 60 * 1000;
// Server disks: warning at 85%, critical at 95%.
const DISK_WARN = Number(process.env.HOSTX_DISK_WARN_PERCENT ?? 85);
const DISK_CRITICAL = Number(process.env.HOSTX_DISK_CRITICAL_PERCENT ?? 95);
// Server memory (RAM in use by everything: apps, builds, engine): warning at 85%, critical at 95%,
// only when it stays that high for MEMORY_SAMPLES checks in a row (a build briefly using a lot is normal).
const MEM_WARN = Number(process.env.HOSTX_MEMORY_WARN_PERCENT ?? 85);
const MEM_CRITICAL = Number(process.env.HOSTX_MEMORY_CRITICAL_PERCENT ?? 95);
const MEMORY_SAMPLES = 3;
const MEMORY_INTERVAL_MS = 60_000;
// Ports and Docker networks are hard per-server limits: warning at 80%, critical at 95%.
const CAP_WARN = 80;
const CAP_CRITICAL = 95;
// The same level is re-announced at most once a day; a jump from warning to critical is announced right away.
const REPEAT_MS = 24 * 60 * 60 * 1000;

export interface DiskUsage {
  path: string;
  mount: string;
  totalMb: number;
  freeMb: number;
  usedPercent: number;
}

export interface MemoryUsage {
  totalMb: number;
  usedMb: number;
  usedPercent: number;
  /** false outside Linux: os.freemem() counts the file cache as used, so the number is too high to alert on. */
  exact: boolean;
}

export interface CapacityUsage {
  /** Apps currently live, and all projects. */
  liveApps: number;
  projects: number;
  /** App ports in use (HOSTX_PORT_MIN-HOSTX_PORT_MAX, default 5001-24999). */
  ports: { used: number; total: number; usedPercent: number };
  /** Project networks in Docker (one per project) against HOSTX_NETWORK_CAPACITY. Null without Docker. */
  networks: { used: number; total: number; usedPercent: number } | null;
}

export interface StorageReport {
  checkedAt: string | null;
  disks: DiskUsage[];
  memory: MemoryUsage | null;
  capacity: CapacityUsage | null;
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

const pct = (used: number, total: number) => (total > 0 ? Math.round((used / total) * 1000) / 10 : 0);

/** RAM in use. Linux: MemAvailable (counts reclaimable cache as free, unlike os.freemem). Elsewhere: os.freemem. */
async function memoryNow(): Promise<MemoryUsage> {
  let totalKb = os.totalmem() / 1024;
  let availableKb = os.freemem() / 1024;
  let exact = false;
  try {
    const info = await readFile('/proc/meminfo', 'utf8');
    const kb = (key: string) => Number(new RegExp(`^${key}:\\s+(\\d+)`, 'm').exec(info)?.[1]);
    if (Number.isFinite(kb('MemTotal')) && Number.isFinite(kb('MemAvailable'))) {
      totalKb = kb('MemTotal');
      availableKb = kb('MemAvailable');
      exact = true;
    }
  } catch {
    /* not Linux */
  }
  const usedMb = Math.round((totalKb - availableKb) / 1024);
  const totalMb = Math.round(totalKb / 1024);
  return { totalMb, usedMb, usedPercent: pct(usedMb, totalMb), exact };
}

/**
 * Watches server capacity so admins hear before users notice: the disks HostX depends on (data/ with the SQLite
 * database and backups, Docker's data root with images and builds), RAM, and the hard per-server limits on app
 * ports and Docker networks.
 */
export class StorageMonitorService {
  private static report: StorageReport = { checkedAt: null, disks: [], memory: null, capacity: null };
  private static running = false;
  private static highMemorySamples = 0;

  static start(): void {
    setTimeout(() => void this.check(), 60_000).unref();
    setInterval(() => void this.check(), INTERVAL_MS).unref();
    // Memory changes fast: sample it every minute.
    setInterval(() => void this.checkMemory().catch((err) => logger.warn('Memory check failed', err)), MEMORY_INTERVAL_MS).unref();
  }

  /** Called when Docker refused to create a project network: deploys fail until the address pool is enlarged. */
  static async networksExhausted(detail: string): Promise<void> {
    await AdminAlertService.notify({
      kind: 'capacity-near-limit',
      severity: 'critical',
      title: 'Docker cannot create more app networks',
      message: `New deploys are failing: ${detail}. Enlarge "default-address-pools" in /etc/docker/daemon.json (see README), restart Docker, and raise HOSTX_NETWORK_CAPACITY to match.`,
      dedupeKey: 'networks:exhausted',
      repeatAfterMs: 60 * 60 * 1000,
    });
  }

  private static async checkMemory(): Promise<MemoryUsage> {
    const memory = await memoryNow();
    this.report = { ...this.report, memory };
    const level = memory.exact ? levelOf(memory.usedPercent, MEM_WARN, MEM_CRITICAL) : null;
    this.highMemorySamples = level ? this.highMemorySamples + 1 : 0;
    if (level && this.highMemorySamples >= MEMORY_SAMPLES) {
      await AdminAlertService.notify({
        kind: 'memory-high',
        severity: level,
        title: `Server memory ${memory.usedPercent}% used`,
        message: `${(memory.usedMb / 1024).toFixed(1)} GB of ${(memory.totalMb / 1024).toFixed(1)} GB RAM has been in use for ${MEMORY_SAMPLES}+ minutes. Apps may slow down or be killed for lack of memory, and builds can fail. Add RAM, move users to another server, or lower plan memory limits.`,
        dedupeKey: `memory:${level}`,
        repeatAfterMs: REPEAT_MS,
      });
    }
    return memory;
  }

  private static async checkCapacity(): Promise<CapacityUsage> {
    const projects = Store.allProjects();
    const portsTotal = config.portRange.max - config.portRange.min + 1;
    const portsUsed = Store.usedPorts().size;
    let networks: CapacityUsage['networks'] = null;
    if (RunnerService.current().name === 'docker') {
      const { stdout } = await exec('docker', ['network', 'ls', '-q', '--filter', 'name=hostx-net-']).catch(() => ({ stdout: '' }));
      const used = stdout.split('\n').filter((l) => l.trim()).length;
      networks = { used, total: config.limits.networkCapacity, usedPercent: pct(used, config.limits.networkCapacity) };
    }
    const capacity: CapacityUsage = {
      liveApps: projects.filter((p) => p.status === 'live').length,
      projects: projects.length,
      ports: { used: portsUsed, total: portsTotal, usedPercent: pct(portsUsed, portsTotal) },
      networks,
    };
    const checks: Array<[string, { used: number; total: number; usedPercent: number } | null, string]> = [
      ['ports', capacity.ports, `app ports (${config.portRange.min}-${config.portRange.max})`],
      ['networks', networks, 'Docker app networks'],
    ];
    for (const [key, c, label] of checks) {
      if (!c) continue;
      const level = levelOf(c.usedPercent, CAP_WARN, CAP_CRITICAL);
      if (!level) continue;
      await AdminAlertService.notify({
        kind: 'capacity-near-limit',
        severity: level,
        title: `${c.used} of ${c.total} ${label} in use`,
        message: `This server is close to its limit of ${label} (${c.usedPercent}%). When it is reached, new projects cannot be deployed. Add a server, delete unused projects, or raise the limit (README: Docker network pools).`,
        dedupeKey: `capacity:${key}:${level}`,
        repeatAfterMs: REPEAT_MS,
      });
    }
    return capacity;
  }

  static lastReport(): StorageReport {
    return this.report;
  }

  static async check(): Promise<StorageReport> {
    if (this.running) return this.report;
    this.running = true;
    try {
      const disks = await this.checkDisks();
      const capacity = await this.checkCapacity();
      const memory = await this.checkMemory();
      this.report = { checkedAt: new Date().toISOString(), disks, memory, capacity };
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
