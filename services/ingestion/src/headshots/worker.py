"""
Headshot ingestion pipeline.

For each player in the auction pool:
1. Fetch headshot from approved source
2. Normalize: center-crop → square, strip EXIF, convert to WebP/AVIF/JPEG
3. Generate 64/256/512 px variants
4. Compute blurhash
5. Upload to S3-compatible object store with content-hashed filenames
6. Write headshot_metadata row to Postgres
7. Emit headshot_ingestion_report.json
"""

from __future__ import annotations

import hashlib
import io
import json
import logging
import os
from dataclasses import asdict, dataclass
from datetime import UTC, datetime
from pathlib import Path
from typing import Any

import blurhash
from PIL import Image

logger = logging.getLogger(__name__)

_SIZES = [64, 256, 512]
_FORMATS = ["webp", "jpeg"]  # avif requires extra encoder; kept optional
_PIL_FORMAT = {"webp": "WEBP", "jpeg": "JPEG", "avif": "AVIF"}


@dataclass
class HeadshotAssetSet:
    webp: str
    jpeg: str
    avif: str | None = None

    def to_dict(self) -> dict[str, str]:
        out = {"webp": self.webp, "jpeg": self.jpeg}
        if self.avif:
            out["avif"] = self.avif
        return out


@dataclass
class HeadshotRecord:
    player_id: str
    sizes: dict[str, dict[str, str]]
    blurhash: str
    source: str
    license: str
    fetched_at: str
    is_fallback: bool

    def to_dict(self) -> dict[str, Any]:
        return asdict(self)


def _center_crop_square(img: Image.Image) -> Image.Image:
    """Crop to the largest centered square."""
    w, h = img.size
    side = min(w, h)
    left = (w - side) // 2
    top = (h - side) // 2
    return img.crop((left, top, left + side, top + side))


def _strip_exif(img: Image.Image) -> Image.Image:
    """Return image without EXIF metadata."""
    data = list(img.getdata())
    clean = Image.new(img.mode, img.size)
    clean.putdata(data)
    return clean


def _content_hash(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()[:16]


def _upload_to_s3(
    s3_client: Any,
    bucket: str,
    key: str,
    data: bytes,
    content_type: str,
) -> str:
    s3_client.put_object(
        Bucket=bucket,
        Key=key,
        Body=data,
        ContentType=content_type,
        CacheControl="public, max-age=2592000, immutable",
    )
    endpoint = os.environ.get("S3_ENDPOINT_URL", "https://s3.amazonaws.com")
    return f"{endpoint}/{bucket}/{key}"


def process_headshot(
    player_id: str,
    image_bytes: bytes,
    source: str,
    license_str: str,
    s3_client: Any,
    bucket: str,
) -> HeadshotRecord:
    """Process one headshot: normalize, resize, upload, return record."""
    img = Image.open(io.BytesIO(image_bytes)).convert("RGB")
    img = _center_crop_square(img)
    img = _strip_exif(img)

    # Compute blurhash at small size for speed
    thumb = img.resize((32, 32))
    bh = blurhash.encode(list(thumb.getdata()), thumb.width, thumb.height)

    fetched_at = datetime.now(UTC).isoformat()
    sizes: dict[str, dict[str, str]] = {}

    for size in _SIZES:
        resized = img.resize((size, size), Image.LANCZOS)
        asset_set: dict[str, str] = {}
        for fmt in _FORMATS:
            buf = io.BytesIO()
            pil_fmt = _PIL_FORMAT[fmt]
            save_kwargs: dict[str, Any] = {"format": pil_fmt}
            if fmt == "webp":
                save_kwargs["quality"] = 85
            elif fmt == "jpeg":
                save_kwargs["quality"] = 85
                save_kwargs["optimize"] = True
            resized.save(buf, **save_kwargs)
            data = buf.getvalue()
            h = _content_hash(data)
            key = f"headshots/{player_id}/{size}_{h}.{fmt}"
            content_type = f"image/{'jpeg' if fmt == 'jpeg' else fmt}"
            url = _upload_to_s3(s3_client, bucket, key, data, content_type)
            asset_set[fmt] = url
        sizes[str(size)] = asset_set

    return HeadshotRecord(
        player_id=player_id,
        sizes=sizes,
        blurhash=bh,
        source=source,
        license=license_str,
        fetched_at=fetched_at,
        is_fallback=False,
    )


def generate_initials_avatar(player_name: str, team_color: str = "#1e3a5f") -> str:
    """
    Generate a deterministic SVG initials avatar.
    Returns SVG string (not uploaded — served inline or as data URI).
    """
    parts = player_name.strip().split()
    initials = ""
    if parts:
        initials += parts[0][0].upper()
    if len(parts) > 1:
        initials += parts[-1][0].upper()

    return f"""<svg xmlns="http://www.w3.org/2000/svg" width="256" height="256" viewBox="0 0 256 256">
  <rect width="256" height="256" fill="{team_color}"/>
  <text x="128" y="170" font-family="Arial,sans-serif" font-size="96"
        font-weight="bold" fill="white" text-anchor="middle">{initials}</text>
</svg>"""


def build_fallback_record(player_id: str, player_name: str) -> HeadshotRecord:
    """Build a metadata record for a player with no real headshot."""
    avatar_svg = generate_initials_avatar(player_name)
    placeholder = f"data:image/svg+xml;base64,{__import__('base64').b64encode(avatar_svg.encode()).decode()}"
    return HeadshotRecord(
        player_id=player_id,
        sizes={
            "64":  {"webp": placeholder, "jpeg": placeholder},
            "256": {"webp": placeholder, "jpeg": placeholder},
            "512": {"webp": placeholder, "jpeg": placeholder},
        },
        blurhash="L6PZfSi_.AyE_3t7t7R**0o#DgR4",  # generic blurhash
        source="generated",
        license="generated",
        fetched_at=datetime.now(UTC).isoformat(),
        is_fallback=True,
    )


def emit_ingestion_report(
    records: list[HeadshotRecord],
    output_path: Path,
) -> None:
    report = [r.to_dict() for r in records]
    output_path.write_text(json.dumps(report, indent=2, ensure_ascii=False))
    fallback_count = sum(1 for r in records if r.is_fallback)
    total = len(records)
    logger.info(
        "Headshot report: %d/%d players have real headshots; %d fallbacks",
        total - fallback_count, total, fallback_count,
    )
