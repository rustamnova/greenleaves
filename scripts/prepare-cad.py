"""Prepare a conservative 2D analysis DXF from an explicitly mapped CAD set.

Input DXFs and DWGs remain untouched. Requires ezdxf and shapely. Configuration
names an actual boundary entity, source DXFs, layer rules and resolved XREFs.
Unmapped layers become obstacles; unsupported geometry aborts the preparation.
"""
import argparse
import collections
import hashlib
import json
import math
import re
from pathlib import Path

import ezdxf
from ezdxf import path as dxfpath
from ezdxf.math import Vec3
from ezdxf.acis import api as acis
from shapely.geometry import Polygon, LineString, Point, box

ANNOTATIONS = {'TEXT', 'MTEXT', 'ATTRIB', 'ATTDEF', 'DIMENSION', 'LEADER', 'MULTILEADER'}
ROLES = {'boundary', 'building', 'utility', 'road', 'existing', 'water', 'obstacle', 'unknown', 'ignored'}

def region_paths(entity):
    """Only complete, planar ACIS faces bounded by straight edges are supported."""
    paths = []
    bodies = acis.load_dxf(entity)
    if not bodies: raise ValueError('REGION has no readable ACIS bodies')
    for body in bodies:
        seen, pending, items = set(), [body], []
        while pending:
            item=pending.pop()
            if id(item) in seen: continue
            seen.add(id(item)); items.append(item); pending.extend(item.entities())
        for item in items:
            if item.type.endswith('-surface') and item.type != 'plane-surface':
                raise ValueError(f'Unsupported ACIS surface: {item.type}')
            if item.type.endswith('-curve') and item.type != 'straight-curve':
                raise ValueError(f'Unsupported ACIS curve: {item.type}')
        meshes = acis.mesh_from_body(body)
        face_count = sum(item.type == 'face' for item in items)
        if sum(len(mesh.faces) for mesh in meshes) != face_count or not face_count:
            raise ValueError('Incomplete ACIS face extraction')
        for mesh in meshes:
            paths.extend(([mesh.vertices[i] for i in face], True) for face in mesh.faces)
    return paths

def load_config(filename):
    config = json.loads(Path(filename).read_text(encoding='utf-8-sig'))
    for rule in config.get('layer_rules', []):
        if rule['role'] not in ROLES: raise ValueError('Invalid layer role')
        if rule['role'] == 'ignored' and not rule.get('reason'): raise ValueError('Ignored layers need a reason')
    return config

