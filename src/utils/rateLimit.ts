import { isIP } from 'node:net';
import { HttpError } from './errors.js';

interface Bucket {
  count: number;
  resetAt: number;
}

/** Most keys one limiter remembers. Beyond this the oldest windows are dropped, so a flood of keys cannot exhaust memory. */
const MAX_KEYS = 20_000;
const SWEEP_MS = 60_000;
const all = new Set<RateLimiter>();

// One timer for every limiter: forget windows that have ended.
setInterval(() => {
  const now = Date.now();
  for (const limiter of all) limiter.sweep(now);
}, SWEEP_MS).unref();

/** The eight groups of an IPv6 address, with "::" expanded. */
function v6Groups(ip: string): string[] {
  const addr = (ip.split('%')[0] ?? ip).toLowerCase();
  if (!addr.includes('::')) return addr.split(':');
  const [head = '', tail = ''] = addr.split('::');
  const h = head ? head.split(':') : [];
  const t = tail ? tail.split(':') : [];
  return [...h, ...Array<string>(Math.max(0, 8 - h.length - t.length)).fill('0'), ...t];
}

/**
 * Client address as a rate-limit key. IPv6 users usually get a whole /64 from their ISP, so counting single
 * addresses would let anyone dodge every per-IP limit by rotating inside it: IPv6 is counted per /64.
 * IPv4-mapped IPv6 (::ffff:1.2.3.4) is the plain IPv4 address.
 */
export function ipKey(ip: string): string {
  const v4 = /^::ffff:(\d+\.\d+\.\d+\.\d+)$/i.exec(ip);
  if (v4?.[1]) return v4[1];
  if (isIP(ip) !== 6) return ip;
  return `${v6Groups(ip).slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':')}::/64`;
}

/** Tiny in-memory fixed-window limiter (per key, e.g. IP + action). */
export class RateLimiter {
  private buckets = new Map<string, Bucket>();

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly message = 'Too many attempts. Please try again in a few minutes.',
  ) {
    all.add(this);
  }

  private refuse(bucket: Bucket, now: number): never {
    throw new HttpError(429, this.message, Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)));
  }

  /** Throws if `key` is already over the limit, without counting this attempt. */
  check(key: string): void {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (bucket && bucket.resetAt > now && bucket.count >= this.max) this.refuse(bucket, now);
  }

  /** Counts one attempt for `key`; throws 429 (with Retry-After) once the window's limit is passed. */
  hit(key: string): void {
    const now = Date.now();
    const bucket = this.buckets.get(key);
    if (!bucket || bucket.resetAt <= now) {
      if (bucket) this.buckets.delete(key);
      this.buckets.set(key, { count: 1, resetAt: now + this.windowMs });
      if (this.buckets.size > MAX_KEYS) this.sweep(now);
      return;
    }
    if (++bucket.count > this.max) this.refuse(bucket, now);
  }

  /** Drops ended windows; if still too many keys, drops the oldest ones (Map keeps insertion order). */
  sweep(now = Date.now()): void {
    for (const [k, b] of this.buckets) if (b.resetAt <= now) this.buckets.delete(k);
    if (this.buckets.size <= MAX_KEYS) return;
    let excess = this.buckets.size - Math.floor(MAX_KEYS * 0.9);
    for (const k of this.buckets.keys()) {
      if (excess-- <= 0) break;
      this.buckets.delete(k);
    }
  }

  /** For tests and diagnostics. */
  size(): number {
    return this.buckets.size;
  }
}
