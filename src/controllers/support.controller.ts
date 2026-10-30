import type { Ctx } from '../utils/http.js';
import { HttpError } from '../utils/http.js';
import { RateLimiter } from '../utils/rateLimit.js';
import { config } from '../config/index.js';
import { AdminAlertService } from '../services/admin-alert.service.js';
import { AuthService } from '../services/auth.service.js';
import { MailService } from '../services/mail.service.js';
import { Store, siteName, type Feedback, type Ticket, type TicketMessage, type User } from '../services/store.service.js';

const CATEGORIES: Ticket['category'][] = ['emergency', 'deploy', 'billing', 'account', 'other'];
const CATEGORY_LABEL: Record<Ticket['category'], string> = {
  emergency: 'Emergency (site down)',
  deploy: 'Deploys & builds',
  billing: 'Billing',
  account: 'Account',
  other: 'Other',
};
const MAX_OPEN_TICKETS = 10;
const MAX_MESSAGES = 200;

// New tickets are rare; replies can be quicker. Both stop someone flooding the admins' inbox.
const ticketLimiter = new RateLimiter(5, 60 * 60 * 1000, 'You opened several requests recently. Please add to an existing one or wait an hour.');
const messageLimiter = new RateLimiter(30, 60 * 60 * 1000, 'Too many messages. Please wait a little before writing again.');
const feedbackLimiter = new RateLimiter(10, 60 * 60 * 1000, 'Too many feedback submissions. Please try again later.');

const text = (v: unknown, field: string, min: number, max: number): string => {
  if (typeof v !== 'string') throw new HttpError(400, `${field} is required`);
  // Keep line breaks, drop other control characters.
  const s = v.replace(/[\u0000-\u0009\u000b-\u001f\u007f]/g, '').trim();
  if (s.length < min) throw new HttpError(400, min <= 1 ? `${field} is required` : `${field} must be at least ${min} characters`);
  if (s.length > max) throw new HttpError(400, `${field} must be at most ${max} characters`);
  return s;
};

/** "Priya Sharma" -> "Priya S." (what the landing page shows). */
const publicName = (name: string) => {
  const [first = `A ${siteName()} user`, last] = name.trim().split(/\s+/);
  return last ? `${first} ${last[0]!.toUpperCase()}.` : first;
};

const ownProjectId = (user: User, v: unknown): string | null => {
  if (v === undefined || v === null || v === '') return null;
  if (typeof v !== 'string') throw new HttpError(400, 'projectId must be a string');
  const p = Store.getProject(v);
  if (!p || p.userId !== user.id) throw new HttpError(404, 'Project not found');
  return p.id;
};

const projectName = (id: string | null) => (id ? (Store.getProject(id)?.name ?? null) : null);

const feedbackRow = (f: Feedback) => ({ ...f, projectName: projectName(f.projectId) });

const ticketSummary = (t: Ticket, side: 'user' | 'admin') => {
  const last = t.messages[t.messages.length - 1];
  return {
    id: t.id,
    subject: t.subject,
    category: t.category,
    status: t.status,
    projectId: t.projectId,
    projectName: projectName(t.projectId),
    messages: t.messages.length,
    lastMessage: last ? { from: last.from, at: last.at, preview: last.text.slice(0, 140) } : null,
    unread: side === 'user' ? t.userUnread : t.adminUnread,
    createdAt: t.createdAt,
    updatedAt: t.updatedAt,
  };
};

const ticketDetail = (t: Ticket, side: 'user' | 'admin') => ({ ...ticketSummary(t, side), thread: t.messages });

function ownTicket(ctx: Ctx, user: User): Ticket {
  const t = Store.getTicket(ctx.params.id ?? '');
  if (!t || t.userId !== user.id) throw new HttpError(404, 'Request not found');
  return t;
}

function anyTicket(ctx: Ctx): Ticket {
  const t = Store.getTicket(ctx.params.id ?? '');
  if (!t) throw new HttpError(404, 'Request not found');
  return t;
}

const message = (from: TicketMessage['from'], author: User, body: string): TicketMessage => ({
  id: Store.newId('m'),
  at: new Date().toISOString(),
  from,
  // Users see "HostX Support" for admin replies, not the admin's personal name.
  authorName: from === 'admin' ? `${siteName()} Support` : author.name,
  text: body,
});

export class SupportController {
  // ── feedback (users) ────────────────────────────────────
  static myFeedback(ctx: Ctx) {
    const user = AuthService.requireUser(ctx.user);
    return { feedback: Store.allFeedback().filter((f) => f.userId === user.id).map(feedbackRow) };
  }

