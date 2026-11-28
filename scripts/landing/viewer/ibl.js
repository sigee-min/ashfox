import * as THREE from 'three';

const createStudioCycloramaTexture = () => {
  const width = 512;
  const height = 256;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    const data = new Uint8Array([140, 152, 171, 255]);
    const fallback = new THREE.DataTexture(data, 1, 1, THREE.RGBAFormat);
    fallback.mapping = THREE.EquirectangularReflectionMapping;
    fallback.colorSpace = THREE.SRGBColorSpace;
    fallback.needsUpdate = true;
    return fallback;
  }

  const grad = ctx.createLinearGradient(0, 0, 0, height);
  grad.addColorStop(0.0, '#cfd8e6');
  grad.addColorStop(0.48, '#8c98ab');
  grad.addColorStop(0.54, '#737e90');
  grad.addColorStop(1.0, '#555e6c');
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, width, height);

  // Overhead softbox highlight for crisp specular read on metallic & glass PBR surfaces.
  const softbox = ctx.createRadialGradient(
    width * 0.38,
    height * 0.16,
    6,
    width * 0.38,
    height * 0.16,
    width * 0.24,
  );
  softbox.addColorStop(0.0, 'rgba(255, 252, 246, 0.92)');
  softbox.addColorStop(0.45, 'rgba(235, 242, 252, 0.36)');
  softbox.addColorStop(1.0, 'rgba(207, 216, 230, 0)');
  ctx.fillStyle = softbox;
  ctx.fillRect(0, 0, width, height * 0.52);

  // Secondary warm copper rim bounce in equirectangular upper-back quadrant.
  const rimGlow = ctx.createRadialGradient(
    width * 0.78,
    height * 0.34,
    4,
    width * 0.78,
    height * 0.34,
    width * 0.18,
  );
  rimGlow.addColorStop(0.0, 'rgba(242, 168, 120, 0.34)');
  rimGlow.addColorStop(1.0, 'rgba(242, 168, 120, 0)');
  ctx.fillStyle = rimGlow;
  ctx.fillRect(0, 0, width, height * 0.7);

  const texture = new THREE.CanvasTexture(canvas);
  texture.mapping = THREE.EquirectangularReflectionMapping;
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.magFilter = THREE.LinearFilter;
  texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
};

export const configureStudioRenderer = (renderer) => {
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.08;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
};

export const createStudioIbl = (renderer, scene) => {
  let envRT = null;

  const bake = () => {
    envRT?.dispose();
    const pmrem = new THREE.PMREMGenerator(renderer);
    pmrem.compileEquirectangularShader();
    const equirect = createStudioCycloramaTexture();
    envRT = pmrem.fromEquirectangular(equirect);
    equirect.dispose();
    pmrem.dispose();
    scene.environment = envRT.texture;
    return envRT.texture;
  };

  bake();

  return {
    rebake: bake,
    dispose: () => {
      if (scene.environment === envRT?.texture) {
        scene.environment = null;
      }
      envRT?.dispose();
      envRT = null;
    },
  };
};
