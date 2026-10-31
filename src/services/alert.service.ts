import { config } from '../config/index.js';
import { MailService } from './mail.service.js';
import { Store, type Project } from './store.service.js';

const THROTTLE_MS = 60 * 60 * 1000;

/** Emails the owner of a project about incidents, at most once per project and kind per hour. */
export class AlertService {
  private static lastSent = new Map<string, number>();

  static notify(project: Project, kind: 'crash' | 'deploy-failed', title: string, message: string): void {
    const key = `${project.id}:${kind}`;
    const now = Date.now();
    if (now - (this.lastSent.get(key) ?? 0) < THROTTLE_MS) return;
    const owner = Store.getUserById(project.userId);
    if (!owner || owner.suspended) return;
    this.lastSent.set(key, now);
    void MailService.appAlert(owner.email, owner.name, title, message, `${config.dashboardUrl}/projects/${project.id}`);
  }
}