  /** One entry per user and project: sending again updates it (and takes it off the landing page until re-approved). */
  static async sendFeedback(ctx: Ctx) {
    const user = AuthService.requireUser(ctx.user);
    feedbackLimiter.hit(`fb:${user.id}`);
    const body = await ctx.json();
    const rating = body.rating;
    if (typeof rating !== 'number' || !Number.isInteger(rating) || rating < 1 || rating > 5) throw new HttpError(400, 'rating must be 1 to 5 stars');
    const msg = body.message === undefined || body.message === '' ? '' : text(body.message, 'Message', 0, 1000);
    const projectId = ownProjectId(user, body.projectId);
    const allowPublic = body.allowPublic === true;
    const now = new Date().toISOString();
    const existing = Store.allFeedback().find((f) => f.userId === user.id && f.projectId === projectId);
    const entry: Feedback = {
      id: existing?.id ?? Store.newId('f'),
      userId: user.id,
      projectId,
      rating: rating as Feedback['rating'],
      message: msg,
      allowPublic,
      featured: false,
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
    };
    await Store.putFeedback(entry);
    ctx.status = existing ? 200 : 201;
    return { feedback: feedbackRow(entry) };
  }

  /** Featured feedback for the landing page: first name + last initial, never emails or project names. */
  static testimonials() {
    const rows = Store.allFeedback()
      .filter((f) => f.featured && f.allowPublic && f.message)
      .slice(0, 12)
      .map((f) => {
        const u = Store.getUserById(f.userId);
        const p = f.projectId ? Store.getProject(f.projectId) : undefined;
        return { id: f.id, name: publicName(u?.name ?? ''), rating: f.rating, message: f.message, kind: p?.kind ?? null, at: f.createdAt };
      });
    return { testimonials: rows };
  }

  // ── support tickets (users) ─────────────────────────────
  static myTickets(ctx: Ctx) {
    const user = AuthService.requireUser(ctx.user);
    const tickets = Store.ticketsOf(user.id).map((t) => ticketSummary(t, 'user'));
    return { tickets, unread: tickets.filter((t) => t.unread).length };
  }

  static async openTicket(ctx: Ctx) {
    const user = AuthService.requireUser(ctx.user);
    const body = await ctx.json();
    const subject = text(body.subject, 'Subject', 4, 120);
    const category = body.category as Ticket['category'];
    if (!CATEGORIES.includes(category)) throw new HttpError(400, 'Pick a category');
    const first = text(body.message, 'Message', 10, 5000);
    const projectId = ownProjectId(user, body.projectId);
    if (Store.ticketsOf(user.id).filter((t) => t.status !== 'closed').length >= MAX_OPEN_TICKETS) {
      throw new HttpError(409, `You already have ${MAX_OPEN_TICKETS} open requests. Close one you no longer need, or add to an existing one.`);
    }
    ticketLimiter.hit(`t:${user.id}`);
    const now = new Date().toISOString();
    const ticket: Ticket = {
      id: Store.newId('tk'),
      userId: user.id,
      subject,
      category,
      projectId,
      status: 'open',
      messages: [message('user', user, first)],
      userUnread: false,
      adminUnread: true,
      createdAt: now,
      updatedAt: now,
    };
    await Store.putTicket(ticket);
    await AdminAlertService.notify({
      kind: 'support-ticket',
      severity: category === 'emergency' ? 'critical' : 'warning',
      title: `${category === 'emergency' ? 'EMERGENCY: ' : ''}Support request: ${subject}`,
      message: `${user.email} · ${CATEGORY_LABEL[category]}${projectId ? ` · ${projectName(projectId)}` : ''} · ${first.slice(0, 300)}`,
      projectId,
      userId: user.id,
      emailKey: `ticket:${ticket.id}`,
      link: `/admin/support?id=${ticket.id}`,
      linkLabel: 'Open the request',
    });
    ctx.status = 201;
    return { ticket: ticketDetail(ticket, 'user') };
  }

  static async myTicket(ctx: Ctx) {
    const user = AuthService.requireUser(ctx.user);
    let t = ownTicket(ctx, user);
    if (t.userUnread) t = await Store.putTicket({ ...t, userUnread: false });
    return { ticket: ticketDetail(t, 'user') };
  }

  static async userReply(ctx: Ctx) {
    const user = AuthService.requireUser(ctx.user);
    const t = ownTicket(ctx, user);
    const body = await ctx.json();
    const reply = text(body.text, 'Message', 1, 5000);
    if (t.messages.length >= MAX_MESSAGES) throw new HttpError(409, 'This conversation is very long. Please open a new request.');
    messageLimiter.hit(`m:${user.id}`);
    const now = new Date().toISOString();
    // Writing in a closed request opens it again.
    const updated = await Store.putTicket({ ...t, messages: [...t.messages, message('user', user, reply)], status: 'open', adminUnread: true, userUnread: false, updatedAt: now });
    await AdminAlertService.notify({
      kind: 'support-ticket',
      severity: t.category === 'emergency' ? 'critical' : 'warning',
      title: `New reply: ${t.subject}`,
      message: `${user.email}: ${reply.slice(0, 300)}`,
      projectId: t.projectId,
      userId: user.id,
      emailKey: `ticket:${t.id}`,
      link: `/admin/support?id=${t.id}`,
      linkLabel: 'Open the request',
    });
    return { ticket: ticketDetail(updated, 'user') };
  }

