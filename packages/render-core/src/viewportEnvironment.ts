import * as THREE from 'three';

export type ViewportEnvironmentId =
  | 'studio'
  | 'day'
  | 'evening'
  | 'night';

export interface ViewportEnvironmentOption {
  id: ViewportEnvironmentId;
  label: string;
  detail: string;
}

export const VIEWPORT_ENVIRONMENTS: readonly ViewportEnvironmentOption[] = [
  {
    id: 'studio',
    label: 'Studio',
    detail: 'Neutral inspection light'
  },
  {
    id: 'day',
    label: 'Day',
    detail: 'Clear daylight sky'
  },
  {
    id: 'evening',
    label: 'Evening',
    detail: 'Warm sunset sky'
  },
  {
    id: 'night',
    label: 'Night',
    detail: 'Deep night sky'
  }
];

export interface ViewportEnvironment {
  id: ViewportEnvironmentId;
  background: THREE.Color | THREE.Texture;
  fog: THREE.Fog;
  dispose: () => void;
}

const createGradientTexture = (
  top: string,
  middle: string,
  bottom: string
): THREE.CanvasTexture => {
  const canvas = window.document.createElement('canvas');
  canvas.width = 16;
  canvas.height = 256;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Sky canvas is unavailable.');
  const gradient = context.createLinearGradient(0, 0, 0, canvas.height);
  gradient.addColorStop(0, top);
  gradient.addColorStop(0.58, middle);
  gradient.addColorStop(1, bottom);
  context.fillStyle = gradient;
  context.fillRect(0, 0, canvas.width, canvas.height);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  return texture;
};

export const createViewportEnvironment = (
  id: ViewportEnvironmentId
): ViewportEnvironment => {
  let background: THREE.Color | THREE.Texture;
  let fog: THREE.Fog;

  if (id === 'studio') {
    background = new THREE.Color('#171b20');
    // Studio is the inspection environment: even the largest authored demo
    // must keep its far-side face, eyes, and silhouette readable.
    fog = new THREE.Fog('#171b20', 320, 640);
  } else if (id === 'day') {
    background = createGradientTexture('#4389d2', '#80bcef', '#d9eeff');
    fog = new THREE.Fog('#c7e1f4', 140, 280);
  } else if (id === 'evening') {
    background = createGradientTexture('#4b3a73', '#c96f68', '#f2b36f');
    fog = new THREE.Fog('#c38a7b', 140, 280);
  } else {
    background = createGradientTexture('#050812', '#111d36', '#2b3d59');
    fog = new THREE.Fog('#17243a', 140, 280);
  }

  return {
    id,
    background,
    fog,
    dispose: () => {
      if (background instanceof THREE.Texture) background.dispose();
    }
  };
};

export const addViewportLighting = (scene: THREE.Scene): void => {
  scene.add(new THREE.HemisphereLight('#dfe9ff', '#22242a', 1.45));

  const keyLight = new THREE.DirectionalLight('#fff3df', 2.7);
  keyLight.position.set(14, 26, -18);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  keyLight.shadow.camera.near = 0.1;
  keyLight.shadow.camera.far = 120;
  keyLight.shadow.camera.left = -28;
  keyLight.shadow.camera.right = 28;
  keyLight.shadow.camera.top = 32;
  keyLight.shadow.camera.bottom = -10;
  scene.add(keyLight);

  const rimLight = new THREE.DirectionalLight('#7fa8ff', 1.1);
  rimLight.position.set(-18, 12, 16);
  scene.add(rimLight);
};
