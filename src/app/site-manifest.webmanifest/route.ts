/** Home-screen settings for the site supervisor screen, so "Add to Home Screen" opens /site, not the office pages. */
export const dynamic = 'force-static';
export function GET() {
  return new Response(JSON.stringify({
    name: 'ShiftReady Site', short_name: 'ShiftReady Site', start_url: '/site', scope: '/site', display: 'standalone',
    background_color: '#0b0d10', theme_color: '#0b0d10',
    icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }],
  }), { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=3600' } });
}
