import type { NextConfig } from "next";

const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
];

const nextConfig: NextConfig = {
  // Pages that read the session or the database are rendered per request
  // (see docs/assumptions.md: Cache Components is intentionally off).
  cacheComponents: false,
  // E2E runs use a separate build dir so they can run beside `next dev`.
  distDir: process.env.NEXT_DIST_DIR || ".next",
  serverExternalPackages: ["@electric-sql/pglite", "postgres"],
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
  // Old hosts (e.g. the *.vercel.app production alias) permanently redirect to
  // APP_URL, so wallet sign-in always happens on the domain the server signs for.
  async redirects() {
    const target = process.env.APP_URL;
    const hosts = (process.env.REDIRECT_HOSTS || "").split(",").map((h) => h.trim()).filter(Boolean);
    if (!target || hosts.length === 0) return [];
    const origin = new URL(target).origin;
    return hosts
      .filter((host) => host !== new URL(target).host)
      .map((host) => ({ source: "/:path*", has: [{ type: "host" as const, value: host }], destination: `${origin}/:path*`, permanent: true }));
  },
};

export default nextConfig;
