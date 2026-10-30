import type { Router } from '../utils/http.js';
import { SupportController } from '../controllers/support.controller.js';

export function registerSupportRoutes(router: Router): void {
  router.get('/api/public/testimonials', SupportController.testimonials);

  router.get('/api/feedback', SupportController.myFeedback);
  router.post('/api/feedback', SupportController.sendFeedback);

  router.get('/api/support/tickets', SupportController.myTickets);
  router.post('/api/support/tickets', SupportController.openTicket);
  router.get('/api/support/tickets/:id', SupportController.myTicket);
  router.post('/api/support/tickets/:id/messages', SupportController.userReply);
  router.post('/api/support/tickets/:id/close', SupportController.userClose);

  router.get('/api/admin/feedback', SupportController.adminFeedback);
  router.patch('/api/admin/feedback/:id', SupportController.featureFeedback);
  router.delete('/api/admin/feedback/:id', SupportController.deleteFeedback);
  router.get('/api/admin/support/tickets', SupportController.adminTickets);
  router.get('/api/admin/support/tickets/:id', SupportController.adminTicket);
  router.post('/api/admin/support/tickets/:id/messages', SupportController.adminReply);
  router.post('/api/admin/support/tickets/:id/status', SupportController.adminStatus);
}
