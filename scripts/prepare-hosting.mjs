import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

// Export only already-reviewed public site assets. No private intake or Git history.
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
execFileSync('git',['diff','--quiet','HEAD','--','site'],{cwd:root});
const files=execFileSync('git',['ls-files','site'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/).filter(Boolean);
if(!files.includes('site/index.html')||!files.includes('site/studio/index.html'))throw Error('Website entry points missing.');
const sourceCommit=execFileSync('git',['rev-parse','HEAD'],{cwd:root,encoding:'utf8'}).trim();
const releaseName=new Date().toISOString().replace(/[:.]/g,'-');
const output=path.join(root,'.private','hosting',releaseName);
const manifest={sourceCommit,createdAt:new Date().toISOString(),files:[]};
for(const tracked of files){
  const relative=tracked.slice('site/'.length);
  if(relative.includes('..')||path.isAbsolute(relative))throw Error('Unsafe asset path.');
  const input=path.join(root,tracked);
  if(!(await fs.lstat(input)).isFile())throw Error('Only ordinary files may be exported.');
  const bytes=await fs.readFile(input);
  for(const provider of ['netlify','sourcecraft','gitverse']){
    const destination=path.join(output,provider,relative);
    await fs.mkdir(path.dirname(destination),{recursive:true});
    await fs.writeFile(destination,bytes);
  }
  manifest.files.push({path:relative,bytes:bytes.length,sha256:createHash('sha256').update(bytes).digest('hex')});
}
const sourcecraftConfig=path.join(output,'sourcecraft','.sourcecraft');
await fs.mkdir(sourcecraftConfig,{recursive:true});
await fs.writeFile(path.join(sourcecraftConfig,'sites.yaml'),'site:\n  ref: main\n');
await fs.writeFile(path.join(output,'manifest.json'),JSON.stringify(manifest,null,2)+'\n');
console.log(JSON.stringify({output,sourceCommit,assets:manifest.files.length,totalBytes:manifest.files.reduce((n,f)=>n+f.bytes,0)}));
