import * as THREE from 'three';
import type {
  CompiledVfx,
  CompiledVfxElement,
  VfxBakedBurst,
  VfxBlendMode,
  VfxLifeStop,
} from '@ashfox/engine-core';

const UNIT_SCALE = 1 / 16;

interface VfxElementNode {
  readonly spec: CompiledVfxElement;
  readonly mesh: THREE.Mesh;
  readonly material: THREE.MeshBasicMaterial;
  readonly map: THREE.DataTexture;
}

interface VfxBurstNode {
  readonly spec: VfxBakedBurst;
  readonly paletteColors: readonly THREE.Color[];
  readonly particles: readonly {
    readonly mesh: THREE.Mesh;
    readonly material: THREE.MeshBasicMaterial;
    readonly track: VfxBakedBurst['tracks'][number];
  }[];
  readonly geometry: THREE.BufferGeometry;
}

export interface VfxSceneState {
  readonly root: THREE.Group;
  readonly elements: readonly VfxElementNode[];
  readonly bursts: readonly VfxBurstNode[];
  dispose(): void;
}

const toRgbaBytes = (raw: unknown, byteLength: number): Uint8Array => {
  if (raw instanceof Uint8Array && raw.byteLength === byteLength) return new Uint8Array(raw);
  const out = new Uint8Array(byteLength);
  if (raw instanceof Uint8Array) {
    out.set(raw.subarray(0, byteLength));
    return out;
  }
  if (Array.isArray(raw)) {
    out.set(raw.slice(0, byteLength));
    return out;
  }
  if (raw && typeof raw === 'object') {
    const rec = raw as Record<number, number>;
    for (let i = 0; i < byteLength; i += 1) out[i] = Number(rec[i] ?? 0);
  }
  return out;
};

const configureVfxBlend = (
  blendMode: VfxBlendMode,
): Pick<THREE.MeshBasicMaterialParameters, 'blending' | 'premultipliedAlpha'> => {
  if (blendMode === 'additive') {
    return { blending: THREE.AdditiveBlending, premultipliedAlpha: true };
  }
  if (blendMode === 'premul') {
    return { blending: THREE.NormalBlending, premultipliedAlpha: true };
  }
  return { blending: THREE.NormalBlending, premultipliedAlpha: false };
};

const evalCurve = (stops: readonly VfxLifeStop<number>[], u: number, fallback: number): number => {
  if (stops.length === 0) return fallback;
  if (u <= stops[0]!.t) return stops[0]!.value;
  if (u >= stops[stops.length - 1]!.t) return stops[stops.length - 1]!.value;
  for (let i = 0; i < stops.length - 1; i += 1) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    if (u <= b.t) {
      const span = Math.max(1e-6, b.t - a.t);
      const t = (u - a.t) / span;
      return a.value + (b.value - a.value) * t;
    }
  }
  return fallback;
};

const sampleVec3Track = (
  times: readonly number[],
  values: readonly (readonly [number, number, number])[],
  time: number,
  interpolation: 'LINEAR' | 'STEP',
): readonly [number, number, number] => {
  if (times.length === 0) return [0, 0, 0];
  if (time <= times[0]!) return values[0]!;
  if (time >= times[times.length - 1]!) return values[values.length - 1]!;
  for (let i = 0; i < times.length - 1; i += 1) {
    const t0 = times[i]!;
    const t1 = times[i + 1]!;
    if (time <= t1) {
      const a = values[i]!;
      if (interpolation === 'STEP' || t1 <= t0) return a;
      const u = (time - t0) / (t1 - t0);
      const b = values[i + 1]!;
      return [a[0] + (b[0] - a[0]) * u, a[1] + (b[1] - a[1]) * u, a[2] + (b[2] - a[2]) * u];
    }
  }
  return values[values.length - 1]!;
};

