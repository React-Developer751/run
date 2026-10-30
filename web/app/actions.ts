'use server';

import { updateTag } from 'next/cache';
import { SITE_NAME_TAG, freshSiteName, getSiteName } from '@/lib/brand';

/**
 * Called by Admin → Settings after the name is saved: every server-rendered page shows the new name on its next view.
 * Anyone may call a server action, so it only drops the cache when the engine really reports a different name.
 */
export async function refreshSiteName(): Promise<void> {
  const [fresh, cached] = await Promise.all([freshSiteName(), getSiteName()]);
  if (fresh && fresh !== cached) updateTag(SITE_NAME_TAG);
}
