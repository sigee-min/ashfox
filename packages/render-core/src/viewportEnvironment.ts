import * as THREE from 'three';

export type ViewportEnvironmentId = 'studio' | 'day' | 'evening' | 'night';

export interface ViewportEnvironmentOption {
  id: ViewportEnvironmentId;
  label: string;
  detail: string;
}

export const VIEWPORT_ENVIRONMENTS: readonly ViewportEnvironmentOption[] = [
  {
    id: 'studio',
    label: 'Studio',
    detail: 'Neutral inspection light',
  },
  {
    id: 'day',
    label: 'Day',
    detail: 'Clear daylight sky',
  },
  {
    id: 'evening',
    label: 'Evening',
    detail: 'Warm sunset sky',
  },
  {
    id: 'night',
    label: 'Night',
    detail: 'Deep night sky',
  },
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
  bottom: string,
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

export const createViewportEnvironment = (id: ViewportEnvironmentId): ViewportEnvironment => {
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
    },
  };
};

export const addViewportLighting = (scene: THREE.Scene): void => {
  scene.add(new THREE.HemisphereLight('#e6efff', '#626c7d', 1.15));

  const keyLight = new THREE.DirectionalLight('#fff3e0', 1.65);
  keyLight.position.set(14, 26, -18);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.near = 0.1;
  keyLight.shadow.camera.far = 120;
  keyLight.shadow.camera.left = -28;
  keyLight.shadow.camera.right = 28;
  keyLight.shadow.camera.top = 32;
  keyLight.shadow.camera.bottom = -10;
  keyLight.shadow.bias = -0.0006;
  keyLight.shadow.normalBias = 0.02;
  scene.add(keyLight);

  const fillLight = new THREE.DirectionalLight('#cfe0ff', 0.65);
  fillLight.position.set(-16, 12, -12);
  scene.add(fillLight);

  const rimLight = new THREE.DirectionalLight('#dcebff', 0.95);
  rimLight.position.set(-12, 18, 18);
  scene.add(rimLight);
};

/** Tightens the casting key light shadow frustum around the subject bounds. */
export const fitDirectionalShadowBounds = (scene: THREE.Scene, bounds: THREE.Box3): void => {
  if (bounds.isEmpty()) return;
  const target = bounds.getCenter(new THREE.Vector3());
  const span = Math.max(bounds.getSize(new THREE.Vector3()).length() * 0.85, 3.5);
  for (const child of scene.children) {
    if (!(child instanceof THREE.DirectionalLight && child.castShadow)) continue;
    child.shadow.camera.left = -span;
    child.shadow.camera.right = span;
    child.shadow.camera.top = span;
    child.shadow.camera.bottom = -span;
    child.shadow.camera.near = 0.1;
    child.shadow.camera.far = Math.max(24, span * 4.5);
    child.shadow.bias = -0.0005;
    child.shadow.normalBias = 0.018;
    child.shadow.camera.updateProjectionMatrix();
    child.position.copy(target).add(new THREE.Vector3(span * 0.56, span * 1.04, -span * 0.72));
    child.target.position.copy(target);
    child.target.updateMatrixWorld();
  }
};

const createRadialDiscTexture = (stops: readonly (readonly [number, string])[]): THREE.Texture => {
  const canvas = window.document.createElement('canvas');
  canvas.width = 128;
  canvas.height = 128;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Contact shadow canvas is unavailable.');
  const gradient = context.createRadialGradient(64, 64, 0, 64, 64, 64);
  for (const [offset, color] of stops) gradient.addColorStop(offset, color);
  context.fillStyle = gradient;
  context.fillRect(0, 0, 128, 128);
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.generateMipmaps = false;
  return texture;
};

const addRadialDiscMesh = (
  group: THREE.Group,
  disposables: { dispose: () => void }[],
  radius: number,
  y: number,
  cx: number,
  cz: number,
  stops: readonly (readonly [number, string])[],
): void => {
  const texture = createRadialDiscTexture(stops);
  const geometry = new THREE.CircleGeometry(radius, 48);
  const material = new THREE.MeshBasicMaterial({
    map: texture,
    transparent: true,
    depthWrite: false,
    toneMapped: false,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.set(cx, y, cz);
  mesh.castShadow = false;
  mesh.receiveShadow = false;
  group.add(mesh);
  disposables.push(texture, geometry, material);
};

export interface GroundContactShadow {
  readonly object: THREE.Group;
  readonly dispose: () => void;
}

/** Creates a subtle contact shadow receiver + optional studio floor disc beneath bounds.min.y. */
export const createGroundContactShadow = (
  bounds: THREE.Box3,
  options?: { readonly studioStage?: boolean },
): GroundContactShadow => {
  const object = new THREE.Group();
  object.name = 'ashfoxGroundContactShadow';
  if (bounds.isEmpty()) return { object, dispose: () => {} };
  const center = bounds.getCenter(new THREE.Vector3());
  const size = bounds.getSize(new THREE.Vector3());
  const footprint = Math.max(size.x, size.z, 1.5);
  const groundY = bounds.min.y - 0.003;
  const disposables: { dispose: () => void }[] = [];

  if (options?.studioStage) {
    addRadialDiscMesh(object, disposables, footprint * 1.6, groundY - 0.001, center.x, center.z, [
      [0, 'rgba(46, 54, 68, 0.55)'],
      [0.55, 'rgba(34, 41, 52, 0.24)'],
      [1, 'rgba(23, 27, 32, 0)'],
    ]);
  }
  addRadialDiscMesh(object, disposables, footprint * 0.72, groundY + 0.001, center.x, center.z, [
    [0, 'rgba(5, 8, 13, 0.34)'],
    [0.55, 'rgba(5, 8, 13, 0.14)'],
    [1, 'rgba(5, 8, 13, 0)'],
  ]);

  const shadowGeometry = new THREE.PlaneGeometry(footprint * 3.2, footprint * 3.2);
  const shadowMaterial = new THREE.ShadowMaterial({
    color: '#05080d',
    opacity: 0.36,
    depthWrite: false,
  });
  const shadowMesh = new THREE.Mesh(shadowGeometry, shadowMaterial);
  shadowMesh.rotation.x = -Math.PI / 2;
  shadowMesh.position.set(center.x, groundY, center.z);
  shadowMesh.receiveShadow = true;
  shadowMesh.castShadow = false;
  object.add(shadowMesh);
  disposables.push(shadowGeometry, shadowMaterial);

  return {
    object,
    dispose: () => {
      for (const item of disposables) item.dispose();
    },
  };
};
