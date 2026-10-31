import type { Router } from '../utils/http.js';
import { BillingController } from '../controllers/billing.controller.js';

export function registerBillingRoutes(router: Router): void {
  router.get('/api/billing/plans', BillingController.plans);
  router.get('/api/billing', BillingController.me);
  router.post('/api/billing/subscribe', BillingController.subscribe);
  router.post('/api/billing/upi', BillingController.payByUpi);
  router.post('/api/billing/cancel', BillingController.cancel);
  router.post('/api/billing/webhook', BillingController.webhook);
}
