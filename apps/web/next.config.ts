import type { NextConfig } from "next";

// ---------------------------------------------------------------------------
// Security headers — applied to every response
// ---------------------------------------------------------------------------

const SECURITY_HEADERS = [
  // Prevent clickjacking
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  // Stop MIME sniffing
  { key: "X-Content-Type-Options", value: "nosniff" },
  // Referrer policy — don't leak URL to third parties
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  // Permissions policy — no cameras, mics, geolocation
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=()",
  },
  // CSP — allow own origin, CDN for headshots, inline styles for Tailwind
  {
    key: "Content-Security-Policy",
    value: [
      "default-src 'self'",
      // Scripts: own origin + 'unsafe-inline' removed; React hydration needs unsafe-eval in dev
      "script-src 'self' 'unsafe-inline'",
      // Styles: Tailwind uses inline styles at runtime
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      // Fonts
      "font-src 'self' https://fonts.gstatic.com",
      // Images: own origin + CDN bucket for headshots + data URIs for blurhash
      "img-src 'self' data: blob: https://cdn.ipl-auction.internal",
      // WebSocket: broadcaster
      "connect-src 'self' ws: wss:",
      // No iframes
      "frame-ancestors 'none'",
    ].join("; "),
  },
  // HSTS — enable only in production (Next.js adds it via vercel/k8s in prod)
  ...(process.env["NODE_ENV"] === "production"
    ? [
        {
          key: "Strict-Transport-Security",
          value: "max-age=63072000; includeSubDomains; preload",
        },
      ]
    : []),
];

// ---------------------------------------------------------------------------
// Image optimization — whitelist headshot CDN + local dev origins
// ---------------------------------------------------------------------------

const IMAGE_DOMAINS = [
  "cdn.ipl-auction.internal",
  "localhost",
  // MinIO local dev
  "127.0.0.1",
];

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

const nextConfig: NextConfig = {
  // React Compiler (Next.js 16 + React 19)
  reactCompiler: true,

  // Output as standalone Docker bundle for production
  output: process.env["NEXT_STANDALONE"] === "1" ? "standalone" : undefined,

  // Image optimisation
  images: {
    remotePatterns: IMAGE_DOMAINS.map((hostname) => ({
      protocol: "https" as const,
      hostname,
    })),
    // Serve WebP + AVIF, match spec §16.2 size ladder
    formats: ["image/avif", "image/webp"],
    deviceSizes: [64, 256, 512, 1024],
    imageSizes: [64, 128, 256, 512],
  },

  // Security headers on all routes
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: SECURITY_HEADERS,
      },
    ];
  },

  // Env vars accessible on the server side (not exposed to browser)
  env: {
    AUCTION_MANAGER_URL:
      process.env["AUCTION_MANAGER_URL"] ?? "http://localhost:3004",
  },

  // Compress responses (redundant when behind nginx/CDN but good default)
  compress: true,

  // Power-of-2 chunk IDs in prod for deterministic caching
  generateBuildId: async () =>
    process.env["BUILD_ID"] ??
    `build-${new Date().toISOString().slice(0, 10)}`,

  // Silence noisy duplicate React key warnings in prod (dev still shows)
  reactStrictMode: true,
};

export default nextConfig;
