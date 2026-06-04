/** @type {import('next').NextConfig} */
const nextConfig = {
  output: "standalone",

  // Preserve trailing slashes so /api/v1/auth/foo/ reaches Django as-is.
  // Without this, Next.js 308-redirects /foo/ → /foo before rewrites apply,
  // and Django URL patterns require trailing slashes.
  skipTrailingSlashRedirect: true,

  // Proxy /api/* to Django backend during local dev, avoids CORS entirely
  async rewrites() {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
    return [
      {
        source: "/api/:path*",
        destination: `${apiUrl}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
