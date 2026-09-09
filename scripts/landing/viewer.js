import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
const host = document.querySelector('[data-live-model]');
if (host) void (async () => {
  const fallback = host.querySelector('img');
  const status = document.querySelector('[data-model-status]');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  let renderer;
  try {
    renderer = new THREE.WebGLRenderer({ alpha: true, antialias: true });
    renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    renderer.setClearColor(0, 0);
    renderer.domElement.setAttribute('aria-label', 'Griffin 3D preview. Drag to rotate; use view buttons for keyboard control.');
    host.append(renderer.domElement);
    const scene = new THREE.Scene();
    scene.add(new THREE.HemisphereLight(0xffefda, 0x394656, 2.6));
    for (const [color, intensity, position] of [[0xfff1d5, 3, [3, 5, 5]], [0xffad66, 5, [-4, 3, -3]]]) {
      const light = new THREE.DirectionalLight(color, intensity); light.position.set(...position); scene.add(light);
    }
    const camera = new THREE.PerspectiveCamera(34, 1, .01, 1000);
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enablePan = false; controls.enableZoom = false; controls.enableDamping = true;
    controls.minPolarAngle = .35; controls.maxPolarAngle = 2.4;
    const model = await new GLTFLoader().loadAsync('/media/landing/griffin.glb');
    scene.add(model.scene);
    const bounds = new THREE.Box3().setFromObject(model.scene);
    const center = bounds.getCenter(new THREE.Vector3());
    const radius = bounds.getSize(new THREE.Vector3()).length() * .5;
    controls.target.copy(center);
    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
    };
    const view = angle => {
      const distance = radius * 3.15;
      camera.position.copy(center).add(new THREE.Vector3(Math.sin(angle) * distance, distance * .28, Math.cos(angle) * distance));
      controls.update();
    };
    resize(); view(Math.PI + .65);
    new ResizeObserver(resize).observe(host);
    const mixer = new THREE.AnimationMixer(model.scene);
    let action, playing = !reduced.matches, visible = true;
    const pause = document.querySelector('[data-model-pause]');
    const choose = name => {
      const clip = model.animations.find(c => c.name === name);
      if (!clip) return;
      const next = mixer.clipAction(clip);
      if (action !== next) {
        if (reduced.matches) action?.stop(); else action?.fadeOut(.25);
        action = next; action.reset(); if (!reduced.matches) action.fadeIn(.25); action.play();
      }
      for (const button of document.querySelectorAll('[data-model-motion]')) button.setAttribute('aria-pressed', String(button.dataset.modelMotion === name));
    };
    for (const button of document.querySelectorAll('[data-model-motion]')) {
      button.disabled = false;
      button.onclick = () => { choose(button.dataset.modelMotion); playing = true; pause.textContent = 'Pause'; };
    }
    for (const button of document.querySelectorAll('[data-model-view]')) {
      button.disabled = false; button.onclick = () => view(Number(button.dataset.modelView));
    }
    pause.disabled = false;
    pause.onclick = () => { playing = !playing; pause.textContent = playing ? 'Pause' : 'Play'; };
    reduced.addEventListener('change', () => { playing = !reduced.matches; pause.textContent = playing ? 'Pause' : 'Play'; });
    choose('wing_display'); pause.textContent = playing ? 'Pause' : 'Play';
    const clock = new THREE.Clock();
    new IntersectionObserver(entries => { visible = entries[0].isIntersecting; }).observe(host);
    renderer.setAnimationLoop(() => {
      const delta = Math.min(clock.getDelta(), .05);
      if (!visible || document.hidden) return;
      if (playing) mixer.update(delta);
      controls.update(); renderer.render(scene, camera);
    });
    renderer.render(scene, camera); fallback.hidden = true;
    host.dataset.ready = 'true'; status.textContent = 'Drag to look around';
    renderer.domElement.addEventListener('webglcontextlost', event => {
      event.preventDefault(); fallback.hidden = false; renderer.domElement.hidden = true;
      status.textContent = 'Showing a preview image. Reload to try again.';
      for (const button of document.querySelectorAll('[data-model-motion], [data-model-view], [data-model-pause]')) button.disabled = true;
    });
  } catch {
    renderer?.dispose(); renderer?.domElement.remove(); fallback.hidden = false;
    status.textContent = 'Preview image · Download the model to explore it';
  }
})();
