// Server-side only (uses Next's fetch cache).
import { DEFAULT_SITE_NAME } from './site';

/** Engine address for server-side fetches (same machine in production; the public URL works too). */
const API = process.env.HOSTX_INTERNAL_API_URL || process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000';
export const SITE_NAME_TAG = 'site-name';

/**
 * The platform name chosen in Admin → Settings, for server-rendered pages (titles, landing, legal pages).
 * Cached for 60 s and dropped immediately when the admin saves a new name (see app/actions.ts).
 * If the engine cannot be reached (e.g. during `next build`) the default is used and refreshed later.
 */
export async function getSiteName(): Promise<string> {
  try {
    const r = await fetch(`${API}/api/health`, { next: { revalidate: 60, tags: [SITE_NAME_TAG] } });
    if (!r.ok) return DEFAULT_SITE_NAME;
    const name = ((await r.json()) as { siteName?: string }).siteName;
    return name && name.trim() ? name : DEFAULT_SITE_NAME;
  } catch {
    return DEFAULT_SITE_NAME;
  }
}

/** The current name straight from the engine, bypassing the cache. */
export async function freshSiteName(): Promise<string | null> {
  try {
    const r = await fetch(`${API}/api/health`, { cache: 'no-store' });
    return r.ok ? (((await r.json()) as { siteName?: string }).siteName ?? null) : null;
  } catch {
    return null;
  }
}
