import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

const siteCopy = (() => {
  try {
    return JSON.parse(document.body.dataset.siteCopy || '{}');
  } catch {
    return {};
  }
})();

const addStudioLights = (scene) => {
  scene.add(new THREE.HemisphereLight(0xf6f8fc, 0x2a303c, 2.2));
  for (const [color, intensity, position] of [
    [0xffffff, 2.6, [4, 6, 5]],
    [0xdce4f0, 1.8, [-4, 3, -3]],
  ]) {
    const light = new THREE.DirectionalLight(color, intensity);
    light.position.set(...position);
    scene.add(light);
  }
};

const setupCameraFrame = (modelScene, camera, controls, host) => {
  const bounds = new THREE.Box3().setFromObject(modelScene);
  const center = bounds.getCenter(new THREE.Vector3());
  const radius = Math.max(0.25, bounds.getSize(new THREE.Vector3()).length() * 0.5);
  controls.target.copy(center);
  let framingDistance = 0;
  const fitDistance = () => {
    const aspect = host.clientWidth / Math.max(1, host.clientHeight);
    return radius * (aspect < 1 ? 2.8 : aspect >= 1.2 ? 2.1 : 2.45);
  };
  const resize = () => {
    const w = host.clientWidth || 320;
    const h = host.clientHeight || 280;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const nextDistance = fitDistance();
    if (framingDistance) {
      camera.position
        .sub(controls.target)
        .multiplyScalar(nextDistance / framingDistance)
        .add(controls.target);
    }
    framingDistance = nextDistance;
    controls.update();
    return { w, h };
  };
  const setAngle = (angle) => {
    const distance = fitDistance();
    camera.position
      .copy(center)
      .add(
        new THREE.Vector3(Math.sin(angle) * distance, distance * 0.28, Math.cos(angle) * distance),
      );
    controls.update();
  };
  return { resize, setAngle };
};

const createMotionPlayer = (mixer, clips, reduced) => {
  let action = null;
  const choose = (name) => {
    const clip = clips.find((c) => c.name === name) || clips[0];
    if (!clip) return;
    const next = mixer.clipAction(clip);
    if (action === next) {
      action.reset().play();
      return;
    }
    if (reduced.matches) action?.stop();
    else action?.fadeOut(0.22);
    action = next;
    action.reset();
    if (!reduced.matches) action.fadeIn(0.22);
    action.play();
  };
  return { choose };
};

const createRenderer = (host) => {
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.setClearColor(0, 0);
  renderer.domElement.setAttribute('aria-label', siteCopy.previewLabel || 'Interactive 3D model');
  for (const prev of host.querySelectorAll('canvas')) prev.remove();
  host.append(renderer.domElement);
  return renderer;
};

