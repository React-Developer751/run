import type { Router } from '../utils/http.js';
import { AuthController } from '../controllers/auth.controller.js';

export function registerAuthRoutes(router: Router): void {
  router.post('/api/auth/register', AuthController.register);
  router.post('/api/auth/login', AuthController.login);
  router.post('/api/auth/refresh', AuthController.refresh);
  router.post('/api/auth/logout', AuthController.logout);
  router.post('/api/auth/logout-all', AuthController.logoutAll);
  router.get('/api/auth/me', AuthController.me);
  router.post('/api/auth/password', AuthController.changePassword);
}
