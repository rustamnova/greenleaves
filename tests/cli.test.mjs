import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
test('CLI produces a DXF and matching report from a clean directory',async()=>{
 const output=await fs.mkdtemp(path.join(os.tmpdir(),'greenleaves-cli-'));
 try {const run=spawnSync(process.execPath,['scripts/cli.mjs','--demo','--output',output],{encoding:'utf8'});assert.equal(run.status,0,run.stderr);
  const report=JSON.parse(await fs.readFile(path.join(output,'report.json'),'utf8'));assert.match(report.input_sha256,/^[a-f0-9]{64}$/);
  assert.equal(report.summary.accepted,180);assert.match(await fs.readFile(path.join(output,'planting-plan.dxf'),'utf8'),/GREENLEAVES_TREES/);
 }finally{const target=path.resolve(output);assert.equal(path.dirname(target),path.resolve(os.tmpdir()));assert.ok(path.basename(target).startsWith('greenleaves-cli-'));await fs.rm(target,{recursive:true,force:true});}
});
test('CLI rejects missing inputs with nonzero exit and clear usage',()=>{
 const run=spawnSync(process.execPath,['scripts/cli.mjs'],{encoding:'utf8'});assert.equal(run.status,1);assert.match(run.stderr,/--input/);
});
