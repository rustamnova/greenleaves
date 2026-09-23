from pathlib import Path

import ezdxf

out = Path(__file__).parent / "data" / "synthetic_site.dxf"
out.parent.mkdir(parents=True, exist_ok=True)
doc = ezdxf.new("R2010", setup=True)
doc.units = 6
for name, color in [("ГРАНИЦА_УЧАСТКА", 7), ("ВОДОПРОВОД", 5), ("ДОРОГА", 1), ("ЗДАНИЕ", 2), ("ВОДОЕМ", 4)]:
    doc.layers.add(name, color=color)
msp = doc.modelspace()
msp.add_lwpolyline([(0, 0), (80, 0), (80, 50), (0, 50), (0, 0)], dxfattribs={"layer": "ГРАНИЦА_УЧАСТКА"})
msp.add_line((5, 25), (75, 25), dxfattribs={"layer": "ВОДОПРОВОД"})
msp.add_line((0, 5), (80, 5), dxfattribs={"layer": "ДОРОГА"})
msp.add_lwpolyline([(55, 30), (75, 30), (75, 45), (55, 45), (55, 30)], dxfattribs={"layer": "ЗДАНИЕ"})
msp.add_circle((15, 40), 4, dxfattribs={"layer": "ВОДОЕМ"})
doc.saveas(out)
print(out)