  static async userClose(ctx: Ctx) {
    const user = AuthService.requireUser(ctx.user);
    const t = ownTicket(ctx, user);
    const updated = await Store.putTicket({ ...t, status: 'closed', updatedAt: new Date().toISOString() });
    return { ticket: ticketDetail(updated, 'user') };
  }

  // ── admin ───────────────────────────────────────────────
  static adminFeedback(ctx: Ctx) {
    AuthService.requireAdmin(ctx.user);
    const all = Store.allFeedback();
    const rows = all.map((f) => {
      const u = Store.getUserById(f.userId);
      return { ...feedbackRow(f), userName: u?.name ?? 'Deleted user', userEmail: u?.email ?? '', publicName: publicName(u?.name ?? '') };
    });
    const avg = all.length ? Math.round((all.reduce((s, f) => s + f.rating, 0) / all.length) * 10) / 10 : null;
    return { feedback: rows, average: avg, featured: all.filter((f) => f.featured).length };
  }

  static async featureFeedback(ctx: Ctx) {
    const actor = AuthService.requireAdmin(ctx.user);
    const f = Store.getFeedback(ctx.params.id ?? '');
    if (!f) throw new HttpError(404, 'Feedback not found');
    const body = await ctx.json();
    if (typeof body.featured !== 'boolean') throw new HttpError(400, 'featured must be true or false');
    if (body.featured && !f.allowPublic) throw new HttpError(409, 'This user did not allow their feedback to be shown publicly.');
    if (body.featured && !f.message) throw new HttpError(409, 'Only feedback with a written message can be shown on the landing page.');
    const updated = await Store.putFeedback({ ...f, featured: body.featured });
    await Store.addAudit(actor, body.featured ? 'feedback.feature' : 'feedback.unfeature', f.id, `${f.rating}★`);
    return { feedback: feedbackRow(updated) };
  }

  static async deleteFeedback(ctx: Ctx) {
    const actor = AuthService.requireAdmin(ctx.user);
    const f = Store.getFeedback(ctx.params.id ?? '');
    if (!f) throw new HttpError(404, 'Feedback not found');
    await Store.deleteFeedback(f.id);
    await Store.addAudit(actor, 'feedback.delete', f.id, `${f.rating}★ by ${Store.getUserById(f.userId)?.email ?? 'deleted user'}`);
    return { ok: true };
  }

  static adminTickets(ctx: Ctx) {
    AuthService.requireAdmin(ctx.user);
    const tickets = Store.allTickets().map((t) => {
      const u = Store.getUserById(t.userId);
      return { ...ticketSummary(t, 'admin'), userName: u?.name ?? 'Deleted user', userEmail: u?.email ?? '', userPlan: u?.plan ?? null };
    });
    return { tickets, unread: tickets.filter((t) => t.unread).length, open: tickets.filter((t) => t.status === 'open').length };
  }

  static async adminTicket(ctx: Ctx) {
    AuthService.requireAdmin(ctx.user);
    let t = anyTicket(ctx);
    if (t.adminUnread) t = await Store.putTicket({ ...t, adminUnread: false });
    const u = Store.getUserById(t.userId);
    return { ticket: { ...ticketDetail(t, 'admin'), userName: u?.name ?? 'Deleted user', userEmail: u?.email ?? '', userPlan: u?.plan ?? null, userId: t.userId } };
  }

  static async adminReply(ctx: Ctx) {
    const actor = AuthService.requireAdmin(ctx.user);
    const t = anyTicket(ctx);
    const body = await ctx.json();
    const reply = text(body.text, 'Reply', 1, 5000);
    if (t.messages.length >= MAX_MESSAGES) throw new HttpError(409, 'This conversation is too long; ask the user to open a new request.');
    const close = body.close === true;
    const updated = await Store.putTicket({
      ...t,
      messages: [...t.messages, message('admin', actor, reply)],
      status: close ? 'closed' : 'answered',
      userUnread: true,
      adminUnread: false,
      updatedAt: new Date().toISOString(),
    });
    await Store.addAudit(actor, 'support.reply', t.id, t.subject);
    const owner = Store.getUserById(t.userId);
    if (owner) void MailService.supportReply(owner.email, owner.name, t.subject, `${config.dashboardUrl}/support?id=${t.id}`);
    return { ticket: ticketDetail(updated, 'admin') };
  }

  static async adminStatus(ctx: Ctx) {
    const actor = AuthService.requireAdmin(ctx.user);
    const t = anyTicket(ctx);
    const body = await ctx.json();
    if (body.status !== 'open' && body.status !== 'closed') throw new HttpError(400, 'status must be "open" or "closed"');
    const updated = await Store.putTicket({ ...t, status: body.status, updatedAt: new Date().toISOString() });
    await Store.addAudit(actor, `support.${body.status === 'closed' ? 'close' : 'reopen'}`, t.id, t.subject);
    return { ticket: ticketDetail(updated, 'admin') };
  }
}
