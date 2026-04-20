#!/usr/bin/env python3
"""
Generates Pydantic v2 models from all JSON Schemas in src/.
Run via: uv run python packages/schemas/scripts/generate_pydantic.py
"""

from __future__ import annotations

import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).parent.parent
SRC_DIR = ROOT / "src"
OUT_DIR = ROOT / "py"
OUT_DIR.mkdir(exist_ok=True)

BANNER = """\
# AUTO-GENERATED — do not edit manually.
# Run `make schemas` to regenerate.

"""


def generate_model(schema_file: Path) -> None:
    name = schema_file.stem.replace(".schema", "")
    out_file = OUT_DIR / f"{name}.py"
    result = subprocess.run(
        [
            "datamodel-codegen",
            "--input", str(schema_file),
            "--input-file-type", "jsonschema",
            "--output", str(out_file),
            "--output-model-type", "pydantic_v2.BaseModel",
            "--use-annotated",
            "--field-constraints",
            "--strict-nullable",
            "--target-python-version", "3.11",
            "--use-double-quotes",
        ],
        capture_output=True,
        text=True,
    )
    if result.returncode != 0:
        print(f"ERROR generating {name}: {result.stderr}", file=sys.stderr)
        sys.exit(1)
    # Prepend banner
    content = out_file.read_text()
    out_file.write_text(BANNER + content)
    print(f"Generated {out_file}")


def write_init() -> None:
    schema_files = sorted(SRC_DIR.glob("*.schema.json"))
    lines = [BANNER]
    for f in schema_files:
        name = f.stem.replace(".schema", "")
        lines.append(f"from .{name} import *  # noqa: F401, F403")
    (OUT_DIR / "__init__.py").write_text("\n".join(lines) + "\n")
    print(f"Generated {OUT_DIR}/__init__.py")


if __name__ == "__main__":
    schema_files = sorted(SRC_DIR.glob("*.schema.json"))
    for sf in schema_files:
        generate_model(sf)
    write_init()
    print(f"\nAll {len(schema_files)} Pydantic models generated.")
