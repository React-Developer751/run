import { HttpError } from './http.js';

interface Bucket {
  count: number;
  resetAt: number;
}

/** Tiny in-memory fixed-window limiter (per key, e.g. IP + action). */
export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly message = 'Too many attempts. Please try again in a few minutes.',
  ) {}

  hit(key: string): void {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
    } else if (++bucket.count > this.max) {
      throw new HttpError(429, this.message);
    }
    if (this.buckets.size > 5000) {
      for (const [k, b] of this.buckets) if (b.resetAt <= now) this.buckets.delete(k);
    }
  }
}
