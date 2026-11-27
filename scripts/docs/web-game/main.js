import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';

const status = document.querySelector('#status');
const asset = (manifest, id) => {
  const result = manifest.assets.find((entry) => entry.id === id);
  if (!result) throw new Error('Missing ' + id);
  return result;
};

try {
  const url = new URL('/game-assets/assets.json', location.href);
  const response = await fetch(url);
  if (!response.ok) throw new Error('Build the assets first with npm run assets');
  const manifest = await response.json();
  if (manifest.format !== 'ashfox-game-assets' || manifest.version !== 1) {
    throw new Error('Unsupported asset manifest');
  }
  const file = (relative) => new URL(relative, url).href;
  const canvas = document.querySelector('canvas');
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setSize(960, 460, false);
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#222b31');
  scene.add(new THREE.HemisphereLight(0xffffff, 0x334455, 2));
  const light = new THREE.DirectionalLight(0xffffff, 3);
  light.position.set(3, 5, 4);
  scene.add(light);

  const creature = asset(manifest, 'creature.griffin_boss');
  const model = await new GLTFLoader().loadAsync(file(creature.model));
  model.scene.scale.setScalar(creature.unitsPerMeter);
  scene.add(model.scene);
  const bounds = new THREE.Box3().setFromObject(scene);
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3()).length();
  const camera = new THREE.PerspectiveCamera(40, 960 / 460, 0.01, 1000);
  camera.position.copy(center).add(new THREE.Vector3(size * 0.8, size * 0.5, size));
  camera.lookAt(center);

  const mixer = new THREE.AnimationMixer(model.scene);
  const select = document.querySelector('#clips');
  let action;
  const playClip = () => {
    action?.stop();
    const clip = model.animations.find((entry) => entry.name === select.value);
    if (!clip) return;
    action = mixer.clipAction(clip);
    action.play();
  };
  for (const clip of model.animations) {
    const option = document.createElement('option');
    option.value = clip.name;
    option.textContent = clip.name;
    select.append(option);
  }
  select.onchange = playClip;
  playClip();

  const item = asset(manifest, 'item.iron_sword');
  document.querySelector('#item').src = file(item.image);

  const sound = asset(manifest, 'sfx.claw_hit');
  let variant = 0;
  let activeAudio;
  window.addEventListener('pagehide', () => activeAudio?.pause());
  const button = document.querySelector('#sound');
  button.disabled = false;
  button.onclick = async () => {
    const chosen = sound.variants[variant++ % sound.variants.length];
    try {
      activeAudio?.pause();
      activeAudio = new Audio(file(chosen.file));
      activeAudio.loop = chosen.playback.kind === 'loop';
      await activeAudio.play();
      status.textContent = 'Played ' + chosen.id;
    } catch (error) {
      status.textContent = error.message;
    }
  };

  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    mixer.update(Math.min(clock.getDelta(), 0.1));
    renderer.render(scene, camera);
  });
  status.textContent = `Loaded 1 model, ${model.animations.length} motions, 1 item and ${sound.variants.length} sound variants. Click Play to hear audio.`;
} catch (error) {
  status.textContent = error.message;
}
