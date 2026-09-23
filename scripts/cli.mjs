import fs from 'node:fs/promises';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {parseDxf,prepare,generate,exportDxf,makeReport,demoDxf} from '../site/studio/engine.js';
const usage='node scripts/cli.mjs (--demo | --input file.dxf) [--output output/demo] [--config config.json]';
try {
  const args=process.argv.slice(2),options={};
  for(let i=0;i<args.length;i++){
    if(args[i]==='--demo')options.demo=true;
    else if(['--input','--output','--config'].includes(args[i]) && args[i+1] && !args[i+1].startsWith('--'))options[args[i].slice(2)]=args[++i];
    else throw Error(usage);
  }
  if(Boolean(options.demo)===Boolean(options.input))throw Error(usage);
  const bytes=options.demo?Buffer.from(demoDxf()):await fs.readFile(options.input);
  let text;try{text=new TextDecoder('utf-8',{fatal:true}).decode(bytes);}catch{text=new TextDecoder('windows-1251').decode(bytes);}
  const config=options.config?JSON.parse(await fs.readFile(options.config,'utf8')):{};
  const model=parseDxf(text,options.demo?'synthetic-demo.dxf':path.basename(options.input));
  const ctx=prepare(model,config),result=generate(ctx,config);
  const report=makeReport(ctx,result);report.input_sha256=createHash('sha256').update(bytes).digest('hex');
  const output=path.resolve(options.output||'output/demo');await fs.mkdir(output,{recursive:true});
  if(!result.accepted.length)throw Error('No placements. No DXF exported.');
  await fs.writeFile(path.join(output,'planting-plan.dxf'),exportDxf(ctx,result));
  await fs.writeFile(path.join(output,'report.json'),JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({output,...report.summary,status:report.status}));
}catch(error){console.error(error.message);process.exitCode=1;}
