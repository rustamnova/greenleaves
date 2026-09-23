from __future__ import annotations

import csv
import json
import math
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable

import ezdxf
import numpy as np
import yaml
from ezdxf import bbox


@dataclass
class SourceFeature:
    category: str
    layer: str
    source_file: str
    points: list[tuple[float, float]]


@dataclass
class Placement:
    id: str
    kind: str
    species: str
    x: float
    y: float
    score: float
    nearest_constraints: dict[str, float]
    reasons: list[str]
    norms: list[str]
    confidence: str


def load_config(path: Path) -> dict:
    return yaml.safe_load(path.read_text(encoding="utf-8"))


def detect_units_per_meter(doc, configured) -> float:
    if configured != "auto":
        return float(configured)
    # DXF INSUNITS: 4 millimetres, 5 centimetres, 6 metres.
    return {4: 1000.0, 5: 100.0, 6: 1.0}.get(int(doc.units or 0), 1.0)


def classify_layer(layer: str, cfg: dict) -> str:
    normalized = layer.casefold()
    for category, spec in cfg["categories"].items():
        if any(re.search(p, normalized, flags=re.IGNORECASE) for p in spec["patterns"]):
            return category
    return "unknown"


def entity_points(entity, arc_segments: int = 24) -> list[tuple[float, float]]:
    kind = entity.dxftype()
    try:
        if kind == "LINE":
            return [(float(entity.dxf.start.x), float(entity.dxf.start.y)), (float(entity.dxf.end.x), float(entity.dxf.end.y))]
        if kind == "LWPOLYLINE":
            return [(float(x), float(y)) for x, y, *_ in entity.get_points("xy")]
        if kind == "POLYLINE":
            return [(float(v.dxf.location.x), float(v.dxf.location.y)) for v in entity.vertices]
        if kind in {"CIRCLE", "ARC"}:
            c = entity.dxf.center
            r = float(entity.dxf.radius)
            start = 0.0 if kind == "CIRCLE" else math.radians(float(entity.dxf.start_angle))
            end = 2 * math.pi if kind == "CIRCLE" else math.radians(float(entity.dxf.end_angle))
            if end <= start:
                end += 2 * math.pi
            return [(float(c.x + r * math.cos(t)), float(c.y + r * math.sin(t))) for t in np.linspace(start, end, arc_segments)]
        if kind in {"POINT", "TEXT", "MTEXT", "INSERT"}:
            p = entity.dxf.insert if hasattr(entity.dxf, "insert") else entity.dxf.location
            return [(float(p.x), float(p.y))]
    except (AttributeError, TypeError, ValueError):
        return []
    return []


def sample_polyline(points: list[tuple[float, float]], step: float) -> np.ndarray:
    if not points:
        return np.empty((0, 2), dtype=float)
    if len(points) == 1:
        return np.asarray(points, dtype=float)
    out: list[tuple[float, float]] = []
    for a, b in zip(points, points[1:]):
        length = math.dist(a, b)
        count = max(2, min(10000, int(math.ceil(length / max(step, 1e-9))) + 1))
        for t in np.linspace(0.0, 1.0, count, endpoint=False):
            out.append((a[0] + (b[0] - a[0]) * float(t), a[1] + (b[1] - a[1]) * float(t)))
    out.append(points[-1])
    return np.asarray(out, dtype=float)


def point_in_polygon(x: float, y: float, polygon: list[tuple[float, float]]) -> bool:
    inside = False
    j = len(polygon) - 1
    for i in range(len(polygon)):
        xi, yi = polygon[i]
        xj, yj = polygon[j]
        if ((yi > y) != (yj > y)) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def min_distance(point: np.ndarray, samples: np.ndarray) -> float:
    if samples.size == 0:
        return float("inf")
    # Chunked NumPy keeps memory bounded and is adequate for the MVP.
    best = float("inf")
    for start in range(0, len(samples), 50000):
        delta = samples[start : start + 50000] - point
        best = min(best, float(np.sqrt(np.min(np.sum(delta * delta, axis=1)))))
    return best


def read_sources(inputs: list[Path], cfg: dict):
    docs = []
    features: list[SourceFeature] = []
    unknown_layers: set[str] = set()
    boundary_polygons: list[list[tuple[float, float]]] = []
    for path in inputs:
        doc = ezdxf.readfile(path)
        docs.append((path, doc))
        for entity in doc.modelspace():
            layer = str(entity.dxf.layer)
            points = entity_points(entity)
            if not points:
                continue
            low = layer.casefold()
            if any(re.search(p, low, flags=re.IGNORECASE) for p in cfg.get("ignored_layer_patterns", [])):
                continue
            is_boundary = len(points) >= 3 and any(
                re.search(p, low, flags=re.IGNORECASE) for p in cfg["boundary_layer_patterns"]
            )
            category = "boundary" if is_boundary else classify_layer(layer, cfg)
            if category == "unknown":
                unknown_layers.add(layer)
            features.append(SourceFeature(category, layer, path.name, points))
            if is_boundary:
                boundary_polygons.append(points)
    return docs, features, unknown_layers, boundary_polygons


