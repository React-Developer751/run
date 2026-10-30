import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { DeployService } from './deploy.service.js';
import { MailService } from './mail.service.js';
import { RunnerService } from './runner.service.js';
import { Store, kindOf, limitsFor, type Project } from './store.service.js';

const DAY = 24 * 60 * 60 * 1000;
const CHECK_MS = 60 * 60 * 1000;
const FLUSH_MS = 10 * 60 * 1000;
// The "will be archived" email goes out this many days before archiving.
const WARN_DAYS = 7;

/**
 * Free-plan apps nobody visits are paused, then archived, so abandoned projects do not hold server RAM and disk:
 * - no request for `pauseAfterDays` (7): the container is stopped. Everything is kept; the owner resumes it with one click.
 * - no request for `archiveAfterDays` (90): images and build output are deleted; the project (settings, env vars,
 *   domains, URL, history) stays, and a redeploy rebuilds it from GitHub.
 * Apps in use never pause, and paid plans never pause at all. There is no automatic wake-up on a visit:
 * the visitor sees a "paused" page and the owner resumes from the dashboard.
 */
export class InactivityService {
  /** Last request per project, kept in memory and saved every few minutes (not on every request). */
  private static visits = new Map<string, number>();
  private static running = false;

  static start(): void {
    setInterval(() => void this.flush().catch((err) => logger.warn('Saving visit times failed', err)), FLUSH_MS).unref();
    setInterval(() => void this.tick().catch((err) => logger.warn('Inactivity pass failed', err)), CHECK_MS).unref();
  }

  /** Called by the proxy for every request to an app. */
  static touch(projectId: string): void {
    this.visits.set(projectId, Date.now());
  }

  /** Writes the remembered visit times to the database (also on shutdown). */
  static async flush(): Promise<void> {
    const pending = [...this.visits];
    this.visits.clear();
    for (const [id, at] of pending) {
      const p = Store.getProject(id);
      if (p && (!p.lastVisitAt || new Date(p.lastVisitAt).getTime() < at)) await Store.updateProject(id, { lastVisitAt: new Date(at).toISOString() });
    }
  }

  private static lastActivity(p: Project): number {
    const remembered = this.visits.get(p.id) ?? 0;
    return Math.max(remembered, new Date(p.lastVisitAt ?? p.createdAt).getTime());
  }

  static async tick(now = Date.now()): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      for (const project of [...Store.allProjects()]) {
        const owner = Store.getUserById(project.userId);
        const { pauseAfterDays, archiveAfterDays } = limitsFor(owner);
        // Static sites cost almost nothing (no server process), so they are never paused or archived.
        if (!owner || project.runtime === null || project.runtime === 'static' || kindOf(project) === 'static') continue;
        if (project.status === 'deploying' || project.status === 'archived') continue;
        const idleDays = (now - this.lastActivity(project)) / DAY;

        // 1) In use or not yet idle long enough: nothing to do. 2) Running but idle: pause.
        if ((project.status === 'live' || project.status === 'crashed') && pauseAfterDays !== null && idleDays >= pauseAfterDays) {
          await this.pause(project, owner.email, owner.name, pauseAfterDays);
          continue;
        }
        if (archiveAfterDays === null) continue;
        // Only apps that are down (paused, or stopped/failed/crashed by themselves) move towards archiving,
        // and always with a warning email first, at least WARN_DAYS before the archive.
        const down = project.status === 'paused' || project.status === 'stopped' || project.status === 'failed' || project.status === 'crashed';
        if (!down || idleDays < archiveAfterDays - WARN_DAYS) continue;
        if (!project.archiveWarnedAt) {
          await Store.updateProject(project.id, { archiveWarnedAt: new Date(now).toISOString() });
          void MailService.appAlert(
            owner.email,
            owner.name,
            `${project.name} will be archived in ${WARN_DAYS} days`,
            `your app "${project.name}" has had no visits for ${Math.floor(idleDays)} days. In ${WARN_DAYS} days it will be archived: its settings, environment variables, domains and URL stay, but bringing it back then rebuilds it from GitHub (1–3 minutes). Resume or redeploy it now to keep it ready.`,
            `${config.dashboardUrl}/projects/${project.id}`,
          );
          continue;
        }
        const warnedDays = (now - new Date(project.archiveWarnedAt).getTime()) / DAY;
        if (idleDays >= archiveAfterDays && warnedDays >= WARN_DAYS) await this.archive(project, owner.email, owner.name);
      }
    } finally {
      this.running = false;
    }
  }

  private static async pause(project: Project, email: string, name: string, days: number): Promise<void> {
    // Status first: the crash monitor and auto-deploy must not treat it as "live but down" while it stops.
    await Store.updateProject(project.id, { status: 'paused', pausedAt: new Date().toISOString() });
    await RunnerService.for(project).stop(project);
    const now = Store.getProject(project.id);
    if (now?.status !== 'paused') return; // a deploy or the owner took over meanwhile
    await Store.updateProject(project.id, { pid: null });
    await Store.addEvent(project.id, 'paused', `Paused: no visits for ${days} days (free plan). Resume it any time.`);
    logger.info(`${project.slug} paused after ${days} idle days`);
    void MailService.appAlert(
      email,
      name,
      `${project.name} was paused`,
      `your free app "${project.name}" had no visits for ${days} days, so we paused it to keep the platform free for everyone. Nothing was deleted: open the project and click Resume to bring it back in seconds. Apps on a paid plan are never paused.`,
      `${config.dashboardUrl}/projects/${project.id}`,
    );
  }

  private static async archive(project: Project, email: string, name: string): Promise<void> {
    await DeployService.archive(project);
    await Store.addEvent(project.id, 'archived', 'Archived after a long time without visits. Redeploy to bring it back.');
    logger.info(`${project.slug} archived`);
    void MailService.appAlert(
      email,
      name,
      `${project.name} was archived`,
      `your free app "${project.name}" was archived after a long time without visits. Its settings, environment variables, domains and URL are kept. Open the project and click Restore to rebuild it from GitHub (1–3 minutes) whenever you need it. Keep the repository on GitHub: restoring builds from it.`,
      `${config.dashboardUrl}/projects/${project.id}`,
    );
  }
}
