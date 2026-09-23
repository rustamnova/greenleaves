import {demoDxf,parseDxf,prepare,generate} from './studio/engine.js';
const ctx=prepare(parseDxf(demoDxf())),result=generate(ctx,{variant:'shade',max:140});
document.getElementById('preview-count').textContent=result.accepted.length;
const c=document.getElementById('preview'),g=c.getContext('2d');
const sx=x=>40+x*5.65,sy=y=>520-y*5.65;
g.fillStyle='#edf2e7';g.fillRect(0,0,c.width,c.height);
g.strokeStyle='#dce6d3';g.lineWidth=1;
for(let i=0;i<800;i+=28){g.beginPath();g.moveTo(i,0);g.lineTo(i,600);g.stroke();}
for(let i=0;i<600;i+=28){g.beginPath();g.moveTo(0,i);g.lineTo(800,i);g.stroke();}
for(const f of ctx.features){g.beginPath();f.points.forEach((p,i)=>i?g.lineTo(sx(p.x),sy(p.y)):g.moveTo(sx(p.x),sy(p.y)));if(f.closed)g.closePath();g.lineWidth=f.category==='boundary'?2:2.5;g.strokeStyle=({boundary:'#718c63',building:'#9aa69b',road:'#c4c8b8',water:'#9bbdb9',utility:'#cb987a',existing:'#6d8d58'})[f.category];g.fillStyle=({building:'#d9dfd1',road:'#e4e5dc',water:'#c7ddcd',existing:'#a9c093'})[f.category]||'transparent';if(f.closed)g.fill();g.setLineDash(f.category==='utility'?[6,5]:[]);g.stroke();g.setLineDash([]);}
for(const p of result.accepted){g.beginPath();g.arc(sx(p.x),sy(p.y),p.kind==='tree'?11:4.5,0,Math.PI*2);g.fillStyle=p.kind==='tree'?'#92ae65b0':'#bed293';g.fill();g.strokeStyle='#708e49';g.lineWidth=.8;g.stroke();if(p.kind==='tree'){g.beginPath();g.arc(sx(p.x),sy(p.y),1.5,0,Math.PI*2);g.fillStyle='#59753c';g.fill();}}
g.font='12px Segoe UI';g.fillStyle='#71816c';g.fillText('ЗДАНИЕ',sx(17),sy(39));g.fillStyle='#a67c64';g.save();g.translate(sx(62),sy(28));g.rotate(-Math.PI/2);g.fillText('ВОДОПРОВОД',0,0);g.restore();
