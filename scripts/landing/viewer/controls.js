import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export const CAMERA_PRESETS = Object.freeze(['iso', 'front', 'side', 'top', 'reset']);

const DEFAULT_AZIMUTH = Math.PI + 0.65;
const PRESET_ANGLES = Object.freeze({
  iso: { azimuth: DEFAULT_AZIMUTH, elevation: 0.28 },
  reset: { azimuth: DEFAULT_AZIMUTH, elevation: 0.28 },
  front: { azimuth: Math.PI, elevation: 0.14 },
  side: { azimuth: Math.PI * 1.5, elevation: 0.14 },
  top: { azimuth: Math.PI, elevation: Math.PI * 0.45 },
});

const offsetFromAngles = (azimuth, elevation, distance) => {
  const cosElev = Math.cos(elevation);
  return new THREE.Vector3(
    Math.sin(azimuth) * cosElev * distance,
    Math.sin(elevation) * distance,
    Math.cos(azimuth) * cosElev * distance,
  );
};

export const createStudioControls = (renderer, host, reducedMotionQuery) => {
  const camera = new THREE.PerspectiveCamera(34, 1, 0.01, 1000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.08;
  controls.minPolarAngle = 0.05;
  controls.maxPolarAngle = Math.PI - 0.12;
  controls.autoRotateSpeed = 1.6;

  let center = new THREE.Vector3();
  let radius = 1;
  let framingDistance = 0;
  let baseEnablePan = false;
  let shiftPanActive = false;
  let requestedAutoRotate = false;
  let activePreset = 'iso';
  let transition = null;

  const syncAutoRotate = () => {
    controls.autoRotate = Boolean(requestedAutoRotate && !reducedMotionQuery.matches);
  };

  const fitDistance = () => {
    const w = host.clientWidth || 320;
    const h = host.clientHeight || 280;
    const aspect = w / Math.max(1, h);
    return radius * (aspect < 1 ? 2.85 : aspect >= 1.2 ? 2.15 : 2.5);
  };

  const cancelTransition = () => {
    transition = null;
  };
  controls.addEventListener('start', cancelTransition);

  // Allow Shift-drag panning cleanly even when default pan is disabled on compact models.
  const onPointerDown = (event) => {
    if (event.shiftKey && !baseEnablePan) {
      shiftPanActive = true;
      controls.enablePan = true;
    }
  };
  const onPointerUp = () => {
    if (shiftPanActive) {
      shiftPanActive = false;
      controls.enablePan = baseEnablePan;
    }
  };
  renderer.domElement.addEventListener('pointerdown', onPointerDown, { capture: true });
  window.addEventListener('pointerup', onPointerUp);

  const moveCameraTo = (pos, target, instant = false) => {
    if (instant || reducedMotionQuery.matches) {
      transition = null;
      controls.target.copy(target);
      camera.position.copy(pos);
      controls.update();
      return;
    }
    transition = { pos: pos.clone(), target: target.clone() };
  };

  const frameBounds = (bounds, { domain = 'model', enableZoom = false, enablePan } = {}) => {
    center = bounds.getCenter(new THREE.Vector3());
    radius = Math.max(0.25, bounds.getSize(new THREE.Vector3()).length() * 0.5);

    baseEnablePan = enablePan !== undefined ? Boolean(enablePan) : domain === 'structure';
    controls.enablePan = baseEnablePan;
    controls.enableZoom = Boolean(enableZoom);
    controls.minDistance = Math.max(0.15, radius * 0.6);
    controls.maxDistance = Math.max(6, radius * 14);
    camera.near = Math.min(0.1, Math.max(0.005, radius * 0.02));
    camera.far = Math.max(200, radius * 80);
    camera.updateProjectionMatrix();

    framingDistance = fitDistance();
    activePreset = 'iso';
    const goal = center.clone().add(offsetFromAngles(DEFAULT_AZIMUTH, 0.28, framingDistance));
    moveCameraTo(goal, center, true);
    syncAutoRotate();
  };

  const resize = () => {
    const w = host.clientWidth || 320;
    const h = host.clientHeight || 280;
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    const nextDistance = fitDistance();
    if (framingDistance > 0 && !transition) {
      camera.position
        .sub(controls.target)
        .multiplyScalar(nextDistance / framingDistance)
        .add(controls.target);
    }
    framingDistance = nextDistance;
    controls.update();
    return { w, h };
  };

  const setPreset = (preset, instant = false) => {
    const key = PRESET_ANGLES[preset] ? preset : 'iso';
    activePreset = key;
    const { azimuth, elevation } = PRESET_ANGLES[key];
    const dist = fitDistance();
    const target = key === 'reset' ? center : controls.target;
    const goal = target.clone().add(offsetFromAngles(azimuth, elevation, dist));
    moveCameraTo(goal, target, instant);
    return activePreset;
  };

  const setAngle = (angleOrPreset) => {
    if (typeof angleOrPreset === 'string' && PRESET_ANGLES[angleOrPreset]) {
      return setPreset(angleOrPreset);
    }
    const rad = Number(angleOrPreset);
    if (Number.isNaN(rad)) return setPreset('iso');
    activePreset = 'custom';
    const dist = fitDistance();
    const goal = center
      .clone()
      .add(new THREE.Vector3(Math.sin(rad) * dist, dist * 0.28, Math.cos(rad) * dist));
    moveCameraTo(goal, center, false);
    return activePreset;
  };

  const setAutoRotate = (enabled) => {
    requestedAutoRotate = Boolean(enabled);
    syncAutoRotate();
    return controls.autoRotate;
  };

  const setInteraction = ({ enableZoom, enablePan } = {}) => {
    if (enableZoom !== undefined) controls.enableZoom = Boolean(enableZoom);
    if (enablePan !== undefined) {
      baseEnablePan = Boolean(enablePan);
      if (!shiftPanActive) controls.enablePan = baseEnablePan;
    }
  };

  const update = (delta) => {
    if (transition) {
      const alpha = 1 - Math.exp(-10 * Math.max(delta, 0.001));
      camera.position.lerp(transition.pos, alpha);
      controls.target.lerp(transition.target, alpha);
      if (
        camera.position.distanceTo(transition.pos) < radius * 0.002 &&
        controls.target.distanceTo(transition.target) < radius * 0.002
      ) {
        camera.position.copy(transition.pos);
        controls.target.copy(transition.target);
        transition = null;
      }
    }
    controls.update();
  };

  return {
    camera,
    controls,
    frameBounds,
    resize,
    setPreset,
    setAngle,
    setAutoRotate,
    setInteraction,
    syncAutoRotate,
    update,
    getState: () => ({
      autoRotate: controls.autoRotate,
      cameraPreset: activePreset,
    }),
    dispose: () => {
      controls.removeEventListener('start', cancelTransition);
      renderer.domElement.removeEventListener('pointerdown', onPointerDown, { capture: true });
      window.removeEventListener('pointerup', onPointerUp);
      controls.dispose();
    },
  };
};

export const createMotionController = (reducedQuery) => {
  let mixer = null;
  let clips = [];
  let action = null;
  let activeClip = null;
  let playing = false;
  let speed = 1;

  const dispose = () => {
    if (mixer) {
      mixer.stopAllAction();
      if (mixer.getRoot()) mixer.uncacheRoot(mixer.getRoot());
      mixer = null;
    }
    clips = [];
    action = null;
    activeClip = null;
  };

  const select = (name, start = true, instant = false) => {
    const clip = mixer && (clips.find((c) => c.name === name) || clips[0]);
    if (!clip) return null;
    const next = mixer.clipAction(clip);
    if (action !== next) {
      if (instant || reducedQuery.matches) action?.stop();
      else action?.fadeOut(0.2);
      action = next;
      if (!instant && !reducedQuery.matches) action.fadeIn(0.2);
    }
    action.reset();
    if (start) playing = true;
    action.paused = !playing;
    action.play();
    activeClip = clip.name;
    mixer.timeScale = speed;
    if (!playing) mixer.update(0);
    return activeClip;
  };

  const attach = (root, animations) => {
    dispose();
    mixer = new THREE.AnimationMixer(root);
    clips = Array.isArray(animations) ? animations : [];
    playing = clips.length > 0 && !reducedQuery.matches;
    if (!clips.length) return;
    const preferred = clips.find((c) => c.name === 'wing_display')?.name || clips[0].name;
    select(preferred, !reducedQuery.matches, true);
  };

  return {
    attach,
    select,
    setPlaying: (next) => {
      playing = Boolean(next) && clips.length > 0;
      if (action) action.paused = !playing;
    },
    setSpeed: (rate) => {
      const val = Number(rate);
      speed = Number.isFinite(val) && val > 0 ? Math.min(4, Math.max(0.1, val)) : 1;
      if (mixer) mixer.timeScale = speed;
    },
    seek: (norm01) => {
      if (!mixer || !action) return;
      action.time =
        Math.min(1, Math.max(0, Number(norm01) || 0)) * (action.getClip().duration || 0);
      const prev = mixer.timeScale;
      mixer.timeScale = 1;
      mixer.update(0);
      mixer.timeScale = prev;
    },
    replay: () => {
      if (!mixer || !clips.length) return;
      if (!action) {
        select(clips[0].name, true, true);
        return;
      }
      playing = true;
      action.reset();
      action.paused = false;
      action.play();
      mixer.timeScale = speed;
      mixer.update(0);
    },
    update: (delta) => mixer && playing && mixer.update(delta),
    getState: () => {
      const duration = action ? action.getClip().duration || 0 : 0;
      const time = action && duration > 0 ? action.time % duration : 0;
      return {
        clips: clips.map((c) => c.name),
        activeClip,
        playing,
        speed,
        time,
        duration,
        progress: duration > 0 ? Math.min(1, Math.max(0, time / duration)) : 0,
      };
    },
    dispose,
  };
};
