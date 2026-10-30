import { config } from '../config/index.js';
import { logger } from '../utils/logger.js';
import { MailService } from './mail.service.js';
import { Store, type AdminNotification } from './store.service.js';

// At most one email per alert key (e.g. per project for failed deploys) in this window; the in-app list gets everything.
const EMAIL_THROTTLE_MS = 60 * 60 * 1000;

export interface AdminAlert {
  kind: AdminNotification['kind'];
  severity: AdminNotification['severity'];
  title: string;
  message: string;
  projectId?: string | null;
  userId?: string | null;
  /** Alerts with the same key are not repeated within `repeatAfterMs`. */
  dedupeKey?: string;
  repeatAfterMs?: number;
  /** Key for email throttling (defaults to the dedupe key, then the kind). */
  emailKey?: string;
  /** Dashboard page the email links to (defaults to Admin → Notifications), and its button text. */
  link?: string;
  linkLabel?: string;
}

/** Notifies every administrator: Admin → Notifications in the dashboard, plus an email when SMTP is configured. */
export class AdminAlertService {
  private static lastEmail = new Map<string, number>();

  static async notify(alert: AdminAlert): Promise<AdminNotification | null> {
    const now = Date.now();
    if (alert.dedupeKey) {
      const last = Store.lastAdminNotification(alert.dedupeKey);
      if (last && now - new Date(last.at).getTime() < (alert.repeatAfterMs ?? Number.MAX_SAFE_INTEGER)) return null;
    }
    const n: AdminNotification = {
      id: Store.newId('n'),
      at: new Date(now).toISOString(),
      kind: alert.kind,
      severity: alert.severity,
      title: alert.title,
      message: alert.message,
      projectId: alert.projectId ?? null,
      userId: alert.userId ?? null,
      dedupeKey: alert.dedupeKey ?? null,
      readAt: null,
    };
    await Store.addAdminNotification(n);
    logger.warn(`[admin alert] ${n.title}: ${n.message}`);

    const emailKey = alert.emailKey ?? alert.dedupeKey ?? alert.kind;
    if (now - (this.lastEmail.get(emailKey) ?? 0) >= EMAIL_THROTTLE_MS) {
      this.lastEmail.set(emailKey, now);
      const admins = Store.allUsers().filter((u) => u.role === 'admin' && !u.suspended);
      const link = `${config.dashboardUrl}${alert.link ?? '/admin/notifications'}`;
      for (const admin of admins) void MailService.adminAlert(admin.email, n.title, n.message, link, alert.linkLabel);
    }
    return n;
  }
}
