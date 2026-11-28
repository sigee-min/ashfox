import * as THREE from 'three';
import { createStudioIbl, configureStudioRenderer } from './viewer/ibl.js';
import { createStudioStage } from './viewer/scene.js';
import { createStudioControls, createMotionController } from './viewer/controls.js';
import { createLodController } from './viewer/lod.js';
import { loadGlbFromCache } from './viewer/cache.js';

const siteCopy = (() => {
  try {
    return JSON.parse(document.body.dataset.siteCopy || '{}');
  } catch {
    return {};
  }
})();

const bindLegacyDomControls = (scope, motion, ctrl, clips, reducedQuery, onUpdate) => {
  if (!scope) return;
  const syncPressed = (name) => {
    for (const btn of scope.querySelectorAll('[data-model-motion]')) {
      btn.setAttribute('aria-pressed', String(btn.dataset.modelMotion === name));
    }
  };
  for (const btn of scope.querySelectorAll('[data-model-motion]')) {
    btn.disabled = false;
    btn.onclick = () => {
      syncPressed(motion.select(btn.dataset.modelMotion, true));
      onUpdate();
    };
  }
  for (const btn of scope.querySelectorAll('[data-model-view]')) {
    btn.disabled = false;
    btn.onclick = () => {
      ctrl.setAngle(btn.dataset.modelView);
      onUpdate();
    };
  }
  if (clips.length) {
    syncPressed(motion.getState().activeClip);
    if (reducedQuery.matches) motion.setPlaying(false);
  }
};

