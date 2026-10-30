import type { MetadataRoute } from 'next';
import { SITE_DESCRIPTION } from '@/lib/site';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'HostX',
    short_name: 'HostX',
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
