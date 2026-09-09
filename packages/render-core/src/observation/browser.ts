/// <reference path="../gifenc.d.ts" />
import * as THREE from 'three';
import { GIFEncoder, quantize, applyPalette } from 'gifenc';
import type { ProjectDocument } from '@ashfox/engine-core';
import { projectToThreeScene } from '../projection';
import { applyAnimationPose } from '../animationPose';
import { createCaptureSurface, disposeCaptureSurface, waitForProjectionTextures } from '../captureSurface';
import { applyCameraPreset, applySignedProjectViewPreset } from '../cameraPresets';
import { renderBuildGif } from '../capture/renderBuildGif';
import type { ViewOptions } from './contract';
interface Payload { readonly document?: ProjectDocument; readonly png?: string; readonly wave?: readonly number[] }
let loaded: Payload = {};
export const load = (payload: Payload): void => { loaded = payload; };
const base64 = (bytes: Uint8Array): string => {
  let text = '';
  for (let i=0;i<bytes.length;i+=8192) text += String.fromCharCode(...bytes.subarray(i,i+8192));
  return btoa(text);
};
const background = (context: CanvasRenderingContext2D, width: number, height: number, style: string): void => {
  context.clearRect(0,0,width,height);
  if (style === 'transparent') return;
  context.fillStyle = style === 'light' ? '#eeeeee' : '#24272d'; context.fillRect(0,0,width,height);
  if (style === 'checker') for (let y=0;y<height;y+=16) for (let x=0;x<width;x+=16) {
    context.fillStyle = ((x+y)/16)%2 ? '#bcbcbc' : '#dedede'; context.fillRect(x,y,16,16);
  }
};
const canvas2d = (width:number,height:number) => {
  const canvas=document.createElement('canvas'); canvas.width=width;canvas.height=height;
  const context=canvas.getContext('2d',{willReadFrequently:true});
  if (!context) throw new Error('2D canvas is unavailable');
  return {canvas,context};
};
export const capture = async (v:ViewOptions, replay:boolean): Promise<{mime:string;data:string}> => {
  if (!loaded.document) {
    if (replay) throw new Error('Replay requires a model');
    if (loaded.png) {
      const img=new Image();img.src='data:image/png;base64,'+loaded.png;await img.decode();
      const width=img.width*v.scale,height=img.height*v.scale;
      if(width>4096||height>4096)throw new Error('Scaled image exceeds 4096 pixels');
      const {canvas,context}=canvas2d(width,height);background(context,width,height,v.background==='environment'?'transparent':v.background);
      context.imageSmoothingEnabled=false;context.drawImage(img,0,0,width,height);
      return {mime:'image/png',data:canvas.toDataURL('image/png').split(',')[1]};
    }
    if (loaded.wave) {
      const {canvas,context}=canvas2d(v.width,v.height);background(context,v.width,v.height,v.background);
      context.strokeStyle='#dca35f';context.beginPath();
      loaded.wave.forEach((amplitude,x)=>{const px=x/(loaded.wave!.length-1)*v.width;context.moveTo(px,(1-amplitude)*v.height/2);context.lineTo(px,(1+amplitude)*v.height/2);});context.stroke();
      return {mime:'image/png',data:canvas.toDataURL('image/png').split(',')[1]};
    }
    throw new Error('No renderable asset loaded');
  }
  const model=loaded.document;
  if (replay && v.mode==='build') {
    if (v.azimuth!==undefined||v.elevation!==undefined||v.width!==640||v.height!==360||v.fps!==10||v.background!=='environment'||v.zoom!==1||v.node||v.wireframe||v.skeleton||!v.textures||v.clip||v.duration!==undefined||v.time!==0) throw new Error('Build replay uses fixed 640x360/10fps and canonical timeline; use camera/environment presets');
    if(v.camera==='back'||v.camera==='bottom')throw new Error('Build replay camera supports perspective/native/front/left/right/top');
    const result=await renderBuildGif({document:model,assets:{},environment:v.environment,cameraMode:v.camera,signal:new AbortController().signal});
    return {mime:'image/gif',data:base64(result.bytes)};
  }
  const clip=v.clip ? Object.values(model.animations).find(c=>c.id===v.clip||c.name===v.clip) : undefined;
  if(v.clip&&!clip)throw new Error('Unknown clip: '+v.clip);
  if(replay&&v.mode==='motion'&&!clip)throw new Error('Motion replay requires --clip');
  if(v.time>0&&!clip)throw new Error('A nonzero time requires --clip');
  if(clip&&v.time>clip.durationSeconds)throw new Error('Time exceeds clip duration');
  const duration=v.duration??clip?.durationSeconds??3;
  const frames=replay?Math.ceil(duration*v.fps):1;
  if(frames>300 || frames*v.width*v.height>100000000)throw new Error('Replay exceeds 300 frames or 100 million pixels');
  const projection=projectToThreeScene(model,{assets:{},showSkeleton:v.skeleton,showTextures:v.textures,showWireframe:v.wireframe});
  const surface=createCaptureSurface({width:v.width,height:v.height,cameraMode:'perspective',environment:v.environment,forward:model.settings.forward});
  const output=canvas2d(v.width,v.height);
  try {
    surface.scene.add(projection.root);await waitForProjectionTextures(projection,new AbortController().signal);
    if(v.node) {
      if(!model.scene.nodes[v.node])throw new Error('Unknown node: '+v.node);
      const selected=new Set([v.node]);
      for(let pass=0;pass<Object.keys(model.scene.nodes).length;pass++)for(const n of Object.values(model.scene.nodes))if(n.parentId&&selected.has(n.parentId))selected.add(n.id);
      for(const n of Object.values(model.scene.nodes))if(n.kind!=='bone'&&!selected.has(n.id))projection.objectsByNodeId.get(n.id)!.visible=false;
    }
    // Stable framing covers sampled poses, so motion does not pump the camera.
    const bounds=new THREE.Box3();
    for(let i=0;i<(replay&&clip?33:1);i++) {
      applyAnimationPose(model,projection,clip?.id??null,replay&&clip?clip.durationSeconds*i/32:v.time);
      projection.root.updateMatrixWorld(true);bounds.union(new THREE.Box3().setFromObject(v.node?projection.objectsByNodeId.get(v.node)!:projection.root));
    }
    const target=bounds.getCenter(new THREE.Vector3());
    const box=new THREE.Mesh(new THREE.BoxGeometry(...bounds.getSize(new THREE.Vector3()).toArray()));box.position.copy(target);
    if(v.camera==='back'||v.camera==='bottom')applySignedProjectViewPreset(surface.camera,v.camera==='back'?'rear':'down',box,model.settings.forward);
    else applyCameraPreset(surface.camera,v.camera,box,model.settings.forward);
    const distance=surface.camera.position.distanceTo(target)/v.zoom;
    box.geometry.dispose();(box.material as THREE.Material).dispose();surface.scene.fog=null;
    if(v.background!=='environment'){surface.scene.background=null;surface.renderer.setClearColor(0x000000,0);}
    const encoder=GIFEncoder();
    for(let i=0;i<frames;i++) {
      applyAnimationPose(model,projection,clip?.id??null,replay&&clip?(v.time+i/v.fps)%clip.durationSeconds:v.time);
      if(v.azimuth!==undefined||v.elevation!==undefined||(replay&&v.mode==='turntable')) {
        const a=THREE.MathUtils.degToRad((v.azimuth??45)+(replay&&v.mode==='turntable'?360*i/frames:0));
        const e=THREE.MathUtils.degToRad(v.elevation??20);
        surface.camera.up.set(0,1,0);surface.camera.position.copy(target).add(new THREE.Vector3(Math.sin(a)*Math.cos(e),Math.sin(e),-Math.cos(a)*Math.cos(e)).multiplyScalar(distance));
      }else surface.camera.position.sub(target).normalize().multiplyScalar(distance).add(target);
      surface.camera.lookAt(target);surface.renderer.render(surface.scene,surface.camera);
      background(output.context,v.width,v.height,v.background==='environment'?'transparent':v.background);
      output.context.drawImage(surface.renderCanvas,0,0);
      if(!replay)return {mime:'image/png',data:output.canvas.toDataURL('image/png').split(',')[1]};
      const rgba=output.context.getImageData(0,0,v.width,v.height).data;
      const palette=quantize(rgba,128,{format:'rgba4444'});
      const transparentIndex=palette.findIndex(color=>color.length===4&&color[3]===0);
      encoder.writeFrame(applyPalette(rgba,palette,'rgba4444'),v.width,v.height,{palette,delay:1000/v.fps,repeat:i===0?0:undefined,transparent:transparentIndex>=0,transparentIndex:transparentIndex>=0?transparentIndex:undefined,dispose:2});
      if(encoder.bytesView().length>32*1024*1024)throw new Error('GIF exceeds 32 MiB');
    }
    encoder.finish();return {mime:'image/gif',data:base64(encoder.bytes())};
  } finally {projection.dispose();disposeCaptureSurface(surface);}
};
