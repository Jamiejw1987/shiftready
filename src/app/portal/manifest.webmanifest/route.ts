import { NextResponse } from 'next/server';

/** Home-screen app for clients: opens on their shifts, not the office screens. */
export function GET() {
  return NextResponse.json({
    name: 'ShiftReady - Staff Selection UK',
    short_name: 'ShiftReady',
    id: '/portal',
    start_url: '/portal',
    scope: '/portal',
    display: 'standalone',
    background_color: '#0b0d10',
    theme_color: '#0b0d10',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png' },
    ],
  }, { headers: { 'Content-Type': 'application/manifest+json', 'Cache-Control': 'public, max-age=3600' } });
}
