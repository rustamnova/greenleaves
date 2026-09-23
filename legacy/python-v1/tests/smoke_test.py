from __future__ import annotations

import json
import os
import subprocess
import sys
from pathlib import Path

import ezdxf


ROOT = Path(__file__).resolve().parents[1]


def main() -> None:
    subprocess.run([sys.executable, str(ROOT / "tests" / "make_synthetic.py")], check=True)
    env = dict(os.environ)
    env["PYTHONPATH"] = str(ROOT / "src")
    subprocess.run(
        [sys.executable, "-m", "green_ai.cli", str(ROOT / "tests/data/synthetic_site.dxf"),
         "--config", str(ROOT / "config/default.yml"), "--output-dir", str(ROOT / "output_synthetic")],
        check=True, env=env,
    )
    report = json.loads((ROOT / "output_synthetic/planting_explanations.json").read_text(encoding="utf-8"))
    assert report["status"] == "ok" and report["placements_total"] > 0
    doc = ezdxf.readfile(ROOT / "output_synthetic/planting_proposal.dxf")
    for layer in ("GREEN_AI_TREES", "GREEN_AI_SHRUBS", "GREEN_AI_LABELS", "GREEN_AI_EXCLUSIONS"):
        assert layer in doc.layers
    print(f"SMOKE OK: {report['placements_total']} placements")


if __name__ == "__main__":
    main()
