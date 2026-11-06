/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Payroll uploads client timesheet exports through a server action (base64, so allow a few MB).
  experimental: { serverActions: { bodySizeLimit: '8mb' } },
  // Friendlier addresses for the public sign-up page.
  async redirects() {
    return [
      { source: '/register', destination: '/join', permanent: false },
      { source: '/apply', destination: '/join', permanent: false },
    ];
  },
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
        ],
      },
    ];
  },
};

export default nextConfig;
