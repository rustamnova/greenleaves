"""Run with Python plus requirements-cad.txt; synthetic files only."""
import hashlib
import importlib.util
import json
from pathlib import Path
import tempfile
import subprocess
import unittest
import ezdxf
from ezdxf.acis import api as acis
from ezdxf.render import MeshBuilder

spec=importlib.util.spec_from_file_location('prepare_cad',Path(__file__).parents[1]/'scripts/prepare-cad.py')
cad=importlib.util.module_from_spec(spec);spec.loader.exec_module(cad)

class PreparationTests(unittest.TestCase):
    def setUp(self):
        root=Path(__file__).parents[1]/'.private/tests';root.mkdir(parents=True,exist_ok=True)
        self.temp=tempfile.TemporaryDirectory(dir=root);self.root=Path(self.temp.name)
        self.doc=ezdxf.new('R2010');self.doc.units=6
        self.boundary=self.doc.modelspace().add_lwpolyline([(0,0),(100,0),(100,100),(0,100)],close=True,dxfattribs={'layer':'BOUNDARY'})
    def tearDown(self):self.temp.cleanup()
    def run_build(self,extra=None):
        source=self.root/'source.dxf';self.doc.saveas(source)
        before=hashlib.sha256(source.read_bytes()).hexdigest()
        config={'boundary':{'file':str(source),'handle':self.boundary.dxf.handle},'sources':[str(source)],'layer_rules':[{'pattern':'BOUNDARY','role':'boundary'},{'pattern':'UTIL','role':'utility'}]}
        config.update(extra or {})
        result=cad.build(config,self.root/'result')
        self.assertEqual(hashlib.sha256(source.read_bytes()).hexdigest(),before)
        return result,json.loads((self.root/'result/geometry-provenance.json').read_text())
    def test_nested_transforms_layer_inheritance_and_source_preservation(self):
        inner=self.doc.blocks.new('INNER',base_point=(1,0));inner.add_line((1,0),(2,0),dxfattribs={'layer':'0'})
        outer=self.doc.blocks.new('OUTER');outer.add_blockref('INNER',(5,0),dxfattribs={'rotation':90,'xscale':2,'yscale':2})
        self.doc.modelspace().add_blockref('OUTER',(20,20),dxfattribs={'layer':'UTIL'})
        _,features=self.run_build();self.assertEqual(len(features),1)
        self.assertAlmostEqual(features[0]['points'][0][0],25)
        self.assertAlmostEqual(features[0]['points'][0][1],20)
        self.assertAlmostEqual(features[0]['points'][1][1],22)
        self.assertEqual(features[0]['role'],'utility')
        # Exercise the actual Python -> DXF -> shared JS CLI boundary.
        prepared=self.root/'result'
        run=subprocess.run(['node',str(Path(__file__).parents[1]/'scripts/cli.mjs'),
            '--input',str(prepared/'analysis-input.dxf'),'--config',str(prepared/'config.json'),
            '--output',str(self.root/'plan')],capture_output=True,text=True)
        self.assertEqual(run.returncode,0,run.stderr)
        report=json.loads((self.root/'plan/report.json').read_text(encoding='utf-8'))
        self.assertEqual(report['settings']['geometry_tolerance_m'],0.03)
        self.assertGreater(report['summary']['accepted'],0)
    def test_hatch_holes_are_conservatively_excluded(self):
        hatch=self.doc.modelspace().add_hatch();hatch.paths.add_polyline_path([(20,20),(40,20),(40,40),(20,40)],is_closed=True)
        hatch.paths.add_polyline_path([(25,25),(35,25),(35,35),(25,35)],is_closed=True,flags=0)
        _,features=self.run_build();self.assertEqual(len(features),2)
        self.assertTrue(all(f['closed'] and f['role']=='unknown' for f in features))
    def test_nonuniform_scaled_circle_is_flattened_in_world_coordinates(self):
        b=self.doc.blocks.new('C');b.add_circle((0,0),1)
        self.doc.modelspace().add_blockref('C',(50,50),dxfattribs={'xscale':5,'yscale':2,'rotation':0})
        _,features=self.run_build();p=features[0]['points']
        self.assertAlmostEqual(max(x for x,y in p),55,places=5)
        self.assertAlmostEqual(max(y for x,y in p),52,places=5)
    def test_empty_region_rejected(self):
        # ezdxf drops empty ACIS entities when saving; exercise the reader directly.
        region=self.doc.modelspace().add_region()
        with self.assertRaisesRegex(ValueError,'no readable ACIS'):cad.region_paths(region)
    def test_planar_region_with_complete_acis(self):
        mesh=MeshBuilder();mesh.add_face([(20,20,0),(30,20,0),(30,30,0),(20,30,0)])
        region=self.doc.modelspace().add_region();acis.export_dxf(region,[acis.body_from_mesh(mesh)])
        _,features=self.run_build();self.assertEqual(len(features),1)
        self.assertTrue(features[0]['closed'])
    def test_reference_resolution_and_unresolved_blocks_export(self):
        self.doc.add_xref_def('missing.dxf','X');self.doc.modelspace().add_blockref('X',(0,0))
        with self.assertRaisesRegex(ValueError,'unresolved'):self.run_build()
        self.assertFalse((self.root/'result/analysis-input.dxf').exists())
        audit=json.loads((self.root/'result/preparation-audit.json').read_text())
        self.assertEqual(audit['status'],'blocked')
        external=ezdxf.new('R2010');external.units=6
        external.modelspace().add_line((25,25),(35,25))
        source=self.root/'external.dxf';external.saveas(source)
        result,features=self.run_build({'xrefs':{'X':str(source)}})
        self.assertEqual(result['status'],'prepared_engineering_input')
        self.assertEqual(len(features),1)
        self.assertEqual(features[0]['points'][0],[25,25])
    def test_open_boundary_rejected(self):
        self.boundary.closed=False
        with self.assertRaisesRegex(ValueError,'Boundary'):self.run_build()

if __name__=='__main__':unittest.main()
