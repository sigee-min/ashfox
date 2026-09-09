'use strict';
const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');const os=require('node:os');
const {spawnSync,spawn}=require('node:child_process');
const {inflateSync}=require('node:zlib');
const root=path.resolve(__dirname,'../..'),cli=path.join(__dirname,'dist/ashfox.cjs');
const fox=path.join(root,'examples/fox/creatures/fox.ashfox'),sword=path.join(root,'examples/items/src/iron_sword.ashfox');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'ashfox-capture-test-'));
const run=(args,options={})=>spawnSync(process.execPath,[cli,...args],{cwd:temp,timeout:150000,maxBuffer:64*1024*1024,...options});
const success=result=>{assert.equal(result.status,0,result.stderr.toString());assert.equal(result.stderr.length,0);return result.stdout;};
const png=(bytes,width,height)=>{assert.equal(bytes.subarray(1,4).toString(),'PNG');assert.equal(bytes.readUInt32BE(16),width);assert.equal(bytes.readUInt32BE(20),height);};
async function main(){
  const left=success(run(['capture',fox,'--camera','left','--width','160','--height','128']));png(left,160,128);
  const isolated=path.join(temp,'ashfox.cjs');fs.copyFileSync(cli,isolated);
  const cold=success(spawnSync(process.execPath,[isolated,'capture',fox,'--camera','left','--width','160','--height','128'],{cwd:temp,timeout:120000,maxBuffer:64*1024*1024}));
  assert.deepEqual(cold,left,'The self-contained binary reproduces pixels in the same renderer profile');fs.unlinkSync(isolated);
  const right=success(run(['capture',fox,'--camera','right','--width','160','--height','128']));assert.notDeepEqual(left,right);
  const orbit=success(run(['capture',fox,'--azimuth','45','--elevation','20','--background','transparent']));png(orbit,640,360);
  const idat=[];for(let offset=8;offset<orbit.length;){const length=orbit.readUInt32BE(offset);if(orbit.toString('ascii',offset+4,offset+8)==='IDAT')idat.push(orbit.subarray(offset+8,offset+8+length));offset+=12+length;}
  assert.equal(orbit[25],6);assert.equal(inflateSync(Buffer.concat(idat))[4],0,'Transparent corner retains alpha');
  const sprite=success(run(['capture',sword,'--scale','16','--background','checker']));png(sprite,256,256);
  const stage=success(run(['capture',sword,'--stage','silhouette','--scale','16','--background','checker']));assert.notDeepEqual(sprite,stage);
  const raw=success(run(['export',sword]));const fromStdin=success(run(['capture','--stdin','--input-format','png','--scale','2'],{input:raw}));png(fromStdin,32,32);
  const gif=success(run(['replay',fox,'--clip','tail_wag','--duration','0.5','--fps','4','--width','160','--height','128']));assert.equal(gif.subarray(0,6).toString(),'GIF89a');
  const build=success(run(['replay',path.join(root,'examples/minecraft/marker.ashfox'),'--mode','build']));assert.equal(build.subarray(0,6).toString(),'GIF89a');
  const bad=run(['capture',fox,'--clip','nonexistent']);assert.notEqual(bad.status,0);assert.equal(bad.stdout.length,0);
  const noBrowser=run(['capture',fox],{env:{...process.env,ASHFOX_CHROME_PATH:'/not/a/browser'}});
  // Explicit invalid executable must fail, without searching another installation.
  assert.notEqual(noBrowser.status,0);assert.equal(noBrowser.stdout.length,0);
  const sound=path.join(root,'examples/sounds/src/claw_hit.ashfox');
  const wave=success(run(['capture',sound,'--width','320','--height','128']));png(wave,320,128);
  const child=spawn(process.execPath,[cli,'stdio'],{cwd:temp,stdio:['pipe','pipe','pipe']});
  let buffer='';const pending=new Map();
  child.stdout.on('data',chunk=>{buffer+=chunk;let end;while((end=buffer.indexOf('\n'))>=0){const reply=JSON.parse(buffer.slice(0,end));buffer=buffer.slice(end+1);pending.get(reply.id)?.(reply);pending.delete(reply.id);}});
  const request=(id,method,params={})=>new Promise(resolve=>{pending.set(id,resolve);child.stdin.write(JSON.stringify({id,method,params})+'\n');});
  assert.equal((await request('load','load',{input:{file:fox}})).ok,true);
  const running=request('render','replay',{options:{clip:'idle',duration:10,fps:30}});
  await new Promise(resolve=>setTimeout(resolve,100));
  assert.equal((await request('cancel','cancel',{id:'render'})).result.cancelled,true);
  assert.equal((await running).ok,false);
  assert.equal((await request('inspect','inspect')).ok,true);
  const recovered=await request('capture','capture',{options:{width:160,height:128,camera:'front'}});assert.equal(recovered.ok,true,JSON.stringify(recovered));
  png(Buffer.from(recovered.result.data,'base64'),160,128);
  const exit=new Promise(resolve=>child.once('exit',resolve));child.stdin.end();assert.equal(await exit,0);
  assert.deepEqual(fs.readdirSync(temp),[],'No implicit asset files or workspace');
  fs.writeFileSync('/tmp/ashfox-observer-fox.png',orbit);fs.writeFileSync('/tmp/ashfox-observer-sword.png',sprite);fs.writeFileSync('/tmp/ashfox-observer-motion.gif',gif);fs.writeFileSync('/tmp/ashfox-observer-wave.png',wave);
  console.log('Real headless captures: camera/alpha, sprite stages, PNG stdin, motion/build GIF, waveform, cancellation and recovery passed');
}
main().finally(()=>fs.rmSync(temp,{recursive:true,force:true})).catch(error=>{console.error(error);process.exitCode=1;});
