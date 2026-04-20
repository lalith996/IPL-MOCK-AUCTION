"""
Cricsheet ETL pipeline entrypoint.

Usage:
    uv run python -m services.ingestion.src.cricsheet.pipeline

Environment variables:
    CRICSHEET_DATA_DIR   Path to directory containing Cricsheet JSON dirs (default: repo root)
    DATABASE_URL         Postgres DSN
    REDIS_URL            Redis DSN
"""

from __future__ import annotations

import asyncio
import csv
import json
import logging
import os
from pathlib import Path
from typing import Any

import asyncpg

from .metrics import build_feature_record
from .models import PlayerAccumulator
from .parser import MatchParser
from .resolver import PlayerResolver

logger = logging.getLogger(__name__)
logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

ROOT = Path(__file__).parents[6]  # repo root

# Cricsheet directories to process (in priority order)
_DATA_DIRS = [
    "ipl_json",
    "t20s_male_json",
    "it20s_male_json",
    "odis_male_json",
    "odms_male_json",
    "mdms_male_json",
    "tests_male_json",
]


def _load_roster(csv_path: Path) -> tuple[list[str], dict[str, str], dict[str, bool]]:
    """
    Returns:
        names: list of canonical names
        nationality_map: name -> nationality
        overseas_map: name -> is_overseas
    """
    names: list[str] = []
    nationality_map: dict[str, str] = {}
    overseas_map: dict[str, bool] = {}
    if not csv_path.exists():
        return names, nationality_map, overseas_map
    with csv_path.open(newline="", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for row in reader:
            name = row.get("Player", row.get("Name", "")).strip()
            if not name:
                continue
            names.append(name)
            nationality_map[name] = row.get("Nationality", row.get("Country", "India")).strip()
            overseas_map[name] = row.get("Type", "Indian").strip().lower() != "indian"
    return names, nationality_map, overseas_map


def _iter_match_files(data_root: Path) -> list[Path]:
    files: list[Path] = []
    for dir_name in _DATA_DIRS:
        d = data_root / dir_name
        if d.is_dir():
            files.extend(sorted(d.glob("*.json")))
    logger.info("Found %d total Cricsheet match files", len(files))
    return files


def _process_all_matches(
    match_files: list[Path],
    resolver: PlayerResolver,
) -> dict[str, PlayerAccumulator]:
    accumulators: dict[str, PlayerAccumulator] = {}
    parser = MatchParser(accumulators)

    for i, path in enumerate(match_files):
        try:
            match_data: dict[str, Any] = json.loads(path.read_text(encoding="utf-8"))
            parser.process(match_data, resolver)
        except (json.JSONDecodeError, KeyError) as exc:
            logger.warning("Skipping %s: %s", path.name, exc)
        if (i + 1) % 100 == 0:
            logger.info("Processed %d / %d match files", i + 1, len(match_files))

    logger.info("Built accumulators for %d players", len(accumulators))
    return accumulators


async def _upsert_features(
    conn: asyncpg.Connection,  # type: ignore[type-arg]
    records: list[dict[str, Any]],
) -> None:
    await conn.executemany(
        """
        INSERT INTO player_features (
            player_id, canonical_name, feature_version, role, role_subtype,
            nationality, is_overseas, data_coverage_score, base_price_tier,
            form_score, value_score, career_stats, form_5, form_10, form_20,
            phase_metrics, specialist_ratings, venue_splits
        ) VALUES (
            $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11,
            $12::jsonb, $13::jsonb, $14::jsonb, $15::jsonb,
            $16::jsonb, $17::jsonb, $18::jsonb
        )
        ON CONFLICT (player_id) DO UPDATE SET
            canonical_name      = EXCLUDED.canonical_name,
            feature_version     = EXCLUDED.feature_version,
            role                = EXCLUDED.role,
            role_subtype        = EXCLUDED.role_subtype,
            data_coverage_score = EXCLUDED.data_coverage_score,
            base_price_tier     = EXCLUDED.base_price_tier,
            form_score          = EXCLUDED.form_score,
            value_score         = EXCLUDED.value_score,
            career_stats        = EXCLUDED.career_stats,
            form_5              = EXCLUDED.form_5,
            form_10             = EXCLUDED.form_10,
            form_20             = EXCLUDED.form_20,
            phase_metrics       = EXCLUDED.phase_metrics,
            specialist_ratings  = EXCLUDED.specialist_ratings,
            venue_splits        = EXCLUDED.venue_splits,
            updated_at          = NOW()
        """,
        [
            (
                r["player_id"], r["canonical_name"], r["feature_version"],
                r["role"], r["role_subtype"], r["nationality"], r["is_overseas"],
                r["data_coverage_score"], r["base_price_tier"],
                r["form_score"], r["value_score"],
                json.dumps(r["career_stats"]), json.dumps(r["form_5"]),
                json.dumps(r["form_10"]), json.dumps(r["form_20"]),
                json.dumps(r["phase_metrics"]), json.dumps(r["specialist_ratings"]),
                json.dumps(r["venue_splits"]),
            )
            for r in records
        ],
    )


def _emit_missing_report(
    records: list[dict[str, Any]],
    output_path: Path,
) -> None:
    missing = [
        {
            "player_id": r["player_id"],
            "canonical_name": r["canonical_name"],
            "data_coverage_score": r["data_coverage_score"],
        }
        for r in records
        if r["data_coverage_score"] < 0.5
    ]
    output_path.write_text(json.dumps(missing, indent=2, ensure_ascii=False))
    logger.info(
        "Emitted missing_players_report.json: %d players with coverage < 0.5", len(missing)
    )


async def run_pipeline() -> None:
    data_root = Path(os.environ.get("CRICSHEET_DATA_DIR", str(ROOT)))
    database_url = os.environ.get("DATABASE_URL", "postgresql://postgres:postgres@localhost:5432/ipl_auction")

    # Load roster
    roster_csv = data_root / "IPL_2026_Full_AuctionList_Authoritative.csv"
    roster_names, nationality_map, overseas_map = _load_roster(roster_csv)
    logger.info("Loaded %d roster players", len(roster_names))

    # Override file (optional)
    override_file = data_root / "services" / "ingestion" / "src" / "seed" / "player_id_overrides.json"
    resolver = PlayerResolver(
        roster_names=roster_names,
        override_file=override_file if override_file.exists() else None,
    )

    # Process match files
    match_files = _iter_match_files(data_root)
    accumulators = _process_all_matches(match_files, resolver)

    # Build feature records
    records: list[dict[str, Any]] = []
    for player_id, acc in accumulators.items():
        resolved_name = acc.raw_name
        nationality = nationality_map.get(resolved_name, "Unknown")
        is_overseas = overseas_map.get(resolved_name, True)
        record = build_feature_record(acc, is_overseas=is_overseas, nationality=nationality)
        records.append(record)

    logger.info("Built %d feature records", len(records))

    # Write to Postgres
    conn = await asyncpg.connect(database_url)
    try:
        await _upsert_features(conn, records)
        logger.info("Upserted %d records to player_features", len(records))
    finally:
        await conn.close()

    # Emit missing players report
    report_path = data_root / "missing_players_report.json"
    _emit_missing_report(records, report_path)

    logger.info("ETL pipeline complete.")


if __name__ == "__main__":
    asyncio.run(run_pipeline())
