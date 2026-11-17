import type { Metadata } from 'next';

// Its own home-screen settings: saved to a phone, it opens straight on the site screen.
export const metadata: Metadata = {
  manifest: '/site-manifest.webmanifest',
  appleWebApp: { capable: true, title: 'ShiftReady Site', statusBarStyle: 'black' },
};

export default function SiteLayout({ children }: { children: React.ReactNode }) {
  return children;
}
