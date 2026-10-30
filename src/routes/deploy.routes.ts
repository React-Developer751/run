import type { Router } from '../utils/http.js';
import { WebhookController } from '../controllers/webhook.controller.js';
import { DeployController } from '../controllers/deploy.controller.js';
import { GitHubController } from '../controllers/github.controller.js';

export function registerDeployRoutes(router: Router): void {
  router.get('/api/health', DeployController.health);
  router.post('/api/scan', DeployController.scan);

  router.get('/api/projects', DeployController.list);
  router.post('/api/projects', DeployController.create);
  router.get('/api/projects/:id', DeployController.get);
  router.patch('/api/projects/:id', DeployController.update);
  router.delete('/api/projects/:id', DeployController.remove);

  router.post('/api/projects/:id/deploy', DeployController.redeploy);
  router.post('/api/projects/:id/stop', DeployController.stop);
  router.post('/api/projects/:id/start', DeployController.start);
  router.post('/api/projects/:id/database', DeployController.createDatabase);
  router.delete('/api/projects/:id/database', DeployController.deleteDatabase);

  router.get('/api/projects/:id/deployments/:did/logs', DeployController.deploymentLogs);
  router.post('/api/webhooks/github/:id', WebhookController.github);
  router.get('/api/projects/:id/logs', DeployController.runtimeLogs);

  router.get('/api/github', GitHubController.status);
  router.delete('/api/github', GitHubController.unlink);
  router.get('/api/auth/github/callback', GitHubController.callback);
  router.get('/api/github/repos', GitHubController.repos);
  router.post('/api/github/webhook', GitHubController.webhook);
}
