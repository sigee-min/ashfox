const siteCopy = JSON.parse(document.body.dataset.siteCopy);
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
    renderer.domElement.setAttribute('aria-label', siteCopy.previewLabel);
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
    const model = await new GLTFLoader().loadAsync(host.dataset.modelSrc);
    scene.add(model.scene);
    const revealParts = [];
    model.scene.traverse(node => {
      if (node.isMesh) revealParts.push({ node, scale: node.scale.clone(), height: node.getWorldPosition(new THREE.Vector3()).y });
    });
    revealParts.sort((a, b) => a.height - b.height);
    let revealTime = reduced.matches ? 2 : 0;
    let revealed = reduced.matches;
    const finishReveal = () => { revealTime = 2; };
    host.addEventListener('pointerdown', finishReveal, { once: true });
    const bounds = new THREE.Box3().setFromObject(model.scene);
    const center = bounds.getCenter(new THREE.Vector3());
    const radius = bounds.getSize(new THREE.Vector3()).length() * .5;
    controls.target.copy(center);
    let framingDistance = 0;
    const fitDistance = () => radius * (host.clientWidth / host.clientHeight < 1 ? 2.8 : 2.5);
    const resize = () => {
      const w = host.clientWidth, h = host.clientHeight;
      renderer.setSize(w, h); camera.aspect = w / h; camera.updateProjectionMatrix();
      const nextDistance = fitDistance();
      if (framingDistance) camera.position.sub(controls.target).multiplyScalar(nextDistance / framingDistance).add(controls.target);
      framingDistance = nextDistance;
      controls.update();
    };
    const view = angle => {
      const distance = fitDistance();
      camera.position.copy(center).add(new THREE.Vector3(Math.sin(angle) * distance, distance * .28, Math.cos(angle) * distance));
      controls.update();
    };
    resize(); view(Math.PI + .65);
    new ResizeObserver(resize).observe(host);
    const mixer = new THREE.AnimationMixer(model.scene);
    let action, playing = !reduced.matches, visible = true;
    const choose = name => {
      const clip = model.animations.find(c => c.name === name);
      if (!clip) return;
      const next = mixer.clipAction(clip);
      if (action === next) action.reset().play();
      else {
        if (reduced.matches) action?.stop(); else action?.fadeOut(.25);
        action = next; action.reset(); if (!reduced.matches) action.fadeIn(.25); action.play();
      }
      for (const button of document.querySelectorAll('[data-model-motion]')) button.setAttribute('aria-pressed', String(button.dataset.modelMotion === name));
    };
    for (const button of document.querySelectorAll('[data-model-motion]')) {
      button.disabled = false;
      button.onclick = () => { finishReveal(); choose(button.dataset.modelMotion); playing = true; };
    }
    for (const button of document.querySelectorAll('[data-model-view]')) {
      button.disabled = false; button.onclick = () => { finishReveal(); view(Number(button.dataset.modelView)); };
    }
    reduced.addEventListener('change', () => { finishReveal(); playing = !reduced.matches; });
    choose('wing_display');
    if (!revealed) for (const part of revealParts) part.node.scale.setScalar(0);
    const clock = new THREE.Clock();
    new IntersectionObserver(entries => { visible = entries[0].isIntersecting; }).observe(host);
    renderer.setAnimationLoop(() => {
      const delta = Math.min(clock.getDelta(), .05);
      if (!visible || document.hidden) return;
      if (playing) mixer.update(delta);
      if (!revealed) {
        revealTime = Math.min(2, revealTime + delta);
        for (let index = 0; index < revealParts.length; index++) {
          const part = revealParts[index];
          const progress = Math.min(1, Math.max(0, (revealTime - index / revealParts.length * .55) / .7));
          part.node.scale.copy(part.scale).multiplyScalar(1 - (1 - progress) ** 3);
        }
        revealed = revealTime >= 1.25;
      }
      controls.update(); renderer.render(scene, camera);
    });
    renderer.render(scene, camera); fallback.hidden = true;
    host.dataset.ready = 'true'; status.textContent = siteCopy.dragModel;
    renderer.domElement.addEventListener('webglcontextlost', event => {
      event.preventDefault(); fallback.hidden = false; renderer.domElement.hidden = true;
      status.textContent = siteCopy.contextLost;
      for (const button of document.querySelectorAll('[data-model-motion], [data-model-view]')) button.disabled = true;
    });
  } catch {
    renderer?.dispose(); renderer?.domElement.remove(); fallback.hidden = false;
    status.textContent = siteCopy.modelFailed;
  }
})();
