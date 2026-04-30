/**
 * Auction room loading skeleton — shown while the page chunk loads.
 */

export default function AuctionLoading() {
  return (
    <main className="min-h-screen bg-gray-50">
      {/* Skeleton header */}
      <header className="sticky top-0 z-10 flex items-center justify-between border-b border-gray-200 bg-white px-6 py-3 shadow-sm">
        <div className="h-5 w-40 animate-pulse rounded bg-gray-200" />
        <div className="h-6 w-24 animate-pulse rounded-full bg-gray-200" />
      </header>

      <div className="mx-auto max-w-screen-2xl p-4">
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr_320px]">
          {/* Left column skeleton */}
          <div className="space-y-4">
            <div className="h-72 animate-pulse rounded-2xl bg-white shadow-md" />
            <div className="h-36 animate-pulse rounded-2xl bg-white shadow-md" />
          </div>

          {/* Centre skeleton */}
          <div className="grid grid-cols-2 gap-3">
            {Array.from({ length: 10 }).map((_, i) => (
              <div
                key={i}
                className="h-48 animate-pulse rounded-xl bg-white shadow-sm"
                style={{ animationDelay: `${i * 50}ms` }}
              />
            ))}
          </div>

          {/* Right column skeleton */}
          <div className="space-y-3">
            {Array.from({ length: 5 }).map((_, i) => (
              <div
                key={i}
                className="h-28 animate-pulse rounded-xl bg-white shadow-sm"
                style={{ animationDelay: `${i * 80}ms` }}
              />
            ))}
          </div>
        </div>
      </div>
    </main>
  );
}
