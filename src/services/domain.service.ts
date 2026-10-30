import crypto from 'node:crypto';
import { Resolver } from 'node:dns/promises';
import { config, siteOf } from '../config/index.js';
import { billingEnabled } from '../config/plans.js';
import { HttpError } from '../utils/http.js';
import { logger } from '../utils/logger.js';
import { Store, limitsFor, type CustomDomain, type Project } from './store.service.js';

const CHALLENGE = '_hostx-challenge';
const MAX_PER_PROJECT = 10;
const RECHECK_MS = 5 * 60 * 1000;
// Pending domains are re-checked automatically for a week; after that the user clicks "Verify" again.
const AUTO_CHECK_FOR_MS = 7 * 24 * 60 * 60 * 1000;
const LABEL = /^(?!-)[a-z0-9-]{1,63}(?<!-)$/;

/** Minimal resolver surface, replaceable in tests. */
export interface DnsLookup {
  resolveTxt(name: string): Promise<string[][]>;
  resolveCname(name: string): Promise<string[]>;
  resolve4(name: string): Promise<string[]>;
}

/**
 * Custom domains. Ownership is proven with a TXT record (so nobody can attach a domain they do not control, even if
 * its DNS already points at HostX). Traffic is routed by Host header; Caddy issues certificates on demand, but only
 * for domains that /api/domains/check confirms.
 */
export class DomainService {
  static dns: DnsLookup = (() => {
    const r = new Resolver({ timeout: 5000, tries: 2 });
    if (config.dnsServers.length) r.setServers(config.dnsServers);
    return r;
  })();

  static start(): void {
    setInterval(() => void this.recheckPending().catch((err) => logger.warn('Domain re-check failed', err)), RECHECK_MS).unref();
  }

  static challengeName(name: string): string {
    return `${CHALLENGE}.${name}`;
  }

  /** Where the user should point the domain. */
  static target(project: Project): string {
    return `${project.slug}.${config.baseDomain}`;
  }

  static normalize(value: unknown): string {
    if (typeof value !== 'string') throw new HttpError(400, 'Enter a domain like www.example.com');
    let name = value.trim().toLowerCase().replace(/^https?:\/\//, '').replace(/\/.*$/, '').replace(/\.$/, '');
    if (name.includes(':')) name = name.split(':')[0] as string;
    const labels = name.split('.');
    if (name.length > 253 || labels.length < 2 || !labels.every((l) => LABEL.test(l)) || /^\d+$/.test(labels[labels.length - 1] as string)) {
      throw new HttpError(400, 'Enter a valid domain like www.example.com (no wildcards, IP addresses or paths)');
    }
    const base = config.baseDomain;
    if (name === base || name.endsWith(`.${base}`)) throw new HttpError(400, `${base} addresses are assigned automatically`);
    const control = [...config.webOrigins, config.apiPublicUrl].flatMap((u) => {
      try {
        return [siteOf(new URL(u).hostname)];
      } catch {
        return [];
      }
    });
    if (control.includes(siteOf(name)) && !['localhost'].includes(siteOf(name))) throw new HttpError(400, 'That domain belongs to the platform itself');
    return name;
  }

  static async add(project: Project, raw: unknown): Promise<Project> {
    const name = this.normalize(raw);
    if (project.domains.some((d) => d.name === name)) throw new HttpError(409, 'This domain is already on the project');
    if (project.domains.length >= MAX_PER_PROJECT) throw new HttpError(400, `A project can have at most ${MAX_PER_PROJECT} domains`);
    // A domain verified elsewhere can still be added: whoever publishes this project's TXT record (i.e. controls DNS
    // today, e.g. after the domain changed hands) takes it over on verification.
    const limit = limitsFor(Store.getUserById(project.userId)).customDomains;
    const used = Store.projectsOf(project.userId).reduce((n, p) => n + p.domains.length, 0);
    if (used >= limit) {
      throw new HttpError(403, `Custom domain limit reached (${limit})${billingEnabled() ? '. Upgrade your plan on the Billing page for more.' : '.'}`);
    }
    const domain: CustomDomain = {
      name,
      // Bound to this project: re-adding the domain elsewhere needs a new record.
      token: `hostx-verify=${crypto.randomBytes(16).toString('hex')}`,
      verifiedAt: null,
      dns: 'unknown',
      lastCheckedAt: null,
      lastError: null,
      createdAt: new Date().toISOString(),
    };
    const updated = await Store.updateProject(project.id, { domains: [...project.domains, domain] });
    // Most people add the records first: try right away, but never fail the request because of DNS.
    return this.verify(updated, name).catch(() => updated);
  }

  static async remove(project: Project, name: string): Promise<Project> {
    if (!project.domains.some((d) => d.name === name)) throw new HttpError(404, 'Domain not found');
    return Store.updateProject(project.id, { domains: project.domains.filter((d) => d.name !== name) });
  }

  private static async lookup<T>(fn: () => Promise<T>, empty: T): Promise<T> {
    try {
      return await fn();
    } catch (err) {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'ENOTFOUND' || code === 'ENODATA') return empty;
      throw err;
    }
  }

