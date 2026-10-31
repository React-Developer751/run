import crypto from 'node:crypto';
import type { Ctx } from '../utils/http.js';
import { HttpError } from '../utils/http.js';
import { RateLimiter } from '../utils/rateLimit.js';
import { DeployService } from '../services/deploy.service.js';
import { Store } from '../services/store.service.js';

const limiter = new RateLimiter(60, 60 * 1000);

function validSignature(secret: string, body: Buffer, header: string | undefined): boolean {
  if (!header?.startsWith('sha256=')) return false;
  const expected = Buffer.from(crypto.createHmac('sha256', secret).update(body).digest('hex'));
  const given = Buffer.from(header.slice(7));
  return expected.length === given.length && crypto.timingSafeEqual(expected, given);
}

export class WebhookController {
  /** GitHub "push" webhook. Authenticated by the per-project HMAC secret, not by a user session. */
  static async github(ctx: Ctx) {
    // Per project: GitHub delivers every user's pushes from the same few IPs, so a per-IP limit would let one busy
    // repository (or someone probing ids) block everybody's deploys.
    limiter.hit(`webhook:${ctx.params.id ?? ''}:${ctx.ipKey}`);
    const project = Store.getProject(ctx.params.id ?? '');
    const body = await ctx.raw();
    // Same answer for unknown project and bad signature so ids cannot be probed.
    if (!project || !validSignature(project.webhookSecret, body, ctx.headers['x-hub-signature-256'] as string | undefined)) {
      throw new HttpError(401, 'Invalid webhook signature');
    }

    const event = ctx.headers['x-github-event'];
    if (event === 'ping') return { ok: true, message: 'pong' };
    if (event !== 'push') return { ok: true, ignored: `event "${String(event)}" is not used` };

    const payload = await ctx.json();
    const repo = (payload.repository ?? {}) as { default_branch?: string };
    const wanted = `refs/heads/${project.branch ?? repo.default_branch ?? 'main'}`;
    if (payload.ref !== wanted) return { ok: true, ignored: `push to ${String(payload.ref)}, watching ${wanted}` };
    if (!project.autoDeploy) return { ok: true, ignored: 'auto-deploy is turned off' };
    if (project.status === 'deploying' || project.status === 'stopped' || project.status === 'suspended') return { ok: true, ignored: `project is ${project.status}` };

    const deployment = await DeployService.deploy(project, 'auto');
    ctx.status = 202;
    return { ok: true, deploymentId: deployment.id };
  }
}