const createStudioController = (host, initialOptions = {}) => {
  const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
  const renderer = new THREE.WebGLRenderer({
    alpha: true,
    antialias: true,
    preserveDrawingBuffer: true,
  });
  configureStudioRenderer(renderer);
  renderer.setClearColor(0x000000, 0);
  renderer.domElement.setAttribute('aria-label', siteCopy.previewLabel || 'Interactive 3D model');
  for (const prev of host.querySelectorAll('canvas')) prev.remove();
  host.append(renderer.domElement);

  const scene = new THREE.Scene();
  const ibl = createStudioIbl(renderer, scene);
  const stage = createStudioStage(scene, renderer, host);
  const studioControls = createStudioControls(renderer, host, reducedQuery);
  const lod = createLodController();
  const motion = createMotionController(reducedQuery);
  const clock = new THREE.Clock();

  let currentModel = null;
  let currentSrc = '';
  let currentDomain = initialOptions.domain || 'model';
  let onStateCb = typeof initialOptions.onState === 'function' ? initialOptions.onState : null;
  let visible = true;
  let loading = false;
  let ready = false;
  let errorMsg = null;
  let contextLost = false;
  let disposed = false;
  let loadSeq = 0;
  let abortCtrl = null;
  let lastTimelineEmit = 0;

  const getState = () => ({
    src: currentSrc,
    domain: currentDomain,
    loading,
    ready,
    error: errorMsg,
    contextLost,
    fullscreen: document.fullscreenElement === host,
    ...motion.getState(),
    ...stage.getState(),
    ...studioControls.getState(),
    ...lod.getState(),
  });

  const emitState = () => {
    if (disposed || !onStateCb) return;
    try {
      onStateCb(getState());
    } catch {
      // Ignore external listener errors so the render loop stays alive.
    }
  };

  const clearCurrentModel = () => {
    motion.dispose();
    lod.reset();
    if (!currentModel) return;
    scene.remove(currentModel);
    stage.disposeModel(currentModel);
    currentModel = null;
  };

  const load = async (src, opts = {}) => {
    if (disposed) return null;
    const seq = ++loadSeq;
    abortCtrl?.abort();
    abortCtrl = new AbortController();
    if (typeof opts.onState === 'function') onStateCb = opts.onState;
    const onProgress = typeof opts.onProgress === 'function' ? opts.onProgress : null;
    const domain = opts.domain || currentDomain || 'model';
    const status =
      opts.statusEl !== undefined ? opts.statusEl : document.querySelector('[data-model-status]');
    const fallback = host.querySelector('img');

    currentSrc = src;
    currentDomain = domain;
    if (opts.backdrop !== undefined) stage.setBackdrop(opts.backdrop);
    if (typeof opts.grid === 'boolean') stage.setGrid(opts.grid);
    if (typeof opts.wireframe === 'boolean') stage.setWireframe(opts.wireframe);
    if (typeof opts.autoRotate === 'boolean') studioControls.setAutoRotate(opts.autoRotate);
    loading = true;
    ready = false;
    errorMsg = null;
    delete host.dataset.ready;
    emitState();

    try {
      const gltf = await loadGlbFromCache(src, { onProgress, signal: abortCtrl.signal });
      if (disposed || seq !== loadSeq) return null;
      clearCurrentModel();
      currentModel = gltf.scene;
      scene.add(currentModel);

      const bounds = stage.attachModel(currentModel, domain);
      studioControls.frameBounds(bounds, {
        domain,
        enableZoom: opts.enableZoom ?? initialOptions.enableZoom ?? false,
        enablePan: opts.enablePan ?? initialOptions.enablePan,
      });
      lod.attachModel(currentModel, bounds);
      motion.attach(currentModel, gltf.animations);

      const dims = studioControls.resize();
      renderer.setSize(dims.w, dims.h);
      if (opts.controlsRoot !== null) {
        bindLegacyDomControls(
          opts.controlsRoot || document,
          motion,
          studioControls,
          gltf.animations,
          reducedQuery,
          emitState,
        );
      }

      if (fallback) fallback.hidden = true;
      host.dataset.ready = 'true';
      if (status) status.textContent = siteCopy.dragModel || '';
      loading = false;
      ready = true;
      emitState();
      renderer.render(scene, studioControls.camera);
      return getState();
    } catch (err) {
      if (err?.name === 'AbortError' || disposed || seq !== loadSeq) return null;
      loading = false;
      ready = false;
      errorMsg = err?.message || 'Failed to load 3D asset';
      if (fallback) fallback.hidden = false;
      if (status) status.textContent = siteCopy.modelFailed || '';
      emitState();
      return null;
    }
  };

  const resizeObs = new ResizeObserver(() => {
    const next = studioControls.resize();
    renderer.setSize(next.w, next.h);
  });
  resizeObs.observe(host);
  const visObs = new IntersectionObserver((entries) => {
    visible = entries[0]?.isIntersecting ?? true;
  });
  visObs.observe(host);

  const cleanups = [() => resizeObs.disconnect(), () => visObs.disconnect()];
  const listen = (target, type, fn) => {
    target.addEventListener(type, fn);
    cleanups.push(() => target.removeEventListener(type, fn));
  };
  listen(reducedQuery, 'change', () => {
    studioControls.syncAutoRotate();
    emitState();
  });
  listen(document, 'fullscreenchange', emitState);
  listen(renderer.domElement, 'webglcontextlost', (e) => {
    e.preventDefault();
    contextLost = true;
    emitState();
  });
  listen(renderer.domElement, 'webglcontextrestored', () => {
    contextLost = false;
    ibl.rebake();
    emitState();
  });

  renderer.setAnimationLoop(() => {
    if (disposed || contextLost || !visible || document.hidden) return;
    const delta = Math.min(clock.getDelta(), 0.05);
    motion.update(delta);
    studioControls.update(delta);
    if (lod.update(studioControls.camera.position)) emitState();
    renderer.render(scene, studioControls.camera);

    const mState = motion.getState();
    if (mState.playing && mState.duration > 0) {
      const now = performance.now();
      if (now - lastTimelineEmit >= 80) {
        lastTimelineEmit = now;
        emitState();
      }
    }
  });

  const emitAfter =
    (fn) =>
    (...args) => {
      fn(...args);
      if (!disposed && !contextLost && ready) {
        renderer.render(scene, studioControls.camera);
      }
      emitState();
    };

  return {
    host,
    load,
    setWireframe: emitAfter(stage.setWireframe),
    setGrid: emitAfter(stage.setGrid),
    setAutoRotate: emitAfter(studioControls.setAutoRotate),
    setBackdrop: emitAfter(stage.setBackdrop),
    setCameraPreset: emitAfter(studioControls.setPreset),
    setView: emitAfter(studioControls.setAngle),
    setLod: emitAfter(lod.setLod),
    setClip: emitAfter((name) => motion.select(name, true)),
    playClip: emitAfter((name) => motion.select(name, true)),
    setPlaying: emitAfter(motion.setPlaying),
    setSpeed: emitAfter(motion.setSpeed),
    seek: emitAfter(motion.seek),
    replay: emitAfter(motion.replay),
    toggleFullscreen: async () => {
      if (document.fullscreenElement === host) await document.exitFullscreen?.();
      else if (host.requestFullscreen) await host.requestFullscreen();
      emitState();
    },
    get clips() {
      return motion.getState().clips;
    },
    getState,
    dispose: () => {
      if (disposed) return;
      disposed = true;
      ++loadSeq;
      abortCtrl?.abort();
      renderer.setAnimationLoop(null);
      for (const fn of cleanups) fn();
      clearCurrentModel();
      stage.dispose();
      studioControls.dispose();
      ibl.dispose();
      renderer.dispose();
      renderer.domElement.remove();
      delete host.dataset.ready;
    },
  };
};

let activeInstance = null;
let mountSeq = 0;

window.ashfoxViewer = {
  mount: async (host, modelSrc, options = {}) => {
    if (!host) return null;
    const seq = ++mountSeq;
    if (activeInstance && activeInstance.host === host) {
      const state = await activeInstance.load(modelSrc, options);
      return seq === mountSeq && state ? activeInstance : null;
    }
    activeInstance?.dispose();
    activeInstance = null;
    const next = createStudioController(host, options);
    activeInstance = next;
    const state = await next.load(modelSrc, options);
    if (seq !== mountSeq) {
      if (activeInstance === next) activeInstance = null;
      next.dispose();
      return null;
    }
    return state ? activeInstance : null;
  },
};

const initialHost = document.querySelector('[data-live-model]');
if (initialHost?.dataset.modelSrc) {
  void window.ashfoxViewer.mount(initialHost, initialHost.dataset.modelSrc);
}
