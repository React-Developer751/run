import { logger } from '../utils/logger.js';
import { DeployService } from './deploy.service.js';
import { RunnerService } from './runner.service.js';
import { Store, limitsFor, type Project } from './store.service.js';

const INTERVAL_MS = 60_000;

/**
 * Free-plan web services sleep after a stretch without requests (like Render's free tier) and wake on the next
 * request: the proxy holds that request while the container starts. Static sites never sleep (they cost nothing).
 */
export class SleepService {
  private static lastRequest = new Map<string, number>();
  private static waking = new Map<string, Promise<Project>>();
  private static startedAt = Date.now();

  static start(): void {
    setInterval(() => void this.tick().catch((err) => logger.warn('Sleep pass failed', err)), INTERVAL_MS).unref();
  }

  /** Called by the proxy for every request to an app. */
  static touch(projectId: string): void {
    this.lastRequest.set(projectId, Date.now());
  }

  static async tick(): Promise<void> {
    const now = Date.now();
    for (const project of [...Store.allProjects()]) {
      if (project.status !== 'live' || (project.runtime !== 'docker' && project.runtime !== 'process')) continue;
      const minutes = limitsFor(Store.getUserById(project.userId)).sleepAfterMinutes;
      if (minutes === null) continue;
      // After an engine restart nothing has been seen yet: count from the restart, not from zero.
      const last = Math.max(this.lastRequest.get(project.id) ?? 0, this.startedAt, new Date(project.updatedAt).getTime());
      if (now - last < minutes * 60_000) continue;
      try {
        await RunnerService.for(project).stop(project);
        await Store.updateProject(project.id, { status: 'sleeping', pid: null });
        logger.info(`${project.slug} is sleeping (idle ${minutes} min)`);
      } catch (err) {
        logger.warn(`Could not put ${project.slug} to sleep`, err);
      }
    }
  }

  /** Starts a sleeping app; concurrent requests share one wake-up. Resolves with the live project. */
  static wake(project: Project): Promise<Project> {
    let pending = this.waking.get(project.id);
    if (!pending) {
      pending = (async () => {
        logger.info(`Waking ${project.slug}...`);
        await DeployService.start(project);
        this.touch(project.id);
        return Store.getProject(project.id) as Project;
      })().finally(() => this.waking.delete(project.id));
      this.waking.set(project.id, pending);
    }
    return pending;
  }
}
