import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
const status=document.querySelector('#status');
try {
  const url=new URL('/game-assets/assets.json',location.href);
  const response=await fetch(url);if(!response.ok)throw new Error('Build the assets first with npm run assets');
  const manifest=await response.json();if(manifest.format!=='ashfox-game-assets'||manifest.version!==1)throw new Error('Unsupported asset manifest');
  const asset=id=>{const result=manifest.assets.find(a=>a.id===id);if(!result)throw new Error('Missing '+id);return result;};
  const file=p=>new URL(p,url).href;
  const canvas=document.querySelector('canvas');
  const renderer=new THREE.WebGLRenderer({canvas,antialias:true});renderer.setSize(960,460,false);
  const scene=new THREE.Scene();scene.background=new THREE.Color('#222b31');
  scene.add(new THREE.HemisphereLight(0xffffff,0x334455,2));const light=new THREE.DirectionalLight(0xffffff,3);light.position.set(3,5,4);scene.add(light);
  const loader=new GLTFLoader();
  const creature=asset('creature.griffin');
  const model=await loader.loadAsync(file(creature.model));
  model.scene.scale.setScalar(creature.unitsPerMeter);
  scene.add(model.scene);
  const bounds=new THREE.Box3().setFromObject(scene),center=bounds.getCenter(new THREE.Vector3()),size=bounds.getSize(new THREE.Vector3()).length();
  const camera=new THREE.PerspectiveCamera(40,960/460,0.01,1000);camera.position.copy(center).add(new THREE.Vector3(size*.8,size*.5,size));camera.lookAt(center);
  const mixer=new THREE.AnimationMixer(model.scene);let action;
  const select=document.querySelector('#clips');
  for(const clip of model.animations){const option=document.createElement('option');option.value=clip.name;option.textContent=clip.name;select.append(option);}
  const play=()=>{action?.stop();const clip=model.animations.find(c=>c.name===select.value);if(clip){action=mixer.clipAction(clip);action.play();}};select.onchange=play;play();
  const item=asset('item.iron_sword');document.querySelector('#item').src=file(item.image);
  const sound=asset('sfx.claw_hit');let variant=0, activeAudio;
  window.addEventListener('pagehide',()=>activeAudio?.pause());
  const button=document.querySelector('#sound');button.disabled=false;
  button.onclick=async()=>{const chosen=sound.variants[variant++%sound.variants.length];try{activeAudio?.pause();activeAudio=new Audio(file(chosen.file));activeAudio.loop=chosen.playback.kind==='loop';await activeAudio.play();status.textContent='Played '+chosen.id;}catch(error){status.textContent=error.message;}};
  const clock=new THREE.Clock();renderer.setAnimationLoop(()=>{mixer.update(Math.min(clock.getDelta(),.1));renderer.render(scene,camera);});
  status.textContent=`Loaded 1 model, ${model.animations.length} motions, 1 item and ${sound.variants.length} sound variants. Click Play to hear audio.`;
} catch(error) {status.textContent=error.message;}