const sampleQuatTrack = (
  times: readonly number[],
  values: readonly (readonly [number, number, number, number])[],
  time: number,
  interpolation: 'LINEAR' | 'STEP',
): THREE.Quaternion => {
  if (times.length === 0) return new THREE.Quaternion();
  if (time <= times[0]!) return new THREE.Quaternion(...values[0]!);
  if (time >= times[times.length - 1]!) return new THREE.Quaternion(...values[values.length - 1]!);
  for (let i = 0; i < times.length - 1; i += 1) {
    const t0 = times[i]!;
    const t1 = times[i + 1]!;
    if (time <= t1) {
      const qa = new THREE.Quaternion(...values[i]!);
      if (interpolation === 'STEP' || t1 <= t0) return qa;
      const qb = new THREE.Quaternion(...values[i + 1]!);
      return qa.slerp(qb, (time - t0) / (t1 - t0));
    }
  }
  return new THREE.Quaternion(...values[values.length - 1]!);
};

const buildGeometry = (mesh: CompiledVfxElement['mesh']): THREE.BufferGeometry => {
  const geo = new THREE.BufferGeometry();
  const pos = new Float32Array(mesh.positions.length);
  for (let i = 0; i < mesh.positions.length; i += 1) pos[i] = mesh.positions[i]! * UNIT_SCALE;
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(Float32Array.from(mesh.normals), 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(Float32Array.from(mesh.uvs), 2));
  geo.setIndex(Array.from(mesh.indices));
  return geo;
};

const createVfxElementNode = (root: THREE.Group, el: CompiledVfxElement): VfxElementNode => {
  const texW = el.dissolveAtlas ? el.dissolveAtlas.atlasWidth : el.texture.width;
  const texH = el.dissolveAtlas ? el.dissolveAtlas.atlasHeight : el.texture.height;
  const rgba = el.dissolveAtlas ? el.dissolveAtlas.rgba : el.texture.rgba;
  const texBytes = toRgbaBytes(rgba, texW * texH * 4);
  const map = new THREE.DataTexture(texBytes, texW, texH, THREE.RGBAFormat);
  map.magFilter = THREE.LinearFilter;
  map.minFilter = THREE.LinearFilter;
  map.colorSpace = THREE.SRGBColorSpace;
  map.wrapS = THREE.RepeatWrapping;
  map.wrapT = THREE.RepeatWrapping;
  map.flipY = false;
  map.needsUpdate = true;

  const material = new THREE.MeshBasicMaterial({
    map,
    transparent: true,
    depthWrite: false,
    side: THREE.DoubleSide,
    toneMapped: false,
    ...configureVfxBlend(el.blendMode),
  });
  const geometry = buildGeometry(el.mesh);
  const mesh = new THREE.Mesh(geometry, material);
  mesh.name = el.id;
  if (el.position) {
    mesh.position.set(
      el.position[0] * UNIT_SCALE,
      el.position[1] * UNIT_SCALE,
      el.position[2] * UNIT_SCALE,
    );
  }
  if (el.rotationDeg) {
    const d2r = Math.PI / 180;
    mesh.rotation.set(
      el.rotationDeg[0] * d2r,
      el.rotationDeg[1] * d2r,
      el.rotationDeg[2] * d2r,
      'XYZ',
    );
  }
  root.add(mesh);
  return { spec: el, mesh, material, map };
};

const createVfxBurstNode = (root: THREE.Group, burst: VfxBakedBurst): VfxBurstNode => {
  const geometry = buildGeometry(burst.sharedMesh);
  const paletteColors = (burst.paletteColors.length > 0 ? burst.paletteColors : ['#ffffff']).map(
    (hex) => new THREE.Color(hex),
  );
  const particles = burst.tracks.map((track) => {
    const material = new THREE.MeshBasicMaterial({
      color: paletteColors[0]!,
      transparent: true,
      depthWrite: false,
      side: THREE.DoubleSide,
      toneMapped: false,
      ...configureVfxBlend(burst.blendMode),
    });
    const mesh = new THREE.Mesh(geometry, material);
    root.add(mesh);
    return { mesh, material, track };
  });
  return { spec: burst, paletteColors, particles, geometry };
};

