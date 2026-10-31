import type { MetadataRoute } from 'next';
import { getSiteName } from '@/lib/brand';
import { SITE_DESCRIPTION } from '@/lib/site';

export default async function manifest(): Promise<MetadataRoute.Manifest> {
  const name = await getSiteName();
  return {
    name,
    short_name: name.length > 12 ? name.slice(0, 12).trim() : name,
    description: SITE_DESCRIPTION,
    start_url: '/dashboard',
    display: 'standalone',
    background_color: '#f4f2ff',
    theme_color: '#5b4bf0',
    icons: [
      { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml' },
      { src: '/icons/192', sizes: '192x192', type: 'image/png' },
      { src: '/icons/512', sizes: '512x512', type: 'image/png', purpose: 'any' },
    ],
  };
}