const bindViewerControls = (scope, frame, player, onPlay, clips, reduced) => {
  const bindMotion = (name, start) => {
    player.choose(name);
    if (start) onPlay(true);
    for (const btn of scope.querySelectorAll('[data-model-motion]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.modelMotion === name));
    }
  };
  for (const btn of scope.querySelectorAll('[data-model-motion]')) {
    btn.disabled = false;
    btn.onclick = () => bindMotion(btn.dataset.modelMotion, true);
  }
  for (const btn of scope.querySelectorAll('[data-model-view]')) {
    btn.disabled = false;
    btn.onclick = () => frame.setAngle(Number(btn.dataset.modelView));
  }
  if (clips.length) {
    const preferred = clips.find((c) => c.name === 'wing_display')?.name || clips[0].name;
    bindMotion(preferred, !reduced.matches);
  }
  return bindMotion;
};

const createViewerControls = (renderer, enableZoom) => {
  const controls = new OrbitControls(
    new THREE.PerspectiveCamera(34, 1, 0.01, 1000),
    renderer.domElement,
  );
  controls.enablePan = false;
  controls.enableZoom = Boolean(enableZoom);
  controls.enableDamping = true;
  controls.minPolarAngle = 0.35;
  controls.maxPolarAngle = 2.4;
  return { camera: controls.object, controls };
};

const observeViewerHost = (host, frame, renderer, onVisibility) => {
  const resizeObs = new ResizeObserver(() => {
    const next = frame.resize();
    renderer.setSize(next.w, next.h);
  });
  resizeObs.observe(host);
  const visObs = new IntersectionObserver((entries) => {
    onVisibility(entries[0]?.isIntersecting ?? true);
  });
  visObs.observe(host);
  return () => {
    resizeObs.disconnect();
    visObs.disconnect();
  };
};

const startViewerLoop = (renderer, scene, camera, controls, mixer, isActive) => {
  const clock = new THREE.Clock();
  renderer.setAnimationLoop(() => {
    const state = isActive();
    if (!state.visible || document.hidden) return;
    const delta = Math.min(clock.getDelta(), 0.05);
    if (state.playing) mixer.update(delta);
    controls.update();
    renderer.render(scene, camera);
  });
  renderer.render(scene, camera);
};

const mountModel = async (host, modelSrc, options = {}) => {
  const fallback = host.querySelector('img');
  const status = options.statusEl || document.querySelector('[data-model-status]');
  const reduced = matchMedia('(prefers-reduced-motion: reduce)');
  const renderer = createRenderer(host);
  const scene = new THREE.Scene();
  addStudioLights(scene);
  const { camera, controls } = createViewerControls(renderer, options.enableZoom);
  const model = await new GLTFLoader().loadAsync(modelSrc);
  scene.add(model.scene);
  const frame = setupCameraFrame(model.scene, camera, controls, host);
  const dims = frame.resize();
  renderer.setSize(dims.w, dims.h);
  frame.setAngle(Math.PI + 0.65);

  const mixer = new THREE.AnimationMixer(model.scene);
  const player = createMotionPlayer(mixer, model.animations, reduced);
  let playing = !reduced.matches;
  let visible = true;
  const playClip = bindViewerControls(
    options.controlsRoot || document,
    frame,
    player,
    (v) => {
      playing = v;
    },
    model.animations,
    reduced,
  );
  if (!playing) mixer.update(0);

  const disconnectObservers = observeViewerHost(host, frame, renderer, (nextVisible) => {
    visible = nextVisible;
  });
  startViewerLoop(renderer, scene, camera, controls, mixer, () => ({ playing, visible }));
  if (fallback) fallback.hidden = true;
  host.dataset.ready = 'true';
  if (status) status.textContent = siteCopy.dragModel || '';

  return {
    clips: model.animations.map((c) => c.name),
    playClip: (name) => playClip(name, true),
    setView: frame.setAngle,
    dispose: () => {
      renderer.setAnimationLoop(null);
      disconnectObservers();
      controls.dispose();
      renderer.dispose();
      renderer.domElement.remove();
    },
  };
};

let activeInstance = null;
let mountSeq = 0;
window.ashfoxViewer = {
  mount: async (host, modelSrc, options = {}) => {
    const seq = ++mountSeq;
    activeInstance?.dispose();
    activeInstance = null;
    delete host.dataset.ready;
    try {
      const next = await mountModel(host, modelSrc, options);
      if (seq !== mountSeq) {
        next.dispose();
        return null;
      }
      activeInstance = next;
      return activeInstance;
    } catch {
      if (seq !== mountSeq) return null;
      const fallback = host.querySelector('img');
      if (fallback) fallback.hidden = false;
      const status = options.statusEl || document.querySelector('[data-model-status]');
      if (status) status.textContent = siteCopy.modelFailed || '';
      return null;
    }
  },
};

const initialHost = document.querySelector('[data-live-model]');
if (initialHost?.dataset.modelSrc) {
  void window.ashfoxViewer.mount(initialHost, initialHost.dataset.modelSrc);
}