export const createVfxThreeGroup = (vfx: CompiledVfx): VfxSceneState => {
  const root = new THREE.Group();
  const elements = vfx.elements.map((el) => createVfxElementNode(root, el));
  const bursts = vfx.particleBursts.map((burst) => createVfxBurstNode(root, burst));

  const dispose = (): void => {
    for (const el of elements) {
      el.mesh.geometry.dispose();
      el.material.dispose();
      el.map.dispose();
    }
    for (const b of bursts) {
      b.geometry.dispose();
      for (const p of b.particles) p.material.dispose();
    }
  };

  return { root, elements, bursts, dispose };
};

const evaluateElementNode = (el: VfxElementNode, timeSeconds: number): void => {
  const active = timeSeconds >= el.spec.startTime - 1e-5 && timeSeconds <= el.spec.endTime + 1e-5;
  el.mesh.visible = active;
  if (!active) return;
  const span = Math.max(1e-5, el.spec.endTime - el.spec.startTime);
  const u = Math.max(0, Math.min(1, (timeSeconds - el.spec.startTime) / span));
  const d2r = Math.PI / 180;
  const baseRot = el.spec.rotationDeg ?? [0, 0, 0];
  el.mesh.rotation.set(baseRot[0] * d2r, baseRot[1] * d2r, baseRot[2] * d2r, 'XYZ');
  if (el.spec.spinDeg) el.mesh.rotateY(el.spec.spinDeg * u * d2r);
  const scale = Math.max(1e-4, evalCurve(el.spec.scaleCurve, u, 1));
  el.mesh.scale.set(scale, scale, scale);
  el.material.opacity = Math.max(0, Math.min(1, evalCurve(el.spec.alphaCurve, u, 1)));
  if (!el.spec.dissolveAtlas) return;
  const atlas = el.spec.dissolveAtlas;
  const frame = Math.min(atlas.frameCount - 1, Math.floor(u * atlas.frameCount));
  el.map.repeat.set(1 / atlas.columns, 1 / atlas.rows);
  el.map.offset.set(
    (frame % atlas.columns) / atlas.columns,
    Math.floor(frame / atlas.columns) / atlas.rows,
  );
};

const evaluateBurstParticle = (
  p: VfxBurstNode['particles'][number],
  paletteColors: readonly THREE.Color[],
  timeSeconds: number,
): void => {
  const tr = p.track;
  const alive = timeSeconds >= tr.birthTime - 1e-5 && timeSeconds <= tr.deathTime + 1e-5;
  p.mesh.visible = alive;
  if (!alive) return;
  const life = Math.max(1e-5, tr.deathTime - tr.birthTime);
  const u = Math.max(0, Math.min(1, (timeSeconds - tr.birthTime) / life));
  if (paletteColors.length <= 1) {
    p.material.color.copy(paletteColors[0]!);
  } else {
    const scaled = u * (paletteColors.length - 1);
    const lo = Math.floor(scaled);
    const hi = Math.min(paletteColors.length - 1, lo + 1);
    p.material.color.lerpColors(paletteColors[lo]!, paletteColors[hi]!, scaled - lo);
  }
  const pos = sampleVec3Track(
    tr.position.times,
    tr.position.values,
    timeSeconds,
    tr.position.interpolation,
  );
  p.mesh.position.set(pos[0] * UNIT_SCALE, pos[1] * UNIT_SCALE, pos[2] * UNIT_SCALE);
  p.mesh.quaternion.copy(
    sampleQuatTrack(tr.rotation.times, tr.rotation.values, timeSeconds, tr.rotation.interpolation),
  );
  const scl = sampleVec3Track(tr.scale.times, tr.scale.values, timeSeconds, tr.scale.interpolation);
  p.mesh.scale.set(scl[0], scl[1], scl[2]);
};

export const evaluateVfxThreeGroup = (state: VfxSceneState, timeSeconds: number): void => {
  for (const el of state.elements) evaluateElementNode(el, timeSeconds);
  for (const burst of state.bursts) {
    for (const p of burst.particles) evaluateBurstParticle(p, burst.paletteColors, timeSeconds);
  }
};
