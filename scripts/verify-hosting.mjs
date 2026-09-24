import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';

const base=new URL(process.argv[2]||'');
if(base.protocol!=='https:'||base.username||base.password||!base.pathname.endsWith('/'))throw Error('Pass a public HTTPS base URL ending in /.');
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'..');
const files=execFileSync('git',['ls-files','site'],{cwd:root,encoding:'utf8'}).trim().split(/\r?\n/).filter(f=>!f.split('/').some(part=>part.startsWith('.')));
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
async function fetchPublic(url){
  for(let attempt=1;attempt<=3;attempt++){
    try {
      // No cookie jar, account headers or browser authentication.
      const response=await fetch(url,{signal:AbortSignal.timeout(20000),headers:{'Cache-Control':'no-cache'}});
      const actual=Buffer.from(await response.arrayBuffer());
      if(response.status>=500&&attempt<3)continue;
      return {response,actual,attempts:attempt};
    }catch(error){if(attempt===3)throw error;}
  }
}
const results=[];
for(const file of files){
  const relative=file.slice(5),url=new URL(relative==='index.html'?'./':relative,base);
  const expected=await fs.readFile(path.join(root,file));
  try {
    const {response,actual,attempts}=await fetchPublic(url);
    results.push({path:relative,url:String(url),status:response.status,contentType:response.headers.get('content-type'),bytes:actual.length,sha256:sha(actual),expectedSha256:sha(expected),attempts,matches:response.ok&&sha(expected)===sha(actual)});
  }catch(error){results.push({path:relative,url:String(url),matches:false,error:error.message});}
}
const receipt={checkedAt:new Date().toISOString(),baseUrl:String(base),anonymous:true,allAccessible:results.every(r=>r.status===200),allMatched:results.every(r=>r.matches),nonHtmlAssetsMatched:results.filter(r=>!r.path.endsWith('.html')).every(r=>r.matches),files:results};
if(process.argv[3])await fs.writeFile(path.resolve(process.argv[3]),JSON.stringify(receipt,null,2)+'\n');
console.log(JSON.stringify(receipt,null,2));
if(!receipt.allMatched)process.exitCode=1;
