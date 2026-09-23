import test from 'node:test';
import assert from 'node:assert/strict';
import {demoDxf,parseDxf,prepare,generate,validatePoint,exportDxf,makeReport,pointInPolygon,distSegment} from '../site/studio/engine.js';
const model=()=>parseDxf(demoDxf(),'demo.dxf');
const ctx=()=>prepare(model());
const insert=(text,entity)=>text.replace('0\nENDSEC\n0\nEOF',entity+'0\nENDSEC\n0\nEOF');
test('filled building/road/water interiors are forbidden, even far from walls',()=>{
 const c=ctx();for(const p of [{x:23,y:40},{x:45,y:13},{x:100,y:55}])for(const kind of ['tree','shrub'])assert.equal(validatePoint(c,p,kind).ok,false);
});
test('closed building closing segment is included',()=>{assert.equal(validatePoint(ctx(),{x:10,y:40},'tree').ok,false);});
test('distance uses entire segment, not sampled vertices',()=>{assert.equal(distSegment({x:4.5,y:1},{x:0,y:0},{x:100,y:0}),1);});
test('unknown units require explicit confirmation',()=>{
 const m=parseDxf(demoDxf().replace('$INSUNITS\n70\n6','$INSUNITS\n70\n0'));
 assert.throws(()=>prepare(m),/единицы/);assert.equal(prepare(m,{scale:1000}).scale,1000);
});
test('open, missing and ambiguous boundaries are rejected',()=>{
 let m=model();m.features[0].closed=false;assert.throws(()=>prepare(m),/замкнутым/);
 m=model();m.features.shift();assert.throws(()=>prepare(m),/границей/);
 m=model();m.features.push(structuredClone(m.features[0]));assert.throws(()=>prepare(m),/неоднозначна/);
});
test('self-intersecting boundary rejected',()=>{
 const m=model();m.features[0].points=[{x:0,y:0},{x:100,y:70},{x:0,y:70},{x:90,y:0}];assert.throws(()=>prepare(m),/самопересечений/);
});
test('unknown geometry blocks computation unless layer is explicitly ignored',()=>{
 const m=parseDxf(insert(demoDxf(),'0\nINSERT\n8\nBLOCK_NETWORK\n2\nNET\n10\n50\n20\n50\n'));
 assert.throws(()=>prepare(m),/INSERT/);assert.doesNotThrow(()=>prepare(m,{roles:{BLOCK_NETWORK:'ignored'}}));
});
test('bulge and nonplanar OCS are not silently treated as straight geometry',()=>{
 const bulge=parseDxf(demoDxf().replace('90\n4\n70\n1','42\n1\n90\n4\n70\n1'));
 assert.throws(()=>prepare(bulge),/геометрия/);
 const ocs=parseDxf(demoDxf().replace('90\n4\n70\n1','210\n1\n90\n4\n70\n1'));
 assert.throws(()=>prepare(ocs),/геометрия/);
});
test('unknown layer is a conservative exclusion, role overrides are explicit',()=>{
 const m=parseDxf(insert(demoDxf(),'0\nPOINT\n8\nUNCLASSIFIED\n10\n46\n20\n40\n'));
 assert.equal(validatePoint(prepare(m),{x:47,y:40},'shrub').ok,false);
 assert.equal(validatePoint(prepare(m,{roles:{UNCLASSIFIED:'ignored'}}),{x:47,y:40},'shrub').ok,true);
});
test('mixed tree and shrub spacing is enforced',()=>{
 assert.equal(validatePoint(ctx(),{x:47,y:40},'shrub',[{x:44,y:40,kind:'tree',id:'A'}]).ok,false);
});
test('every generated point is independently revalidated against the whole result',()=>{
 const c=ctx(),r=generate(c,{max:1000});assert.ok(r.accepted.some(p=>p.kind==='tree'));assert.ok(r.accepted.some(p=>p.kind==='shrub'));
 for(const p of r.accepted)assert.equal(validatePoint(c,p,p.kind,r.accepted,p.id).ok,true,p.id);
 for(const p of r.accepted)assert.equal(pointInPolygon(p,c.boundary.points),true);
});
test('scenarios differ, are deterministic, and obey the cap',()=>{
 const c=ctx(),a=generate(c,{variant:'shade',max:1000}),b=generate(c,{variant:'light',max:1000});
 assert.ok(a.accepted.filter(p=>p.kind==='tree').length>b.accepted.filter(p=>p.kind==='tree').length);
 assert.deepEqual(a,generate(c,{variant:'shade',max:1000}));
 assert.equal(generate(c,{max:10}).accepted.length,10);assert.equal(generate(c,{max:10}).capped,true);
});
test('millimetre drawing uses equivalent metric constraints',()=>{
 const m=model();m.unitScale=1000;for(const f of m.features){f.points.forEach(p=>{p.x*=1000;p.y*=1000;});if(f.center){f.center.x*=1000;f.center.y*=1000;f.radius*=1000;}}
 assert.deepEqual(generate(prepare(m)).accepted.map(p=>[p.kind,p.x/1000,p.y/1000]),generate(ctx()).accepted.map(p=>[p.kind,p.x,p.y]));
});
test('invalid parameters, malformed files, and excessive workloads fail explicitly',()=>{
 for(const settings of [{step:0},{step:NaN},{max:1.5},{max:Infinity}])assert.throws(()=>generate(ctx(),settings));
 assert.throws(()=>parseDxf('not a dxf'),/строк|код/);assert.throws(()=>parseDxf(demoDxf().replace('EOF','')));
 const c=ctx();c.boundary.points.forEach(p=>{p.x*=10000;p.y*=10000;});assert.throws(()=>generate(c),/Слишком плотный/);
});
test('export preserves source entities and adds named layers with correct counts',()=>{
 const c=ctx(),r=generate(c),text=exportDxf(c,r),back=parseDxf(text);
 assert.equal(back.features.length,c.model.features.length+r.accepted.length);
 assert.equal(back.features.filter(f=>f.layer==='ЗДАНИЕ').length,1);
 assert.equal(back.features.filter(f=>f.layer==='GREENLEAVES_TREES').length,r.accepted.filter(p=>p.kind==='tree').length);
 assert.match(text,/LAYER\r\n5\r\n[0-9A-F]+\r\n100\r\nAcDbSymbolTable\r\n70\r\n3/);
});
test('export rejects manually injected invalid placements',()=>{
 const c=ctx(),r=generate(c);r.accepted[0].x=20;r.accepted[0].y=40;assert.throws(()=>exportDxf(c,r),/GL-/);
});
test('report carries assumptions, roles, units and edits without certified claims',()=>{
 const c=ctx(),r=generate(c);const report=makeReport(c,r,[{action:'remove',id:'GL-0001'}]);
 assert.equal(report.status,'engineering_preview');assert.equal(report.units_per_meter,1);assert.equal(report.edits.length,1);assert.ok(report.limitations.length>=4);assert.equal(report.summary.accepted,r.accepted.length);
});
