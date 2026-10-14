import type { MetadataRoute } from 'next';
import { THEME_LIGHT } from './theme-colors';

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Taskeeper',
    short_name: 'Taskeeper',
    description: 'Task management for small teams',
    id: '/',
    start_url: '/',
    scope: '/',
    display: 'standalone',
    background_color: THEME_LIGHT,
    theme_color: THEME_LIGHT,
    icons: [
      { src: '/icons/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icons/icon-512.png', sizes: '512x512', type: 'image/png' },
      { src: '/icons/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
