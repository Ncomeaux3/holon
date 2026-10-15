import type { MetadataRoute } from 'next'

// Served at /manifest.webmanifest by Next. The icons are the kit's dark
// appearance, opaque with square corners; the OS applies its own mask, and
// there is no padded maskable artwork in the kit, so purpose stays `any`.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Holon',
    short_name: 'Holon',
    description: 'Your life. One system.',
    start_url: '/',
    display: 'standalone',
    background_color: '#F2F2F7',
    theme_color: '#000000',
    icons: [
      { src: '/brand/holon-app-dark-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/brand/holon-app-dark-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }
}
