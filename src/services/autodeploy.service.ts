import { config } from '../config/index.js';
import { exec } from '../utils/exec.js';
import { logger } from '../utils/logger.js';
import { DeployService } from './deploy.service.js';
import { Store, type Project } from './store.service.js';

const RETRY_AFTER_FAILURE_MS = 5 * 60 * 1000;

/** Latest commit of the project's branch on GitHub (full sha) or null when it cannot be read. */
async function remoteHead(project: Project): Promise<string | null> {
  const ref = project.branch ? `refs/heads/${project.branch}` : 'HEAD';
  try {
    const { code, stdout } = await exec('git', ['ls-remote', project.repoUrl, ref], { timeoutMs: 20_000 });
    if (code !== 0) return null;
    return /^([0-9a-f]{40})\s/.exec(stdout)?.[1] ?? null;
  } catch {
    return null;
  }
}

/** Commit that the project's most recent deployment attempt built (or tried to build). */
function lastKnownCommit(project: Project): string | null {
  return Store.deploymentsOf(project.id).find((d) => d.commit)?.commit ?? project.commit;
}

export class AutoDeployService {
  private static running = false;

  static start(): void {
    if (config.pollSeconds <= 0) {
      logger.info('Auto-deploy polling is disabled (HOSTX_POLL_SECONDS=0). Webhooks still work.');
      return;
    }
    setInterval(() => void this.tick(), config.pollSeconds * 1000).unref();
    logger.info(`Auto-deploy: checking GitHub for new commits every ${config.pollSeconds}s`);
  }

  /** One pass over every project. Safe to call concurrently: overlapping runs are skipped. */
  static async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      const heads = new Map<string, Promise<string | null>>();
      for (const project of [...Store.allProjects()]) {
        if (!project.autoDeploy || project.status === 'deploying' || project.status === 'stopped') continue;
        const known = lastKnownCommit(project);
        if (!known) continue;

        const latest = Store.deploymentsOf(project.id)[0];
        if (latest?.status === 'failed' && latest.trigger === 'auto' && Date.now() - new Date(latest.createdAt).getTime() < RETRY_AFTER_FAILURE_MS) {
          continue; // do not hammer a build that just failed
        }

        const key = `${project.repoUrl}#${project.branch ?? ''}`;
        if (!heads.has(key)) heads.set(key, remoteHead(project));
        const head = await heads.get(key);
        if (!head || head.startsWith(known)) continue;

        logger.info(`New commit ${head.slice(0, 7)} on ${project.repoUrl} -> redeploying ${project.slug}`);
        await DeployService.deploy(project, 'auto').catch((err: Error) => logger.warn(`Auto-deploy of ${project.slug} skipped: ${err.message}`));
      }
    } catch (err) {
      logger.error('Auto-deploy pass failed', err);
    } finally {
      this.running = false;
    }
  }
}
