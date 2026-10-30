import { logger } from '../utils/logger.js';
import { AlertService } from './alert.service.js';
import { DeployService } from './deploy.service.js';
import { RunnerService } from './runner.service.js';
import { Store, limitsFor, type Project } from './store.service.js';

const INTERVAL_MS = 30_000;
// Process mode has no restart policy: HostX restarts the app itself, but gives up when it keeps dying.
const MAX_AUTO_RESTARTS = 3;
const RESTART_WINDOW_MS = 10 * 60 * 1000;

const describeExit = (exitCode: number | null, oom: boolean) =>
  oom ? 'it ran out of memory' : exitCode !== null && exitCode !== 0 ? `it exited with code ${exitCode}` : 'it stopped unexpectedly';

/**
 * Watches running apps. Docker restarts crashed containers by itself (restart policy); this notices it, records an
 * event, marks apps that stay down as "crashed" (the proxy then shows a clear page) and emails the owner.
 */
export class MonitorService {
  private static running = false;
  /** Last seen Docker RestartCount per container. */
  private static restartCounts = new Map<string, number>();
  private static processRestarts = new Map<string, number[]>();

  static start(): void {
    setInterval(() => void this.tick(), INTERVAL_MS).unref();
    logger.info(`Crash monitor: checking running apps every ${INTERVAL_MS / 1000}s`);
  }

  static async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const project of [...Store.allProjects()]) {
        // Sleeping (free plan) and stopped apps are down on purpose.
        if ((project.status !== 'live' && project.status !== 'crashed') || project.runtime === null || project.runtime === 'static') continue;
        await this.check(project).catch((err) => logger.warn(`Health check of ${project.slug} failed`, err));
      }
    } finally {
      this.running = false;
    }
  }

  private static async check(project: Project): Promise<void> {
    const health = await RunnerService.for(project).health(project);
    // A deploy may have started while we were waiting on Docker.
    const current = Store.getProject(project.id);
    if (!current || (current.status !== 'live' && current.status !== 'crashed')) return;

    if (current.runtime === 'docker') {
      const key = `${current.id}:${current.containerName ?? ''}`;
      const seen = this.restartCounts.get(key);
      this.restartCounts.set(key, health.restartCount);
      if (seen !== undefined && health.restartCount > seen) {
        const why = describeExit(health.exitCode, health.oomKilled);
        await Store.addEvent(current.id, 'restart', `The app crashed (${why}) and was restarted automatically.`);
        this.alert(current, `${current.name} crashed`, `your app "${current.name}" crashed because ${why}. It was restarted automatically. Check the runtime logs.`, health.oomKilled);
      }
    } else if (!health.running && current.status === 'live') {
      await this.restartProcess(current);
      return;
    }

    if (!health.running && current.status === 'live') {
      const why = describeExit(health.exitCode, health.oomKilled);
      await Store.updateProject(current.id, { status: 'crashed' });
      await Store.addEvent(current.id, 'crash', `The app is down: ${why}.`);
      this.alert(current, `${current.name} is down`, `your app "${current.name}" is down because ${why}. Check the runtime logs, then redeploy or restart it.`, health.oomKilled);
    } else if (health.running && current.status === 'crashed') {
      await Store.updateProject(current.id, { status: 'live' });
      await Store.addEvent(current.id, 'recovered', 'The app is running again.');
    }
  }

  private static async restartProcess(project: Project): Promise<void> {
    const now = Date.now();
    const recent = (this.processRestarts.get(project.id) ?? []).filter((t) => now - t < RESTART_WINDOW_MS);
    let reason = `it stopped ${recent.length} times in 10 minutes, so automatic restarts are paused`;
    if (recent.length < MAX_AUTO_RESTARTS) {
      recent.push(now);
      this.processRestarts.set(project.id, recent);
      try {
        await DeployService.start(project);
        await Store.addEvent(project.id, 'restart', 'The app stopped unexpectedly and was restarted automatically.');
        return;
      } catch (err) {
        reason = `it stopped and could not be restarted (${(err as Error).message.replace(/^Could not start the app: /, '').slice(0, 200)})`;
      }
    }
    await Store.updateProject(project.id, { status: 'crashed', pid: null });
    await Store.addEvent(project.id, 'crash', `The app is down: ${reason}.`);
    this.alert(project, `${project.name} is down`, `your app "${project.name}" is down: ${reason}. Check the runtime logs.`, false);
  }

  private static alert(project: Project, title: string, message: string, oom: boolean): void {
    const hint = oom ? ` Each app may use up to ${limitsFor(Store.getUserById(project.userId)).memory} of memory on your plan.` : '';
    AlertService.notify(project, 'crash', title, message + hint);
  }
}
