// AUTO-GENERATED — do not edit manually.
// Run `make schemas` to regenerate.

/**
 * CDN asset metadata for a player headshot, including all size variants.
 */
export interface HeadshotMetadata {
  player_id: string;
  sizes: {
    "64": AssetSet;
    "256": AssetSet;
    "512": AssetSet;
  };
  blurhash: string;
  source: string;
  license: string;
  fetched_at: string;
  is_fallback: boolean;
}
export interface AssetSet {
  webp: string;
  avif?: string;
  jpeg: string;
}