def build(config, output):
    output = Path(output)
    output.mkdir(parents=True, exist_ok=True)
    if (output/'analysis-input.dxf').exists():
        raise ValueError('Use a new output directory: an analysis DXF already exists')
    cache, manifest = {}, []
    tolerance = float(config.get('tolerance_m', 0.03))
    if not 0 < tolerance <= 0.25: raise ValueError('Tolerance must be within (0, 0.25] metres')
    def load(filename):
        key = str(Path(filename).resolve())
        if key not in cache:
            raw = Path(key).read_bytes()
            # LibreDWG Windows emits CRCRLF; normalise line endings only in memory.
            import io
            text = raw.replace(b'\r\r\n', b'\r\n').decode('utf-8-sig', errors='surrogateescape')
            cache[key] = ezdxf.read(io.StringIO(text, newline=None))
            if cache[key].units != 6: raise ValueError(f'Metre units required: {key}')
            manifest.append({'file': key, 'sha256': hashlib.sha256(raw).hexdigest(), 'bytes': len(raw), 'undecodable_bytes': sum(0xDC80 <= ord(c) <= 0xDCFF for c in text)})
        return cache[key]
    boundary_doc = load(config['boundary']['file'])
    boundary_entity = boundary_doc.entitydb[config['boundary']['handle']]
    boundary_path = dxfpath.make_path(boundary_entity)
    if not boundary_path.is_closed: raise ValueError('Boundary must be closed')
    boundary_points = [(v.x, v.y) for v in boundary_path.flattening(tolerance)]
    boundary_polygon = Polygon(boundary_points)
    if not boundary_polygon.is_valid or boundary_polygon.area <= 0: raise ValueError('Invalid project boundary')
    # An optional intersection selects a labelled pilot area; never invent a project boundary.
    if 'pilot_window' in config:
        boundary_polygon = boundary_polygon.intersection(box(*config['pilot_window']))
        if boundary_polygon.geom_type != 'Polygon' or not boundary_polygon.is_valid:
            raise ValueError('Pilot window must select one connected polygon')
        boundary_points = list(boundary_polygon.exterior.coords)
    if boundary_polygon.interiors: raise ValueError('Boundary holes require explicit treatment')
    xmin,ymin,xmax,ymax = boundary_polygon.bounds
    envelope = box(xmin-10, ymin-10, xmax+10, ymax+10)
    features, failures, ignored, conservative = [], [], collections.Counter(), []
    layer_stats = collections.defaultdict(collections.Counter)
    def role_for(layer):
        for rule in config.get('layer_rules', []):
            if re.search(rule['pattern'], layer, re.I): return rule['role']
        return 'unknown'
    def visit(entity, source, inherited='0', matrix=None, chain=(), depth=0):
        if depth > 32: raise ValueError('Block recursion limit')
        kind = entity.dxftype()
        layer = entity.dxf.get('layer', '0')
        if layer == '0': layer = inherited
        role = role_for(layer)
        provenance = {'source':source,'handle':entity.dxf.get('handle'), 'layer':layer, 'type':kind, 'blocks':list(chain)}
        if kind in ANNOTATIONS or role in {'ignored', 'boundary'}:
            ignored[f'{layer} / {kind}'] += 1
            return
        if kind == 'INSERT':
            if entity.mcount > 1:
                for instance in entity.multi_insert(): visit(instance, source, inherited, matrix, chain, depth+1)
                return
            block = entity.block()
            if block is None:
                failures.append(provenance | {'reason':'missing block'}); return
            transform = entity.matrix44()
            combined = transform if matrix is None else transform @ matrix
            if block.block.dxf.flags & 12:
                resolved = config.get('xrefs', {}).get(entity.dxf.name)
                if not resolved:
                    failures.append(provenance | {'reason':'unresolved XREF','name':entity.dxf.name}); return
                children = load(resolved).modelspace()
                source = str(Path(resolved).resolve())
            else: children = block
            for child in children: visit(child, source, layer, combined, chain+(entity.dxf.name,), depth+1)
            return
        layer_stats[layer][kind] += 1
        try:
            # Frobenius norm bounds stretch, including nested nonuniform INSERTs.
            stretch = math.sqrt(sum(matrix.transform_direction(Vec3(v)).magnitude_square for v in [(1,0,0),(0,1,0),(0,0,1)])) if matrix is not None else 1
            local_tolerance = tolerance / max(1, stretch)
            if kind == 'POINT':
                points = [entity.dxf.location]
                paths = [(points, False)]
            elif kind in {'HATCH','MPOLYGON'}:
                paths = [(list(p.flattening(local_tolerance)), True) for p in dxfpath.from_hatch(entity)]
            elif kind == 'REGION':
                paths = region_paths(entity)
            elif kind in {'LINE','LWPOLYLINE','POLYLINE','ARC','CIRCLE','ELLIPSE','SPLINE','SOLID','TRACE','3DFACE'}:
                p = dxfpath.make_path(entity, segments=32)
                paths = [(list(part.flattening(local_tolerance)), part.is_closed) for part in p.sub_paths()] if p.has_sub_paths else [(list(p.flattening(local_tolerance)), p.is_closed)]
            else: raise ValueError('unsupported entity type')
            if not paths: raise ValueError('empty geometry')
            for vertices, closed in paths:
                if matrix is not None: vertices = list(matrix.transform_vertices(vertices))
                points = [(v.x, v.y) for v in vertices]
                if not points or any(not math.isfinite(x) or not math.isfinite(y) for x,y in points): raise ValueError('invalid coordinate')
                if len(points)>1 and points[0]==points[-1]: points.pop(); closed=True
                if not points: raise ValueError('empty geometry')
                shape = Polygon(points) if closed and len(points)>2 else LineString(points) if len(points)>1 else Point(points[0])
                if not shape.intersects(envelope): continue
                # A convex envelope can only remove possible planting space, never add it.
                if closed and not shape.is_valid:
                    shape = shape.convex_hull
                    if shape.geom_type != 'Polygon': raise ValueError('degenerate closed ring')
                    points = list(shape.exterior.coords)[:-1]
                    conservative.append(provenance | {'reason':'invalid ring replaced by conservative convex exclusion'})
                features.append({'role':role,'points':points,'closed':closed, 'source':provenance})
        except Exception as error:
            failures.append(provenance | {'reason':str(error)})
            if kind == 'REGION' and len(failures)<5:
                data=entity.acis_data
                (output/f'region-{entity.dxf.handle}.acis').write_bytes(data if isinstance(data,bytes) else '\n'.join(data).encode('utf-8',errors='backslashreplace'))
    for filename in config['sources']:
        print(f'Reading {Path(filename).name}', flush=True)
        document = load(filename)
        for entity in document.modelspace(): visit(entity, str(Path(filename).resolve()))
    audit = {'schema':1,'tolerance_m':tolerance,'source_files':manifest,'boundary':config['boundary'], 'pilot_window':config.get('pilot_window'),'area_m2':boundary_polygon.area,'bounds':list(boundary_polygon.bounds),'features':len(features),'roles':dict(collections.Counter(f['role'] for f in features)), 'layers':dict(layer_stats),'ignored_annotations_or_explicit_layers':dict(ignored),'conservative_exclusions':conservative,'failures':failures,'status':'blocked' if failures else 'prepared_engineering_input'}
    (output/'preparation-audit.json').write_text(json.dumps(audit,ensure_ascii=True,indent=2),encoding='utf-8')
    (output/'diagnostic-geometry.json').write_text(json.dumps({'status':audit['status'],'boundary':boundary_points,'features':features},ensure_ascii=True),encoding='utf-8')
    if failures: raise ValueError(f'{len(failures)} unresolved geometries. See preparation-audit.json')
    drawing = ezdxf.new('R2010'); drawing.units=6
    drawing.layers.add('GREENLEAVES_BOUNDARY')
    drawing.modelspace().add_lwpolyline(boundary_points,close=True,dxfattribs={'layer':'GREENLEAVES_BOUNDARY'})
    roles={'GREENLEAVES_BOUNDARY':'boundary'}
    for i,feature in enumerate(features):
        layer='GREENLEAVES_INPUT_'+feature['role'].upper()
        if layer not in drawing.layers: drawing.layers.add(layer)
        roles[layer]=feature['role']
        attrs={'layer':layer}
        if len(feature['points'])==1: drawing.modelspace().add_point(feature['points'][0],dxfattribs=attrs)
        else: drawing.modelspace().add_lwpolyline(feature['points'],close=feature['closed'],dxfattribs=attrs)
    drawing.saveas(output/'analysis-input.dxf')
    target=output/'analysis-input.dxf'
    target.write_bytes(('999\nGREENLEAVES_PREPARATION '+json.dumps({'geometryTolerance':tolerance})+'\n').encode('utf-8')+target.read_bytes())
    (output/'geometry-provenance.json').write_text(json.dumps(features,ensure_ascii=False),encoding='utf-8')
    (output/'config.json').write_text(json.dumps({'boundaryLayer':'GREENLEAVES_BOUNDARY','roles':roles,'geometryTolerance':tolerance,'step':config.get('step',4),'max':config.get('max',1000),'variant':'balanced'},ensure_ascii=False,indent=2),encoding='utf-8')
    print(json.dumps({'status':audit['status'],'features':len(features),'area_m2':audit['area_m2'],'output':str(output)},ensure_ascii=False),flush=True)
    return audit

if __name__ == '__main__':
    parser=argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--config',required=True)
    parser.add_argument('--output',required=True)
    args=parser.parse_args()
    build(load_config(args.config),args.output)
