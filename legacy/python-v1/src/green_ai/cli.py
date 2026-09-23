from __future__ import annotations

import argparse
import json
from pathlib import Path

from .pipeline import generate_placements, load_config


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(prog="green-ai", description="Explainable local DXF planting generator")
    p.add_argument("inputs", nargs="+", type=Path, help="One or more input DXF files")
    p.add_argument("--config", type=Path, default=Path("config/default.yml"))
    p.add_argument("--output-dir", type=Path, default=Path("output"))
    return p


def main() -> None:
    args = parser().parse_args()
    cfg = load_config(args.config)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    result = generate_placements(
        args.inputs,
        args.output_dir / "planting_proposal.dxf",
        args.output_dir / "planting_explanations.json",
        args.output_dir / "planting_explanations.csv",
        cfg,
    )
    print(json.dumps({k: v for k, v in result.items() if k != "placements"}, ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
