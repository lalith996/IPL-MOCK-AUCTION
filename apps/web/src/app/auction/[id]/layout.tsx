import type { Metadata } from "next";

interface Props {
  children: React.ReactNode;
  params: Promise<{ id: string }>;
}

export async function generateMetadata({ params }: Props): Promise<Metadata> {
  const { id } = await params;
  const shortId = id.slice(0, 8);

  return {
    title: `Live Auction #${shortId}`,
    description: `Watch the IPL 2026 mini-auction session #${shortId} live. Real-time bids from 10 AI franchise agents.`,
    openGraph: {
      title: `IPL 2026 Auction #${shortId} — Live`,
      description: "Real-time AI bidding for IPL players. Watch every bid as it happens.",
    },
    // Prevent search engines indexing individual auction rooms
    robots: { index: false, follow: false },
  };
}

export default function AuctionLayout({ children }: Props) {
  return <>{children}</>;
}
