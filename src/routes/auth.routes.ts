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
  router.post('/api/auth/verify-email', AuthController.verifyEmail);
  router.post('/api/auth/resend-verification', AuthController.resendVerification);
  router.post('/api/auth/forgot-password', AuthController.forgotPassword);
  router.post('/api/auth/reset-password', AuthController.resetPassword);
}
