import { config } from '../config/index.js';
import { HttpError } from '../utils/http.js';
import { logger } from '../utils/logger.js';

/** Cloudflare Turnstile. Turned off (always passes) until HOSTX_TURNSTILE_SECRET is set. */
export class CaptchaService {
  static async require(token: unknown, ip: string): Promise<void> {
    if (!config.turnstileSecret) return;
    if (typeof token !== 'string' || token.length === 0 || token.length > 2048) throw new HttpError(400, 'Please complete the CAPTCHA');
    try {
      const res = await fetch('https://challenges.cloudflare.com/turnstile/v0/siteverify', {
        method: 'POST',
        body: new URLSearchParams({ secret: config.turnstileSecret, response: token, remoteip: ip }),
        signal: AbortSignal.timeout(10_000),
      });
      const data = (await res.json()) as { success?: boolean };
      if (data.success) return;
    } catch (err) {
      logger.warn(`Turnstile verification failed: ${(err as Error).message}`);
      throw new HttpError(503, 'Could not check the CAPTCHA right now. Please try again.');
    }
    throw new HttpError(400, 'CAPTCHA check failed. Please try again.');
  }
}
