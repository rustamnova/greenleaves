"""Independent CAD-parser check: python scripts/verify-dxf.py result.dxf report.json"""
import json
import sys
import ezdxf

doc = ezdxf.readfile(sys.argv[1])
audit = doc.audit()
with open(sys.argv[2], encoding="utf-8") as stream:
    report = json.load(stream)
expected = {p["id"]: p for p in report["placements"]}
circles = list(doc.modelspace().query('CIRCLE[layer=="GREENLEAVES_TREES"]'))
circles += list(doc.modelspace().query('CIRCLE[layer=="GREENLEAVES_SHRUBS"]'))
labels = list(doc.modelspace().query('TEXT[layer=="GREENLEAVES_LABELS"]'))
assert not audit.errors, audit.errors
assert not audit.fixes, [(e.code, e.message) for e in audit.fixes]
assert len(circles) == len(expected)
assert {e.dxf.text for e in labels} == set(expected)
assert {(round(e.dxf.center.x, 5), round(e.dxf.center.y, 5)) for e in circles} == {
    (round(p["x"], 5), round(p["y"], 5)) for p in expected.values()
}
print(json.dumps({"parser": "ezdxf", "version": ezdxf.__version__, "entities": len(doc.modelspace()), "placements": len(circles), "errors": len(audit.errors), "fixes": len(audit.fixes)}))
