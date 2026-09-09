'use strict';
const fs=require('node:fs');const path=require('node:path');const {execFileSync}=require('node:child_process');const {createHash}=require('node:crypto');
const root=path.resolve(__dirname,'../..'),cli=path.join(root,'apps/cli/dist/ashfox.cjs'),out=path.join(root,'assets/docs');fs.mkdirSync(out,{recursive:true});
const fox='examples/fox/creatures/fox.ashfox',sword='examples/items/src/iron_sword.ashfox',sound='examples/sounds/src/claw_hit.ashfox';
const jobs={
 'fox-front.png':['capture',fox,'--camera','front','--width','480','--height','320'],
 'fox-angle.png':['capture',fox,'--azimuth','45','--elevation','20','--width','480','--height','320'],
 'sword.png':['capture',sword,'--scale','12','--background','checker'],
 'sword-shape.png':['capture',sword,'--stage','silhouette','--scale','12','--background','checker'],
 'claw-wave.png':['capture',sound,'--width','480','--height','160'],
 'claw.wav':['export',sound,'--variant','base'],
 'fox-motion.gif':['replay',fox,'--clip','tail_wag','--width','320','--height','240','--fps','6']
};
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const files=[];
for(const [name,args] of Object.entries(jobs)){const bytes=execFileSync(process.execPath,[cli,...args],{cwd:root,maxBuffer:64*1024*1024,timeout:150000});fs.writeFileSync(path.join(out,name),bytes);files.push({name,args,sha256:sha(bytes)});}
fs.writeFileSync(path.join(out,'receipt.json'),JSON.stringify({format:'ashfox-doc-media',version:1,compiler:sha(fs.readFileSync(cli)),sources:[fox,'examples/fox/creatures/rig.ashfox','examples/fox/creatures/surface.ashfox','examples/fox/creatures/body.ashfox',sword,sound,'examples/items/src/shared.ashfox'].map(file=>({file,sha256:sha(fs.readFileSync(path.join(root,file)))})),files},null,2)+'\n');
process.stdout.write('Guide images, motion and sound generated from native sources\n');
