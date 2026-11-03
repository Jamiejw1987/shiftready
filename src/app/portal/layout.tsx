import type { Metadata } from 'next';

// The portal installs as its own home-screen app, opening straight into the client's shifts.
export const metadata: Metadata = {
  title: 'ShiftReady for clients | Staff Selection UK',
  manifest: '/portal/manifest.webmanifest',
  appleWebApp: { capable: true, title: 'ShiftReady', statusBarStyle: 'black-translucent' },
};

export default function PortalRoot({ children }: { children: React.ReactNode }) {
  return children;
}
