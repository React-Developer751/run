import type { Router } from '../utils/http.js';
import { AdminController } from '../controllers/admin.controller.js';

export function registerAdminRoutes(router: Router): void {
  router.get('/api/admin/stats', AdminController.stats);

  router.get('/api/admin/users', AdminController.users);
  router.patch('/api/admin/users/:id', AdminController.updateUser);
  router.post('/api/admin/users/:id/reset-password', AdminController.resetPassword);
  router.delete('/api/admin/users/:id', AdminController.deleteUser);

  router.get('/api/admin/projects', AdminController.projects);
  router.post('/api/admin/projects/:id/stop', AdminController.stop);
  router.post('/api/admin/projects/:id/start', AdminController.start);
  router.post('/api/admin/projects/:id/deploy', AdminController.redeploy);
  router.delete('/api/admin/projects/:id', AdminController.remove);
  router.get('/api/admin/projects/:id/deployments/:did/logs', AdminController.deploymentLogs);
  router.get('/api/admin/projects/:id/logs', AdminController.runtimeLogs);

  router.get('/api/admin/deployments', AdminController.deployments);
  router.get('/api/admin/settings', AdminController.getSettings);
  router.patch('/api/admin/settings', AdminController.updateSettings);
  router.get('/api/admin/audit', AdminController.audit);
}
