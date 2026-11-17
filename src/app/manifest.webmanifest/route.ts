/** Home-screen settings for the office app. (The site supervisor screen has its own: site-manifest.webmanifest.) */
export const dynamic = 'force-static';
export function GET() {
  return new Response(JSON.stringify({
    name: 'ShiftReady - Staff Selection UK', short_name: 'ShiftReady', start_url: '/temps', display: 'standalone',
    background_color: '#0b0d10', theme_color: '#0b0d10',
    icons: [{ src: '/icon-192.png', sizes: '192x192', type: 'image/png' }, { src: '/icon-512.png', sizes: '512x512', type: 'image/png' }],
  }), { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=3600' } });
}