  /** Does the domain resolve to HostX: a CNAME into the apps domain, or the same IPv4 addresses as it. */
  private static async pointsHere(project: Project, name: string): Promise<boolean> {
    const cnames = await this.lookup(() => this.dns.resolveCname(name), []);
    if (cnames.some((c) => c.toLowerCase().replace(/\.$/, '').endsWith(config.baseDomain))) return true;
    const [mine, ours] = await Promise.all([
      this.lookup(() => this.dns.resolve4(name), []),
      config.publicIp ? Promise.resolve([config.publicIp]) : this.lookup(() => this.dns.resolve4(this.target(project)), []),
    ]);
    return mine.length > 0 && mine.every((ip) => ours.includes(ip));
  }

  /** Checks the TXT record (ownership) and where the domain points. Verification is permanent once it succeeds. */
  static async verify(project: Project, name: string): Promise<Project> {
    const domain = project.domains.find((d) => d.name === name);
    if (!domain) throw new HttpError(404, 'Domain not found');
    const patch: Partial<CustomDomain> = { lastCheckedAt: new Date().toISOString(), lastError: null };
    try {
      if (!domain.verifiedAt) {
        const records = (await this.lookup(() => this.dns.resolveTxt(this.challengeName(name)), [])).map((chunks) => chunks.join(''));
        if (records.includes(domain.token)) patch.verifiedAt = new Date().toISOString();
        else patch.lastError = `TXT record ${this.challengeName(name)} not found yet (DNS changes can take a few minutes)`;
      }
      patch.dns = (await this.pointsHere(project, name)) ? 'ok' : 'not-pointing';
    } catch (err) {
      patch.lastError = (err as Error).message;
    }
    const fresh = Store.getProject(project.id);
    if (!fresh) throw new HttpError(404, 'Project not found');
    const updated = await Store.updateProject(fresh.id, { domains: fresh.domains.map((d) => (d.name === name ? { ...d, ...patch } : d)) });
    if (patch.verifiedAt) {
      logger.info(`Custom domain ${name} verified for ${project.slug}`);
      // The domain now belongs here: drop every other project's claim, verified or not (DNS proves current control).
      for (const other of Store.allProjects()) {
        if (other.id !== project.id && other.domains.some((d) => d.name === name)) {
          await Store.updateProject(other.id, { domains: other.domains.filter((d) => d.name !== name) });
        }
      }
    }
    return updated;
  }

  private static async recheckPending(): Promise<void> {
    const now = Date.now();
    for (const project of [...Store.allProjects()]) {
      for (const d of project.domains) {
        const pending = !d.verifiedAt && now - new Date(d.createdAt).getTime() < AUTO_CHECK_FOR_MS;
        // Verified domains: refresh the "points here" hint about once an hour.
        const stale = d.verifiedAt && now - new Date(d.lastCheckedAt ?? 0).getTime() > 60 * 60 * 1000;
        if (pending || stale) await this.verify(Store.getProject(project.id) ?? project, d.name).catch(() => undefined);
      }
    }
  }
}
