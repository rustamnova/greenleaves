import {VERSION,RULES,RADIUS,classify,parseDxf,prepare,generate,makeReport,exportDxf,demoDxf,extent,validatePoint,distance} from './engine.js';
const $=id=>document.getElementById(id);
const state={model:null,ctx:null,result:null,roles:{},variant:'balanced',mode:'inspect',view:'all',selected:null,history:[],undo:[],zoom:1,catalog:null,nextId:1};
const esc=s=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const fmt=n=>Number(n.toFixed(2));
const notice=(text,error=false)=>{$('notice').textContent=text;$('notice').classList.toggle('error',error);};
function check(id,ok,text){$('check-'+id).textContent=ok?'✓':'○';$('check-'+id+'-text').textContent=text;}
function invalidate(message='Настройки изменены. Выполните расчёт заново.'){
  state.ctx=null;state.result=null;state.selected=null;state.history=[];state.undo=[];
  $('status').textContent=state.model?'ГОТОВ К ПРОВЕРКЕ':'ОЖИДАНИЕ';
  for(const id of ['export-dxf','export-json','export-csv','undo'])$(id).disabled=true;
  for(const id of ['count','trees','shrubs','rejected'])$(id).textContent='—';
  $('selection').hidden=true;$('results').hidden=true;$('edit-count').textContent='0 правок';
  check('result',false,'Расчёт не выполнен');check('boundary',false,'Ожидается проверка');
  if(state.model)notice(message);draw();
}
function fillSpecies(){
  const territory=$('territory').value;
  for(const kind of ['tree','shrub']) {
    const select=$(kind+'-species');const old=select.value;
    const records=(state.catalog?.records||[]).filter(r=>r.life_form===kind && r.territories[territory]==='+' && !(r.note_codes||[]).length);
    const names=[...new Set(records.map(r=>r.name))].sort((a,b)=>a.localeCompare(b,'ru'));
    select.innerHTML='<option value="">Порода не определена</option>'+names.map(n=>`<option>${esc(n)}</option>`).join('');
    if(names.includes(old))select.value=old;
  }
}
async function loadCatalog(){try{
  const response=await fetch('../data/species-catalog.json');if(!response.ok)throw Error('HTTP');
  state.catalog=await response.json();
  $('catalog-status').textContent=`Справочник партнёра: ${state.catalog.records.length} записей. Показаны кандидаты с «+» для территории и без дополнительных примечаний. Проверка по оригиналам ещё не завершена.`;
}catch{$('catalog-status').textContent='Справочник недоступен. Посадки будут без определённой породы.';}fillSpecies();}
function setModel(text,name){
  state.model=null;state.roles={};$('run').disabled=true;invalidate();
  $('layers').replaceChildren();$('layer-count').textContent='0';$('boundary').innerHTML='<option value="">Определить по названию слоя</option>';
  check('units',false,'Не определены');check('file',false,'Ожидается DXF');
  try {
    const model=parseDxf(text,name);state.model=model;state.zoom=1;
    $('filename').textContent=`${name} · ${model.features.length} объектов`;$('project-title').textContent=name;
    $('boundary').innerHTML='<option value="">Определить по названию слоя</option>'+model.layers.map(l=>`<option>${esc(l)}</option>`).join('');
    $('units').value='auto';$('layer-count').textContent=model.layers.length;
    $('layers').replaceChildren();
    model.layers.forEach((layer,i)=>{
      const box=document.createElement('div');box.className='layer-field';
      const label=document.createElement('label');label.htmlFor='layer-'+i;label.textContent=layer;
      const select=document.createElement('select');select.id='layer-'+i;
      for(const [key,r]of Object.entries(RULES)){const opt=new Option(r.label,key);select.add(opt);}
      select.value=classify(layer);select.onchange=()=>{state.roles[layer]=select.value;invalidate();};
      box.append(label,select);$('layers').append(box);
    });
    $('run').disabled=false;$('empty').hidden=true;
    check('file',true,`${model.features.length} объектов; ${model.unsupported.length} требуют подготовки`);
    check('units',Boolean(model.unitScale),model.unitScale?`${model.unitScale} единиц на метр`:'Укажите масштаб вручную');
    invalidate('DXF прочитан. Проверьте назначение слоёв, масштаб и границу.');
  }catch(error){$('empty').hidden=false;$('filename').textContent='Файл не загружен';$('project-title').textContent='Ошибка чтения DXF';check('file',false,'Файл не прочитан');notice(error.message,true);draw();}
}
$('file').onchange=async event=>{
  const file=event.target.files[0];if(!file)return;
  if(!/\.dxf$/i.test(file.name)||file.size>25*1024*1024){notice('Выберите текстовый DXF размером до 25 МБ.',true);event.target.value='';return;}
  const buffer=await file.arrayBuffer();let text;
  try{text=new TextDecoder('utf-8',{fatal:true}).decode(buffer);}catch{text=new TextDecoder('windows-1251').decode(buffer);}
  setModel(text,file.name);event.target.value='';
};
$('demo').onclick=()=>{setModel(demoDxf(),'Демоучасток · Москва');run();};
function run(){
  if(!state.model)return;
  invalidate();
  try {
    const scale=$('units').value==='auto'?state.model.unitScale:Number($('units').value);
    const ctx=prepare(state.model,{scale,roles:state.roles,boundaryLayer:$('boundary').value});
    const result=generate(ctx,{step:Number($('step').value),max:Number($('max').value),variant:state.variant,treeSpecies:$('tree-species').value||'Дерево — порода не определена',shrubSpecies:$('shrub-species').value||'Кустарник — порода не определена'});
    state.ctx=ctx;state.result=result;state.nextId=result.accepted.length+1;
    check('units',true,`${scale} единиц на метр`);check('boundary',true,ctx.boundary.layer);
    notice(`Рассчитано ${result.accepted.length} посадок. ${result.capped?'Достигнут лимит: участок обследован частично. ':''}Инженерный эскиз требует экспертной проверки.`);
    update();
  }catch(error){notice(error.message,true);check('boundary',false,'Расчёт заблокирован');$('status').textContent='НУЖНЫ УТОЧНЕНИЯ';}
}
$('run').onclick=run;
for(const id of ['units','boundary','tree-species','shrub-species'])$(id).addEventListener('change',()=>invalidate());
for(const id of ['step','max'])$(id).addEventListener('input',()=>invalidate());
$('territory').onchange=()=>{fillSpecies();invalidate();};
document.querySelectorAll('[data-variant]').forEach(b=>b.onclick=()=>{
  state.variant=b.dataset.variant;document.querySelectorAll('[data-variant]').forEach(x=>x.classList.toggle('selected',x===b));invalidate();
});
document.querySelectorAll('[data-view]').forEach(b=>b.onclick=()=>{state.view=b.dataset.view;document.querySelectorAll('[data-view]').forEach(x=>x.classList.toggle('selected',x===b));draw();});
document.querySelectorAll('[data-mode]').forEach(b=>b.onclick=()=>{
  state.mode=b.dataset.mode;document.querySelectorAll('[data-mode]').forEach(x=>x.classList.toggle('selected',x===b));
  $('edit-hint').textContent=({inspect:'Выберите посадку на плане, чтобы увидеть координаты и ограничения.',tree:'Нажмите на плане, чтобы добавить дерево. Отступы проверяются автоматически.',shrub:'Нажмите на плане, чтобы добавить кустарник.',move:'Сначала выберите посадку, затем нажмите на новую позицию.',remove:'Нажмите на посадку, чтобы удалить её. Доступна отмена.'})[state.mode];
});
function selectedInfo(){
  const p=state.result?.accepted.find(p=>p.id===state.selected);$('selection').hidden=!p;
  if(p){const v=validatePoint(state.ctx,p,p.kind,state.result.accepted,p.id);$('selection').textContent=`${p.id} · ${p.species} · X ${fmt(p.x)}, Y ${fmt(p.y)}. ${v.nearest?`${RULES[v.nearest.category].label}: ${fmt(v.nearest.distance)} м (порог ${v.nearest.required} м).`:'Инженерные ограничения рядом не обнаружены.'} До границы ${fmt(v.edge)} м.`;}
}
function update(){
  const result=state.result;if(!result)return;
  $('status').textContent='ЭСКИЗ РАССЧИТАН';$('count').textContent=result.accepted.length;
  $('trees').textContent=result.accepted.filter(p=>p.kind==='tree').length;$('shrubs').textContent=result.accepted.filter(p=>p.kind==='shrub').length;$('rejected').textContent=result.rejected.length;
  check('result',true,`${result.accepted.length} точек · проверка выполнена`);
  for(const id of ['export-dxf','export-csv'])$(id).disabled=!result.accepted.length;
  $('export-json').disabled=false;$('undo').disabled=!state.undo.length;
  $('edit-count').textContent=`${state.history.length} правок`;
  $('results').hidden=false;$('table-caption').textContent=`${result.accepted.length} записей`;
  $('result-rows').innerHTML=result.accepted.map(p=>`<tr><td>${esc(p.id)}</td><td>${p.kind==='tree'?'Дерево':'Кустарник'}<small>${esc(p.species)}</small></td><td>${fmt(p.x)} / ${fmt(p.y)}</td><td>${p.nearest?`${esc(RULES[p.nearest.category].label)}<small>${fmt(p.nearest.distance)} м / порог ${p.nearest.required} м</small>`:'—'}</td></tr>`).join('');
  selectedInfo();draw();
}
function edit(action,id,point,kind){
  if(!state.result||!state.ctx)throw Error('Сначала выполните расчёт.');
  const list=state.result.accepted,existing=list.find(p=>p.id===id);
  if(action!=='add'&&!existing)throw Error(`Посадка ${id} не найдена.`);
  if(action==='add'&&list.length>=1000)throw Error('Достигнут предел 1000 посадок.');
  let item=null;
  if(action!=='remove'){
    kind=kind||existing.kind;
    const check=validatePoint(state.ctx,point,kind,list,id);
    if(!check.ok)throw Error(check.reason);
    item={...existing,...point,kind,id:existing?.id||`GL-${String(state.nextId).padStart(4,'0')}`,species:existing?.species||$(kind+'-species').value||(kind==='tree'?'Дерево — порода не определена':'Кустарник — порода не определена'),nearest:check.nearest};
  }
  state.undo.push({accepted:structuredClone(list),history:structuredClone(state.history),nextId:state.nextId});
  if(state.undo.length>50)state.undo.shift();
  if(action==='remove'){state.result.accepted=list.filter(p=>p.id!==id);state.selected=null;}
  else if(action==='move'){state.result.accepted=list.map(p=>p.id===id?item:p);state.selected=id;}
  else {state.result.accepted.push(item);state.selected=item.id;state.nextId++;}
  state.history.push({action,id:id||item.id,from:existing?{x:existing.x,y:existing.y}:null,to:point||null,at:new Date().toISOString()});
  update();notice('Правка применена. Геометрические ограничения соблюдены.');
}
$('undo').onclick=()=>{const previous=state.undo.pop();if(!previous)return;state.result.accepted=previous.accepted;state.history=previous.history;state.nextId=previous.nextId;state.selected=null;update();notice('Последняя правка отменена.');};
$('command-form').onsubmit=event=>{
  event.preventDefault();const value=$('command').value.trim();let m;
  try {
    if((m=value.match(/^удалить\s+(GL-\d+)$/i)))edit('remove',m[1].toUpperCase());
    else if((m=value.match(/^перенести\s+(GL-\d+)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/i)))edit('move',m[1].toUpperCase(),{x:Number(m[2]),y:Number(m[3])});
    else if((m=value.match(/^(дерево|кустарник)\s+(-?\d+(?:\.\d+)?)\s+(-?\d+(?:\.\d+)?)$/i)))edit('add',null,{x:Number(m[2]),y:Number(m[3])},m[1].toLowerCase()==='дерево'?'tree':'shrub');
    else throw Error('Команда не распознана. Используйте примеры под строкой ввода.');
    $('command').value='';
  }catch(error){notice(error.message,true);}
};
const canvas=$('plan');let transform=null;
function draw(){
  const rect=canvas.getBoundingClientRect(),dpr=Math.min(window.devicePixelRatio||1,2),w=rect.width,h=rect.height;
  canvas.width=Math.round(w*dpr);canvas.height=Math.round(h*dpr);const g=canvas.getContext('2d');g.scale(dpr,dpr);g.clearRect(0,0,w,h);
  g.strokeStyle='#e0e8d7';g.lineWidth=.6;for(let x=0;x<w;x+=24){g.beginPath();g.moveTo(x,0);g.lineTo(x,h);g.stroke();}for(let y=0;y<h;y+=24){g.beginPath();g.moveTo(0,y);g.lineTo(w,y);g.stroke();}
  if(!state.model)return;
  const fs=state.ctx?.features||state.model.features.map(f=>({...f,category:state.roles[f.layer]||classify(f.layer)}));
  const box=extent(state.ctx?[state.ctx.boundary]:fs);if(!box)return;
  const zoom=Math.min((w-65)/Math.max(box.maxX-box.minX,1),(h-85)/Math.max(box.maxY-box.minY,1))*state.zoom;
  const ox=w/2-(box.minX+box.maxX)/2*zoom,oy=(h-15)/2+(box.minY+box.maxY)/2*zoom;
  transform={zoom,ox,oy};const X=x=>ox+x*zoom,Y=y=>oy-y*zoom;
  for(const f of fs){
    if(f.category==='ignored')continue;
    g.globalAlpha=state.view==='plants'&&f.category!=='boundary'?.2:1;
    g.beginPath();f.points.forEach((p,i)=>i?g.lineTo(X(p.x),Y(p.y)):g.moveTo(X(p.x),Y(p.y)));if(f.closed)g.closePath();
    const rule=RULES[f.category];g.strokeStyle=rule.color;g.lineWidth=f.category==='utility'?1.6:1.1;g.setLineDash(f.category==='boundary'?[5,4]:[]);
    if(f.closed && rule.solid){g.fillStyle=rule.color+'45';g.fill();}g.stroke();g.setLineDash([]);
    if(state.view==='constraints'&&rule.tree){g.strokeStyle=rule.color+'35';g.lineWidth=rule.tree*(state.ctx?.scale||state.model.unitScale||1)*zoom*2;g.stroke();}
  }
  g.globalAlpha=1;
  if(state.result && state.view!=='constraints')for(const p of state.result.accepted){
    const r=RADIUS[p.kind]*state.ctx.scale*zoom;
    g.beginPath();g.arc(X(p.x),Y(p.y),Math.max(r,2),0,Math.PI*2);g.fillStyle=p.kind==='tree'?'#7fa65f9f':'#bbd17fab';g.fill();g.strokeStyle=p.id===state.selected?'#264c2e':p.kind==='tree'?'#5e8446':'#92aa61';g.lineWidth=p.id===state.selected?2.5:.8;g.stroke();
    if(p.kind==='tree'){g.beginPath();g.arc(X(p.x),Y(p.y),1.2,0,Math.PI*2);g.fillStyle='#476b37';g.fill();}
  }
  if(state.result&&state.view==='constraints')for(const p of state.result.rejected){g.fillStyle='#c28e7060';g.fillRect(X(p.x)-1,Y(p.y)-1,2,2);}
  $('map-scale').textContent=`10 м ≈ ${Math.round(10*(state.ctx?.scale||state.model.unitScale||1)*zoom)} px`;
}
new ResizeObserver(draw).observe(canvas.parentElement);
$('zoom-in').onclick=()=>{state.zoom=Math.min(4,state.zoom*1.25);draw();};$('zoom-out').onclick=()=>{state.zoom=Math.max(.4,state.zoom/1.25);draw();};$('fit').onclick=()=>{state.zoom=1;draw();};
canvas.onclick=event=>{
  if(!transform||!state.result){notice('Сначала выполните расчёт.',true);return;}
  const rect=canvas.getBoundingClientRect(),point={x:fmt((event.clientX-rect.left-transform.ox)/transform.zoom),y:fmt((transform.oy-event.clientY+rect.top)/transform.zoom)};
  const near=[...state.result.accepted].sort((a,b)=>distance(a,point)-distance(b,point))[0];
  const hit=near&&distance(near,point)<Math.max(RADIUS[near.kind]*state.ctx.scale,9/transform.zoom)?near:null;
  try {
    if(state.mode==='tree'||state.mode==='shrub')edit('add',null,point,state.mode);
    else if(state.mode==='remove'){if(!hit)throw Error('Нажмите на посадку.');edit('remove',hit.id);}
    else if(state.mode==='move'&&state.selected){edit('move',state.selected,point);state.selected=null;selectedInfo();draw();}
    else {state.selected=hit?.id||null;selectedInfo();draw();if(state.mode==='move'&&hit)notice(`Выбрана ${hit.id}. Нажмите на новую позицию.`);}
  }catch(error){notice(error.message,true);}
};
function save(name,data,type){const url=URL.createObjectURL(new Blob([data],{type}));const a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
$('export-dxf').onclick=()=>{try{save('greenleaves-plan.dxf',exportDxf(state.ctx,state.result),'application/dxf');notice('DXF сформирован. Посадки добавлены к исходному чертежу.');}catch(error){notice(error.message,true);}};
$('export-json').onclick=()=>{const report=makeReport(state.ctx,state.result,state.history);report.territory=$('territory').value;report.species_catalog_source='Partner catalog, original documents not yet verified';save('greenleaves-report.json',JSON.stringify(report,null,2),'application/json');};
$('export-csv').onclick=()=>{
  const safe=value=>{let s=String(value??'');if(/^[=+@-]/.test(s))s="'"+s;return '"'+s.replace(/"/g,'""')+'"';};
  const rows=[['id','kind','species','x_dxf','y_dxf','nearest_layer','distance_m','required_m'],...state.result.accepted.map(p=>[p.id,p.kind,p.species,p.x,p.y,p.nearest?.layer,p.nearest?.distance,p.nearest?.required])];
  save('greenleaves-planting-schedule.csv','\uFEFF'+rows.map(r=>r.map(safe).join(',')).join('\r\n'),'text/csv;charset=utf-8');
};
await loadCatalog();
if(new URLSearchParams(location.search).has('demo')){setModel(demoDxf(),'Демоучасток · Москва');run();}
