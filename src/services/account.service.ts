import { HttpError } from '../utils/http.js';
import { logger } from '../utils/logger.js';
import { BillingService } from './billing.service.js';
import { DeployService } from './deploy.service.js';
import { Store, type User } from './store.service.js';

export class AccountService {
  /**
   * Permanently deletes an account and everything it owns: subscription (cancelled first, so a failed cancel never
   * leaves someone being charged for a deleted account), apps, images, databases, domains, logs, sessions and tokens.
   */
  static async delete(user: User): Promise<number> {
    const projects = Store.projectsOf(user.id);
    if (projects.some((p) => p.status === 'deploying')) throw new HttpError(409, 'A deployment is in progress. Try again in a minute.');
    try {
      await BillingService.cancelNow(user);
    } catch (err) {
      logger.warn(`Could not cancel the subscription of ${user.email}`, err);
      throw new HttpError(502, 'Could not cancel the subscription with the payment provider. Nothing was deleted; please try again.');
    }
    await Store.revokeUserSessions(user.id);
    for (const p of projects) await DeployService.remove(p);
    await Store.deleteUser(user.id);
    logger.info(`Account ${user.email} deleted with ${projects.length} project(s)`);
    return projects.length;
  }
}
