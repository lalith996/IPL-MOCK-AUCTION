import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { VitalsReporter } from "../components/VitalsReporter.js";

// ---------------------------------------------------------------------------
// Fonts — subset to Latin, display=swap prevents FOIT
// ---------------------------------------------------------------------------

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
  display: "swap",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
  display: "swap",
});

// ---------------------------------------------------------------------------
// Metadata
// ---------------------------------------------------------------------------

export const metadata: Metadata = {
  title: {
    default: "IPL 2026 Auction",
    template: "%s | IPL 2026 Auction",
  },
  description:
    "Watch the IPL 2026 mini-auction live. Ten AI franchise agents bid for players in real time.",
  keywords: ["IPL", "auction", "cricket", "live", "2026", "AI agents"],
  authors: [{ name: "IPL Auction Team" }],

  // Open Graph — image auto-served by app/opengraph-image.tsx
  openGraph: {
    type: "website",
    locale: "en_IN",
    title: "IPL 2026 Multi-Agent Auction",
    description: "Watch ten AI franchise agents bid for IPL players live.",
    siteName: "IPL 2026 Auction",
  },

  // Twitter card — og image picked up automatically
  twitter: {
    card: "summary_large_image",
    title: "IPL 2026 Auction",
    description: "Watch ten AI franchise agents bid for IPL players live.",
  },

  // PWA / mobile
  manifest: "/manifest.json",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: "IPL Auction",
  },

  // Robots
  robots: {
    index: true,
    follow: false, // don't index individual auction rooms
  },
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f9fafb" },
    { media: "(prefers-color-scheme: dark)", color: "#111827" },
  ],
  width: "device-width",
  initialScale: 1,
  maximumScale: 5,
};

// ---------------------------------------------------------------------------
// Root layout
// ---------------------------------------------------------------------------

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className="scroll-smooth">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased bg-gray-50 text-gray-900`}
      >
        {/* Web Vitals reporter — renders nothing, registers metrics once */}
        <VitalsReporter />
        {children}
      </body>
    </html>
  );
}
