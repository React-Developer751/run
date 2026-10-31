'use server';

import { updateTag } from 'next/cache';
import { SITE_NAME_TAG, cachedPublicInfo, freshPublicInfo } from '@/lib/brand';

/**
 * Called by Admin → Settings after the name or business details are saved: every server-rendered page shows the new
 * values on its next view. Anyone may call a server action, so it only drops the cache when the engine really
 * reports something different.
 */
export async function refreshSiteName(): Promise<void> {
  const [fresh, cached] = await Promise.all([freshPublicInfo(), cachedPublicInfo()]);
  if (fresh && fresh !== cached) updateTag(SITE_NAME_TAG);
}
