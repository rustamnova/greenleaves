import json
from pathlib import Path

import ezdxf

from green_ai.pipeline import generate_placements, load_config


def test_synthetic(tmp_path: Path):
    root = Path(__file__).parents[1]
    result = generate_placements(
        [root / "tests/data/synthetic_site.dxf"],
        tmp_path / "out.dxf", tmp_path / "out.json", tmp_path / "out.csv",
        load_config(root / "config/default.yml"),
    )
    assert result["placements_total"] > 0
    doc = ezdxf.readfile(tmp_path / "out.dxf")
    assert "GREEN_AI_TREES" in doc.layers
    assert "GREEN_AI_SHRUBS" in doc.layers
    assert json.loads((tmp_path / "out.json").read_text(encoding="utf-8"))["placements_total"] > 0
