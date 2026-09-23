// Greenleaves geometry engine. Engineering defaults, NOT certified legal rules.
export const VERSION = '0.2.0';
export const RULES = {
  boundary: {label:'Граница проекта', color:'#658572'},
  building: {label:'Здание / сооружение',tree:5,shrub:1.5,color:'#9ba5ab',solid:true},
  utility: {label:'Инженерная сеть',tree:2,shrub:1,color:'#de8460'},
  road: {label:'Дорога / покрытие',tree:2,shrub:1,color:'#b7b8ab',solid:true},
  existing: {label:'Существующие насаждения',tree:5,shrub:2,color:'#638b64',solid:true},
  water: {label:'Водный объект',tree:2,shrub:1,color:'#78a9bb',solid:true},
  obstacle: {label:'Наземное препятствие',tree:2,shrub:1,color:'#b79574',solid:true},
  unknown: {label:'Неизвестный слой',tree:5,shrub:5,color:'#bb7ca0',solid:true},
  ignored: {label:'Не учитывать (решение эксперта)',color:'#cfd8d0'},
};
export const RADIUS = {tree:3, shrub:1.25};
const patterns = {
  ignored:/подпис|текст|label|annotation/i,
  boundary:/границ.*(проект|участ)|граница$|boundary|project.boundary|контур.*проект/i,
  building:/здан|сооруж|building|wall|стен/i,
  water:/водоем|водоём|пруд|река|берег|waterbody|pond/i,
  utility:/канал|водоп|газ|кабел|элект|тепл|связ|дрен|ливн|utility|sewer|water.pipe/i,
  road:/дорог|проез|тротуар|road|curb|асфальт|борт.*кам/i,
  existing:/дерев|дендро|tree|существ.*озелен|GREENLEAVES_SHRUBS/i,
  obstacle:/знак|указател|щит|огражд|малые архитектур|маф|светофор|опор/i,
};
export function classify(layer) { return Object.keys(patterns).find(k=>patterns[k].test(layer)) || 'unknown'; }
export function distance(a,b) {return Math.hypot(a.x-b.x,a.y-b.y);}
export function distSegment(p,a,b) {
  const dx=b.x-a.x,dy=b.y-a.y,len=dx*dx+dy*dy;
  const t=len ? Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/len)):0;
  return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);
}
export function segments(f) {
  const out=f.points.slice(1).map((p,i)=>[f.points[i],p]);
  if(f.closed && distance(f.points[0],f.points.at(-1))>1e-8) out.push([f.points.at(-1),f.points[0]]);
  if(f.points.length===1) out.push([f.points[0],f.points[0]]);
  return out;
}
export function pointInPolygon(p,points) {
  let inside=false;
  for(let i=0,j=points.length-1;i<points.length;j=i++) {
    const a=points[i],b=points[j];
    if((a.y>p.y)!==(b.y>p.y) && p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x) inside=!inside;
  }
  return inside;
}
export function featureDistance(p,f,solid=false) {
  if(f.type==='CIRCLE') return Math.max(0,distance(p,f.center)-f.radius);
  if(solid && f.closed && pointInPolygon(p,f.points)) return 0;
  return segments(f).reduce((d,[a,b])=>Math.min(d,distSegment(p,a,b)),Infinity);
}
export function extent(features) {
  const box={minX:Infinity,minY:Infinity,maxX:-Infinity,maxY:-Infinity};
  for(const f of features) for(const p of f.points) {
    box.minX=Math.min(box.minX,p.x);box.minY=Math.min(box.minY,p.y);
    box.maxX=Math.max(box.maxX,p.x);box.maxY=Math.max(box.maxY,p.y);
  }
  return Number.isFinite(box.minX)?box:null;
}
export function area(points) {return Math.abs(points.reduce((s,a,i)=>{const b=points[(i+1)%points.length];return s+a.x*b.y-b.x*a.y;},0))/2;}
function simplePolygon(points) {
  const edges=segments({points,closed:true});
  const cross=(a,b,c)=>(b.x-a.x)*(c.y-a.y)-(b.y-a.y)*(c.x-a.x);
  const touches=(a,b,c,d)=>{
    const u=cross(a,b,c),v=cross(a,b,d),w=cross(c,d,a),z=cross(c,d,b);
    return (u*v<0 && w*z<0) || (Math.abs(u)<1e-8 && distSegment(c,a,b)<1e-8) || (Math.abs(v)<1e-8 && distSegment(d,a,b)<1e-8) || (Math.abs(w)<1e-8 && distSegment(a,c,d)<1e-8) || (Math.abs(z)<1e-8 && distSegment(b,c,d)<1e-8);
  };
  for(let i=0;i<edges.length;i++) for(let j=i+2;j<edges.length;j++) {
    if(i===0 && j===edges.length-1) continue;
    if(touches(...edges[i],...edges[j])) return false;
  }
  return true;
}
const unescapeDxf=s=>s.replace(/\\U\+([0-9a-f]{4})/gi,(_,hex)=>String.fromCharCode(parseInt(hex,16)));
export function parseDxf(text,name='drawing.dxf') {
  if(text.length>25*1024*1024) throw Error('Максимальный размер DXF — 25 МБ.');
  if(text.startsWith('AutoCAD Binary DXF')) throw Error('Нужен текстовый DXF, двоичный формат не поддерживается.');
  const lines=text.replace(/^\uFEFF/,'').replace(/\r/g,'').trimEnd().split('\n');
  if(lines.length%2) throw Error('Повреждён DXF: нечётное число строк.');
  const pairs=[];
  for(let i=0;i<lines.length;i+=2) {
    const code=Number(lines[i].trim());
    if(!/^\d+$/.test(lines[i].trim()) || code>1071) throw Error(`Некорректный код DXF в строке ${i+1}.`);
    pairs.push([code,lines[i+1].trim()]);
  }
  if(!pairs.some(([c,v])=>c===0 && v==='EOF')) throw Error('Повреждён DXF: отсутствует EOF.');
  const unitsIndex=pairs.findIndex(([c,v])=>c===9 && v==='$INSUNITS');
  const units=unitsIndex>=0 && pairs[unitsIndex+1]?.[0]===70 ? Number(pairs[unitsIndex+1][1]):0;
  const unitScale=({4:1000,5:100,6:1})[units] || null;
  const start=pairs.findIndex((p,i)=>p[0]===0 && p[1]==='SECTION' && pairs[i+1]?.[1]==='ENTITIES');
  if(start<0) throw Error('В DXF нет секции ENTITIES.');
  let end=pairs.findIndex((p,i)=>i>start && p[0]===0 && p[1]==='ENDSEC');
  if(end<0) throw Error('Повреждён DXF: не закрыта секция ENTITIES.');
  const records=[];
  for(let i=start+2;i<end;) {
    if(pairs[i][0]!==0) throw Error('Нарушена структура ENTITIES.');
    let j=i+1;while(j<end && pairs[j][0]!==0)j++;
    records.push({type:pairs[i][1],pairs:pairs.slice(i+1,j)});i=j;
  }
  const features=[],unsupported=[],layers=new Set();
  const get=(r,c,def)=>r.pairs.find(p=>p[0]===c)?.[1]??def;
  const num=(r,c,def)=>{
    const raw=get(r,c,def); const value=Number(raw);
    if(raw===undefined || !Number.isFinite(value))throw Error(`Некорректная геометрия ${r.type}, код ${c}.`);
    return value;
  };
  for(let i=0;i<records.length;i++) {
    const r=records[i],layer=unescapeDxf(get(r,8,'0'));
    if(num(r,67,0)===1) continue;
    layers.add(layer);
    if(['TEXT','MTEXT','DIMENSION','ATTRIB','ATTDEF','SEQEND'].includes(r.type)) continue;
    const f={type:r.type,layer,points:[],closed:false};
    if([30,31,38].some(c=>num(r,c,0)!==0)){unsupported.push({type:r.type,layer,reason:'Ненулевая высота Z: нужен плоский DXF'});continue;}
    if([210,220,230].some(c=>num(r,c,c===230?1:0)!==(c===230?1:0))) {unsupported.push({type:r.type,layer,reason:'Нестандартная плоскость OCS'});continue;}
    if(r.type==='LINE')f.points=[{x:num(r,10),y:num(r,20)},{x:num(r,11),y:num(r,21)}];
    else if(r.type==='POINT')f.points=[{x:num(r,10),y:num(r,20)}];
    else if(r.type==='LWPOLYLINE' || r.type==='POLYLINE') {
      const flags=num(r,70,0);
      f.closed=Boolean(flags&1);
      let vertices=r.type==='LWPOLYLINE'?null:[];
      if(r.type==='POLYLINE') {
        while(records[i+1]?.type==='VERTEX')vertices.push(records[++i]);
        if(flags&(8|16|64))unsupported.push({type:r.type,layer,reason:'3D/polyface полилиния'});
        if(vertices.some(v=>num(v,30,0)!==0))unsupported.push({type:r.type,layer,reason:'Ненулевая Z-координата вершины'});
      }
      const hasBulge=vertices ? vertices.some(v=>num(v,42,0)!==0) : r.pairs.some(p=>p[0]===42 && Number(p[1])!==0);
      if(hasBulge)unsupported.push({type:r.type,layer,reason:'Дуговые сегменты bulge требуют развёртки'});
      if(vertices)f.points=vertices.map(v=>({x:num(v,10),y:num(v,20)}));
      else {
        for(let k=0;k<r.pairs.length;k++) if(r.pairs[k][0]===10) {
          if(r.pairs[k+1]?.[0]!==20)throw Error('LWPOLYLINE: отсутствует Y вершины.');
          f.points.push({x:Number(r.pairs[k][1]),y:Number(r.pairs[k+1][1])});
        }
      }
      if(f.points.length>2 && distance(f.points[0],f.points.at(-1))<1e-8){f.closed=true;f.points.pop();}
      if(f.points.length<2)throw Error('В полилинии недостаточно вершин.');
    } else if(r.type==='CIRCLE' || r.type==='ARC') {
      f.center={x:num(r,10),y:num(r,20)};f.radius=num(r,40);
      if(f.radius<=0)throw Error('Радиус должен быть положительным.');
      let a=r.type==='CIRCLE'?0:num(r,50),b=r.type==='CIRCLE'?360:num(r,51);
      if(b<=a)b+=360;
      f.closed=r.type==='CIRCLE';
      const n=Math.max(12,Math.ceil((b-a)/3));
      for(let k=0;k<=n;k++){const rad=(a+(b-a)*k/n)*Math.PI/180;f.points.push({x:f.center.x+f.radius*Math.cos(rad),y:f.center.y+f.radius*Math.sin(rad)});}
      // Arc chords under-estimate clearances by at most this sagitta.
      f.error=f.radius*(1-Math.cos((b-a)/n*Math.PI/360));
    } else {unsupported.push({type:r.type,layer,reason:'Тип геометрии пока не поддерживается'});continue;}
    if(f.points.some(p=>!Number.isFinite(p.x)||!Number.isFinite(p.y)))throw Error('DXF содержит нечисловые координаты.');
    features.push(f);
  }
  if(!features.length)throw Error('Поддерживаемая геометрия в модели не найдена.');
  if(features.length>30000)throw Error('В браузерной версии поддерживается до 30 000 объектов.');
  return {name,text,units,unitScale,features,layers:[...layers].sort(),unsupported,pairs,entityEnd:end};
}
export function prepare(model,options={}) {
  const scale=options.scale ?? model.unitScale;
  if(!Number.isFinite(scale)||scale<=0)throw Error('Укажите единицы измерения: в DXF они не определены.');
  const roles=options.roles||{};
  const role=layer=>roles[layer]||classify(layer);
  if(Object.values(roles).some(v=>!RULES[v]))throw Error('Неизвестная категория слоя.');
  const unsupported=model.unsupported.filter(f=>role(f.layer)!=='ignored');
  if(unsupported.length)throw Error(`Неразобранная геометрия: ${unsupported[0].type} в слое «${unsupported[0].layer}» (${unsupported.length}). Разверните блоки/кривые в CAD или подтвердите исключение слоя.`);
  const features=model.features.map(f=>({...f,category:role(f.layer)}));
  const candidates=features.filter(f=>options.boundaryLayer ? f.layer===options.boundaryLayer: f.category==='boundary');
  if(candidates.length!==1)throw Error(candidates.length ? 'Граница неоднозначна: нужен один замкнутый контур на выбранном слое.':'Нужен слой с замкнутой границей проекта.');
  const boundary=candidates[0];
  if(boundary.points.length>2000)throw Error('Слишком сложная граница: упростите контур до 2000 вершин.');
  if(!boundary.closed || boundary.points.length<3 || boundary.type==='ARC' || area(boundary.points)<1e-6 || !simplePolygon(boundary.points))throw Error('Граница должна быть простым замкнутым полигоном без самопересечений.');
  boundary.category='boundary';
  return {model,scale,features,boundary,roles,obstacles:features.filter(f=>f!==boundary && !['boundary','ignored'].includes(f.category)),options};
}
export function validatePoint(ctx,p,kind,placed=[],ignoreId=null) {
  if(!RADIUS[kind] || !Number.isFinite(p.x)||!Number.isFinite(p.y))return {ok:false,reason:'Некорректные координаты или тип посадки'};
  if(!pointInPolygon(p,ctx.boundary.points))return {ok:false,reason:'За границей проекта'};
  const edge=featureDistance(p,ctx.boundary)/ctx.scale;
  if(edge+1e-7<RADIUS[kind])return {ok:false,reason:`До границы ${edge.toFixed(2)} м, нужно ${RADIUS[kind]} м`};
  let nearest=null;
  for(const f of ctx.obstacles) {
    const rule=RULES[f.category],d=Math.max(0,featureDistance(p,f,rule.solid)-(f.type==='ARC'?f.error:0))/ctx.scale;
    const required=rule[kind];
    if(d+1e-7<required)return {ok:false,reason:`${rule.label}: ${d.toFixed(2)} м < ${required} м`,layer:f.layer};
    if(!nearest||d<nearest.distance)nearest={layer:f.layer,category:f.category,distance:d,required};
  }
  for(const q of placed)if(q.id!==ignoreId && distance(p,q)/ctx.scale+1e-7<RADIUS[kind]+RADIUS[q.kind])return {ok:false,reason:`Пересечение зоны кроны с ${q.id}`};
  return {ok:true,nearest,edge};
}
export function generate(ctx,{step=4,max=180,variant='balanced',treeSpecies='Дерево — уточнить породу',shrubSpecies='Кустарник — уточнить породу'}={}) {
  if(!Number.isFinite(step)||step<1||step>30||!Number.isInteger(max)||max<1||max>1000)throw Error('Шаг: 1–30 м, число посадок: 1–1000.');
  if(!['balanced','shade','light'].includes(variant))throw Error('Неизвестный сценарий.');
  const box=extent([ctx.boundary]),stride=step*ctx.scale;
  const count=Math.ceil((box.maxX-box.minX)/stride)*Math.ceil((box.maxY-box.minY)/stride);
  if(count>30000 || count*Math.max(1,ctx.obstacles.reduce((n,f)=>n+f.points.length,0))>30000000)throw Error('Слишком плотный расчёт: увеличьте шаг сетки или сократите участок.');
  const accepted=[],rejected=[],candidates=[],used=new Set(),visited=new Set();let capped=false;
  for(let y=box.minY+stride/2,row=0;y<box.maxY;y+=stride,row++)for(let x=box.minX+stride/2,col=0;x<box.maxX;x+=stride,col++) {
    if(pointInPolygon({x,y},ctx.boundary.points))candidates.push({x,y,tree:variant==='shade'||(variant==='balanced'&&(row+col)%3===0)});
  }
  // Reserve tree positions before infilling shrubs; early shrubs must not
  // suppress the entire tree scenario through their spacing constraints.
  outer:for(const kind of ['tree','shrub'])for(let i=0;i<candidates.length;i++) {
    const p=candidates[i];if(used.has(i)||(kind==='tree'&&!p.tree))continue;
    visited.add(i);const check=validatePoint(ctx,p,kind,accepted);
    if(!check.ok){if(kind==='shrub')rejected.push({x:p.x,y:p.y,reason:check.reason});continue;}
    used.add(i);accepted.push({x:p.x,y:p.y,id:`GL-${String(accepted.length+1).padStart(4,'0')}`,kind,species:kind==='tree'?treeSpecies:shrubSpecies,nearest:check.nearest});
    if(accepted.length>=max){capped=true;break outer;}
  }
  const examined=visited.size;
  return {accepted,rejected,examined,capped,variant,step,max,version:VERSION};
}
export function makeReport(ctx,result,history=[]) {
  return {schema_version:1,engine:VERSION,generated_at:new Date().toISOString(),status:'engineering_preview',
    source_file:ctx.model.name,units_per_meter:ctx.scale,boundary_layer:ctx.boundary.layer,
    layer_roles:Object.fromEntries(ctx.model.layers.map(l=>[l,ctx.roles[l]||classify(l)])),
    settings:{step_m:result.step,max:result.max,variant:result.variant},
    summary:{accepted:result.accepted.length,trees:result.accepted.filter(p=>p.kind==='tree').length,shrubs:result.accepted.filter(p=>p.kind==='shrub').length,rejected:result.rejected.length,candidates_examined:result.examined,capped:result.capped},
    rules:structuredClone(RULES),placements:result.accepted,rejected:result.rejected,edits:history,
    limitations:['Инженерный эскиз. Численные отступы — настраиваемые проектные допущения, нормативная верификация не завершена.','Полнота коммуникаций и назначение слоёв требуют подтверждения инженером.','Климат, почва, инсоляция и полив не моделируются. Выбор породы требует дендрологической проверки.','Дубай: локальные правила и ассортимент не подключены.'],
  };
}
export function exportDxf(ctx,result) {
  if(!result.accepted.length)throw Error('Нет посадок для экспорта.');
  for(const p of result.accepted){const check=validatePoint(ctx,p,p.kind,result.accepted,p.id);if(!check.ok)throw Error(`${p.id}: ${check.reason}`);}
  const ps=ctx.model.pairs.map(p=>[...p]);
  const modern=ps.some((p,i)=>p[0]===9&&p[1]==='$ACADVER'&&ps[i+1]?.[1]>'AC1009');
  let handle=ps.filter(([c,v])=>[5,105].includes(c)&&/^[0-9a-f]+$/i.test(v)).reduce((max,[,v])=>{const n=BigInt('0x'+v);return n>max?n:max;},0x100n)+1n;
  const nextHandle=()=>{const value=handle.toString(16).toUpperCase();handle++;return value;};
  const names=[['GREENLEAVES_TREES',3],['GREENLEAVES_SHRUBS',94],['GREENLEAVES_LABELS',7]];
  const generated=[];const add=(...args)=>{for(let i=0;i<args.length;i+=2)generated.push([args[i],String(args[i+1])]);};
  for(const p of result.accepted){const layer=names[p.kind==='tree'?0:1][0];
    add(0,'CIRCLE',5,nextHandle());if(modern)add(100,'AcDbEntity');add(8,layer);if(modern)add(100,'AcDbCircle');add(10,p.x,20,p.y,30,0,40,RADIUS[p.kind]*ctx.scale);
    add(0,'TEXT',5,nextHandle());if(modern)add(100,'AcDbEntity');add(8,'GREENLEAVES_LABELS');if(modern)add(100,'AcDbText');add(10,p.x+ctx.scale,20,p.y+ctx.scale,30,0,40,0.5*ctx.scale,1,p.id);if(modern)add(100,'AcDbText');
  }
  ps.splice(ctx.model.entityEnd,0,...generated);
  const defs=[];
  let addedLayers=0;
  for(const [name,color]of names)if(!ps.some(([c,v])=>c===2&&v===name)){
    addedLayers++;defs.push([0,'LAYER'],[5,nextHandle()]);if(modern)defs.push([100,'AcDbSymbolTableRecord'],[100,'AcDbLayerTableRecord']);defs.push([2,name],[70,'0'],[62,String(color)],[6,'CONTINUOUS']);
  }
  const layerTable=ps.findIndex((p,i)=>p[0]===0&&p[1]==='TABLE'&&ps[i+1]?.[1]==='LAYER');
  if(layerTable>=0){const end=ps.findIndex((p,i)=>i>layerTable&&p[0]===0&&p[1]==='ENDTAB');
    const count=ps.findIndex((p,i)=>i>layerTable&&i<end&&p[0]===70);
    if(count>=0)ps[count][1]=String(Number(ps[count][1])+addedLayers);
    ps.splice(end,0,...defs);
  }else{
    const tableSection=ps.findIndex((p,i)=>p[0]===0&&p[1]==='SECTION'&&ps[i+1]?.[1]==='TABLES');
    const table=[[0,'TABLE'],[2,'LAYER'],[5,nextHandle()],...(modern?[[100,'AcDbSymbolTable']]:[]),[70,String(addedLayers)],...defs,[0,'ENDTAB']];
    if(tableSection>=0){const end=ps.findIndex((p,i)=>i>tableSection&&p[0]===0&&p[1]==='ENDSEC');ps.splice(end,0,...table);}
    else ps.splice(0,0,[0,'SECTION'],[2,'TABLES'],...table,[0,'ENDSEC']);
  }
  const seed=ps.findIndex(([c,v])=>c===9&&v==='$HANDSEED');if(seed>=0&&ps[seed+1]?.[0]===5)ps[seed+1][1]=handle.toString(16).toUpperCase();
  return ps.flat().join('\r\n').replace(/[^\x00-\x7F]/g,c=>'\\U+'+c.charCodeAt(0).toString(16).toUpperCase().padStart(4,'0'))+'\r\n';
}
export function demoDxf() {
  const ps=[];const add=(...a)=>ps.push(...a);
  add(0,'SECTION',2,'HEADER',9,'$ACADVER',1,'AC1024',9,'$INSUNITS',70,6,0,'ENDSEC',0,'SECTION',2,'ENTITIES');
  const poly=(layer,points)=>{add(0,'LWPOLYLINE',100,'AcDbEntity',8,layer,100,'AcDbPolyline',90,points.length,70,1);for(const [x,y]of points)add(10,x,20,y);};
  poly('ГРАНИЦА_ПРОЕКТА',[[0,0],[120,0],[120,76],[0,76]]);
  poly('ЗДАНИЕ',[[12,26],[35,26],[35,56],[12,56]]);
  poly('ДОРОГА',[[0,9],[120,9],[120,17],[0,17]]);
  poly('ВОДОЕМ',[[92,47],[109,47],[109,65],[92,65]]);
  add(0,'LINE',100,'AcDbEntity',8,'ВОДОПРОВОД',100,'AcDbLine',10,59,20,0,11,59,21,76);
  add(0,'CIRCLE',100,'AcDbEntity',8,'СУЩЕСТВУЮЩИЕ_ДЕРЕВЬЯ',100,'AcDbCircle',10,78,20,48,40,3);
  add(0,'ENDSEC',0,'EOF');return ps.join('\n')+'\n';
}