def generate_placements(inputs: list[Path], output_dxf: Path, output_json: Path, output_csv: Path, cfg: dict) -> dict:
    docs, features, unknown_layers, boundaries = read_sources(inputs, cfg)
    if not docs:
        raise ValueError("No DXF inputs")
    units_per_meter = detect_units_per_meter(docs[0][1], cfg["units_per_meter"])
    sample_step = float(cfg["sample_step_m"]) * units_per_meter
    category_samples: dict[str, np.ndarray] = {}
    for category in cfg["categories"]:
        chunks = [sample_polyline(f.points, sample_step) for f in features if f.category == category]
        category_samples[category] = np.vstack([c for c in chunks if c.size]) if any(c.size for c in chunks) else np.empty((0, 2))

    all_points = np.vstack([np.asarray(f.points) for f in features if f.points])
    minx, miny = np.min(all_points, axis=0)
    maxx, maxy = np.max(all_points, axis=0)
    grid_step = float(cfg["grid_step_m"]) * units_per_meter
    nx = max(1, int((maxx - minx) / grid_step) + 1)
    ny = max(1, int((maxy - miny) / grid_step) + 1)
    if nx * ny > int(cfg["max_candidates"]):
        grid_step *= math.sqrt(nx * ny / int(cfg["max_candidates"]))
    candidates = ((x, y) for y in np.arange(miny, maxy + grid_step, grid_step) for x in np.arange(minx, maxx + grid_step, grid_step))

    placements: list[Placement] = []
    for x, y in candidates:
        if boundaries and not any(point_in_polygon(float(x), float(y), p) for p in boundaries):
            continue
        point = np.array([x, y], dtype=float)
        distances = {cat: min_distance(point, samples) / units_per_meter for cat, samples in category_samples.items()}
        kind = "tree"
        if any(distances[cat] < float(spec["tree_buffer_m"]) for cat, spec in cfg["categories"].items() if spec["tree_buffer_m"] is not None):
            kind = "shrub"
            if any(distances[cat] < float(spec["shrub_buffer_m"]) for cat, spec in cfg["categories"].items() if spec["shrub_buffer_m"] is not None):
                continue
        spacing = 6.0 if kind == "tree" else 2.0
        if any(math.dist((x, y), (p.x, p.y)) < spacing * units_per_meter for p in placements if p.kind == kind):
            continue

        road_near = distances.get("road", float("inf")) < 12.0
        water_near = distances.get("water", float("inf")) < 10.0
        key = "wet_tree" if kind == "tree" and water_near else ("street_tree" if kind == "tree" and road_near else "yard_tree")
        if kind == "shrub":
            key = "street_shrub" if road_near else "yard_shrub"
        species = cfg["species"][key]
        relevant = sorted((d, cat) for cat, d in distances.items() if math.isfinite(d))[:3]
        norms = [cfg["categories"][cat]["norm"] for _, cat in relevant]
        reasons = list(species["reasons"])
        reasons.append("точка проходит настроенные минимальные отступы")
        if road_near:
            reasons.append("размещение учитывает функцию уличного озеленения")
        score = min(100.0, 50.0 + min((d for d, _ in relevant), default=10.0) * 5.0)
        placements.append(Placement(
            id=f"P{len(placements)+1:05d}", kind=kind, species=species["name"], x=float(x), y=float(y),
            score=round(score, 2), nearest_constraints={cat: round(d, 3) for d, cat in relevant},
            reasons=reasons, norms=list(dict.fromkeys(norms)),
            confidence="low" if not boundaries else ("medium" if unknown_layers else "high"),
        ))
        if len(placements) >= int(cfg["max_placements"]):
            break

    base = docs[0][1]
    for name, color in [("GREEN_AI_TREES", 3), ("GREEN_AI_SHRUBS", 94), ("GREEN_AI_LABELS", 7), ("GREEN_AI_EXCLUSIONS", 1)]:
        if name not in base.layers:
            base.layers.add(name, color=color)
    msp = base.modelspace()
    for p in placements:
        layer = "GREEN_AI_TREES" if p.kind == "tree" else "GREEN_AI_SHRUBS"
        radius = (1.5 if p.kind == "tree" else 0.6) * units_per_meter
        msp.add_circle((p.x, p.y), radius=radius, dxfattribs={"layer": layer})
        msp.add_text(p.id, height=0.5 * units_per_meter, dxfattribs={"layer": "GREEN_AI_LABELS"}).set_placement((p.x + radius, p.y))
    output_dxf.parent.mkdir(parents=True, exist_ok=True)
    base.saveas(output_dxf)
    payload = {
        "status": "ok",
        "input_files": [p.name for p in inputs],
        "output_dxf": output_dxf.name,
        "units_per_meter": units_per_meter,
        "source_features": len(features),
        "placements_total": len(placements),
        "trees": sum(p.kind == "tree" for p in placements),
        "shrubs": sum(p.kind == "shrub" for p in placements),
        "unknown_layers": sorted(unknown_layers),
        "boundary_detected": bool(boundaries),
        "limitations": [
            "Классификация слоёв основана на настраиваемых шаблонах имён и требует проверки на реальных легендах.",
            "Ссылки на точные пункты НПА должны быть юридически верифицированы до финальной сдачи.",
            "MVP не выполняет DWG→DXF конвертацию; на вход ожидается DXF согласно Q&A заказчика.",
            *([] if boundaries else ["Граница проектного участка не найдена: точки являются предварительными и требуют проверки в составе основного DXF."]),
        ],
        "placements": [asdict(p) for p in placements],
    }
    output_json.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    with output_csv.open("w", encoding="utf-8-sig", newline="") as f:
        fields = ["id", "kind", "species", "x", "y", "score", "confidence", "nearest_constraints", "reasons", "norms"]
        writer = csv.DictWriter(f, fieldnames=fields)
        writer.writeheader()
        for p in placements:
            row = asdict(p)
            row["nearest_constraints"] = json.dumps(row["nearest_constraints"], ensure_ascii=False)
            row["reasons"] = " | ".join(row["reasons"])
            row["norms"] = " | ".join(row["norms"])
            writer.writerow(row)
    return payload
