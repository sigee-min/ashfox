import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { compileDirectoryWorkspace, readDirectoryWorkspace, isDirectorySource, compileItemStudy, parseSpriteSource } from '../../src';

const directory=path.resolve(__dirname,'../../../../examples/items');
const configSource=fs.readFileSync(path.join(directory,'.ashfoxworkspace'),'utf8');
const files=fs.readdirSync(path.join(directory,'src')).filter(n=>n.endsWith('.ashfox')).map(n=>({path:'src/'+n,source:fs.readFileSync(path.join(directory,'src',n),'utf8')}));
const config=readDirectoryWorkspace(configSource);
assert.equal(config.version,2);
assert.ok(isDirectorySource(config,'src/apple.ashfox'));
assert.ok(!isDirectorySource(config,'src/drafts/apple.ashfox'));
assert.ok(!isDirectorySource(config,'build/apple.ashfox'));
assert.ok(!isDirectorySource(config,'exports/apple/apple.ashfox'));
const compiled=compileDirectoryWorkspace(configSource,files);
assert.ok(compiled.ok,JSON.stringify(compiled));
if(!compiled.ok)throw new Error('Expected directory compilation');
assert.equal(compiled.products.length,10);
const fixture=compileItemStudy(fs.readFileSync(path.resolve(__dirname,'../fixtures/items.json'),'utf8'));
assert.ok(fixture.ok);
if(!fixture.ok)throw new Error('Expected fixture compilation');
for(const p of compiled.products){assert.equal(p.kind,'sprite');if(p.kind==='sprite')assert.deepEqual(p.sprite.png,fixture.products.find(f=>f.id===p.sprite.id)!.png);}
const repeat=compileDirectoryWorkspace(configSource,[...files].reverse());
assert.ok(repeat.ok);if(repeat.ok)assert.equal(repeat.buildKey,compiled.buildKey);
assert.equal(compileDirectoryWorkspace(configSource,files.slice(1)).ok,false);
assert.equal(compileDirectoryWorkspace(configSource,[...files,{path:'src/extra.ashfox',source:files[0]!.source}]).ok,false);
const changed=JSON.parse(configSource);
changed.ignore=['src/apple.ashfox'];assert.throws(()=>readDirectoryWorkspace(JSON.stringify(changed)),/included/);
changed.ignore=[];changed.build.directory='../outside';assert.throws(()=>readDirectoryWorkspace(JSON.stringify(changed)),/directory/);
changed.build.directory='exports';assert.throws(()=>readDirectoryWorkspace(JSON.stringify(changed)),/disjoint/);
changed.build.directory='.ashfoxworkspace';assert.throws(()=>readDirectoryWorkspace(JSON.stringify(changed)),/disjoint/);
changed.build.directory='build';changed.exports[0].format='glb';assert.equal(compileDirectoryWorkspace(JSON.stringify(changed),files).ok,false);
assert.throws(()=>readDirectoryWorkspace(configSource.replace('"version": 2','"version": 2, "version": 2')),/unique keys/);
assert.throws(()=>readDirectoryWorkspace(configSource.replace('"version": 2','"version": 1')),/version 2/);
const apple=files.find(f=>f.path==='src/apple.ashfox')!;
const invalid=files.map(f=>f===apple?{...f,source:f.source.replace('./shared.ashfox','../../outside.ashfox')}:f);
assert.equal(compileDirectoryWorkspace(configSource,invalid).ok,false);
assert.throws(()=>parseSpriteSource('\uFEFF'+apple.source,apple.path),/BOM/);
assert.throws(()=>parseSpriteSource(apple.source+'\uD800',apple.path),/surrogate/);
const badUnit=apple.source.replace('seed = 23;','seed = 23px;');assert.throws(()=>parseSpriteSource(badUnit,apple.path),/unitless/);
assert.throws(()=>parseSpriteSource(JSON.stringify({id:'apple'}),'apple.ashfox'),/ashfox-model/);
const parsed=parseSpriteSource(apple.source,apple.path);assert.ok(Object.isFrozen(parsed.imports));
const cyclic=files.map(f=>f.path==='src/shared.ashfox'?{...f,source:f.source.replace('module shared {','module shared { import "./shared.ashfox" as loop;')}:f);
assert.equal(compileDirectoryWorkspace(configSource,cyclic).ok,false);
// The root configuration can compile existing model source and sprite source together.
const legacy=JSON.parse(fs.readFileSync(path.resolve(directory,'../../assets/workspaces/fox.ashfoxworkspace'),'utf8'));
const mixed={...config,packages:[...config.packages,...legacy.manifest.packages],include:['**/*.ashfox'],
  exports:[...config.exports,{name:'fox_model',entry:{packageName:'creatures',entryName:'fox'},format:'glb',directory:'exports/fox'}]};
const mixedResult=compileDirectoryWorkspace(JSON.stringify(mixed),[...files,...legacy.files]);
assert.ok(mixedResult.ok,JSON.stringify(mixedResult));
if(mixedResult.ok){assert.equal(mixedResult.products.length,11);assert.equal(mixedResult.products.filter(p=>p.kind==='model').length,1);}
console.log('directory workspace: native sprite parity, mixed model/sprite, root exclusions and fail-closed contracts ok');
