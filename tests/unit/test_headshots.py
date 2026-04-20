"""Unit tests for the headshot pipeline."""

from __future__ import annotations

from services.ingestion.src.headshots.worker import (
    build_fallback_record,
    generate_initials_avatar,
)


class TestInitialsAvatar:
    def test_two_word_name(self) -> None:
        svg = generate_initials_avatar("Virat Kohli")
        assert "VK" in svg

    def test_single_word_name(self) -> None:
        svg = generate_initials_avatar("Sachin")
        assert "S" in svg

    def test_team_color_in_svg(self) -> None:
        svg = generate_initials_avatar("Rohit Sharma", team_color="#FF0000")
        assert "#FF0000" in svg

    def test_valid_svg_structure(self) -> None:
        svg = generate_initials_avatar("MS Dhoni")
        assert "<svg" in svg
        assert "</svg>" in svg


class TestFallbackRecord:
    def test_is_fallback_flag(self) -> None:
        record = build_fallback_record("P_0001", "Test Player")
        assert record.is_fallback is True

    def test_all_sizes_present(self) -> None:
        record = build_fallback_record("P_0001", "Test Player")
        assert set(record.sizes.keys()) == {"64", "256", "512"}

    def test_player_id_set(self) -> None:
        record = build_fallback_record("P_0999", "Some Player")
        assert record.player_id == "P_0999"

    def test_blurhash_present(self) -> None:
        record = build_fallback_record("P_0001", "Test Player")
        assert len(record.blurhash) > 5
