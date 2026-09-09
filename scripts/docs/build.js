'use strict';
const fs=require('node:fs');const path=require('node:path');const {execFileSync}=require('node:child_process');const {zipSync}=require('fflate');
const root=path.resolve(__dirname,'../..'),out=path.join(root,'dist/docs-delivery');
fs.mkdirSync(out,{recursive:true});
const npm=process.platform==='win32'?'npm.cmd':'npm';
const packed=JSON.parse(execFileSync(npm,['pack','--workspace','@ashfox/cli','--pack-destination',out,'--json'],{cwd:root,encoding:'utf8',maxBuffer:8*1024*1024}));
const tarball=path.join(out,packed[0].filename);fs.copyFileSync(tarball,path.join(out,'ashfox-cli.tgz'));fs.unlinkSync(tarball);
const sources=directory=>{
 const result={};
 const visit=(dir,prefix='')=>{for(const e of fs.readdirSync(dir,{withFileTypes:true}).sort((a,b)=>a.name.localeCompare(b.name))){
  if(['dist','build','exports','node_modules','.ashfox'].includes(e.name))continue;
  const key=prefix+e.name;
  if(e.isDirectory())visit(path.join(dir,e.name),key+'/');else if(e.isFile())result[key]=fs.readFileSync(path.join(dir,e.name));
 }};visit(path.join(root,directory));return result;
};
const zip=(name,files)=>fs.writeFileSync(path.join(out,name),zipSync(files,{level:9,mtime:new Date(1980,0,1)}));
const starter=sources('examples/fox/creatures');for(const [dest,source] of Object.entries({
 'fox.ashfox':'examples/fox/creatures/fox.ashfox','sword.ashfox':'examples/items/src/iron_sword.ashfox',
 'shared.ashfox':'examples/items/src/shared.ashfox','claw_hit.ashfox':'examples/sounds/src/claw_hit.ashfox','marker.ashfox':'examples/minecraft/marker.ashfox'
}))starter[dest]=fs.readFileSync(path.join(root,source));
starter['package.json']=Buffer.from('{"name":"my-ashfox-assets","private":true}\n');
zip('starter.zip',starter);
for(const name of ['items','game-assets','resource-pack'])zip(name+'.zip',sources('examples/'+name));
zip('stdio-client.zip',sources('examples/stdio-client'));
const game=sources('examples/web-game');for(const [file,bytes] of Object.entries(sources('examples/game-assets')))game['assets/'+file]=bytes;
zip('web-game.zip',game);
process.stdout.write('User downloads ready: '+out+'\n');
