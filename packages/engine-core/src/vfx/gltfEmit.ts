import { mulQuat, quatFromAxisAngle, quatFromEulerXyzDeg } from '../animation/quat';
import type { GltfAnimation, GltfDocument, GltfNode } from '../export/targets/gltf/contract';
import { buildGlb } from '../export/targets/gltf/glb';
import { parseSurfaceColor } from '../textures/color';
import {
  UNIT_SCALE,
  type VfxGlbState,
  addAnimatedChannel,
  addStaticElementMesh,
  addUnlitMaterial,
  createVfxGlbState,
  uploadTextureImage,
} from './gltfState';
import {
  analyzeAlphaCurve,
  clampUnit,
  computeDissolveCellUvs,
  evalScalarLifeCurve,
  scaleStopsToTrack,
  selectStageColorIndices,
} from './particleGeo';
import type { CompiledVfx, CompiledVfxElement, VfxBakedBurst, VfxParticleTrack } from './contract';

const createAlphaMaterialResolver = (
  state: VfxGlbState,
  el: CompiledVfxElement,
  imageIndex: number,
): ((alpha: number) => number) => {
  const cache = new Map<number, number>();
  return (alpha: number): number => {
    const q = Math.round(clampUnit(alpha) * 1000);
    const existing = cache.get(q);
    if (existing !== undefined) return existing;
    const matIndex = addUnlitMaterial(state, `vfx_${el.id}`, imageIndex, el.blendMode, true, [
      1,
      1,
      1,
      q / 1000,
    ]);
    cache.set(q, matIndex);
    return matIndex;
  };
};

const emitStepChildren = (
  state: VfxGlbState,
  anim: GltfAnimation,
  el: CompiledVfxElement,
  duration: number,
  count: number,
  posAcc: number,
  normAcc: number,
  indices: number,
  buildStep: (stepIndex: number) => { readonly uvAcc: number; readonly matIndex: number },
): readonly number[] => {
  const span = Math.max(0.01, el.endTime - el.startTime);
  const children: number[] = [];
  for (let f = 0; f < count; f += 1) {
    const { uvAcc, matIndex } = buildStep(f);
    const meshIndex = addStaticElementMesh(
      state,
      `${el.id}_f${f}`,
      posAcc,
      normAcc,
      uvAcc,
      indices,
      matIndex,
    );
    const childIndex = state.nodes.length;
    state.nodes.push({
      name: `vfx_el_${el.id}_f${f}`,
      mesh: meshIndex,
      scale: f === 0 ? [1, 1, 1] : [0, 0, 0],
    });
    children.push(childIndex);
    const t0 = Number((el.startTime + (f / count) * span).toFixed(4));
    const t1 = Number((el.startTime + ((f + 1) / count) * span).toFixed(4));
    const times: number[] = f === 0 ? [t0] : [0, t0];
    const vals: number[] = f === 0 ? [1, 1, 1] : [0, 0, 0, 1, 1, 1];
    if (f < count - 1 && t1 <= duration) {
      times.push(t1);
      vals.push(0, 0, 0);
    }
    addAnimatedChannel(state, anim, childIndex, 'scale', times, vals, 3, 'STEP');
  }
  return children;
};

const emitSpinTrack = (
  state: VfxGlbState,
  anim: GltfAnimation,
  nodeIndex: number,
  el: CompiledVfxElement,
  baseQuat: readonly [number, number, number, number],
): void => {
  const spinDeg = el.spinDeg ?? 0;
  if (Math.abs(spinDeg) <= 1e-4) return;
  const span = Math.max(0.01, el.endTime - el.startTime);
  const steps = Math.max(2, Math.ceil(Math.abs(spinDeg) / 45));
  const times: number[] = [];
  const quats: number[] = [];
  for (let s = 0; s <= steps; s += 1) {
    const u = s / steps;
    times.push(Number((el.startTime + u * span).toFixed(4)));
    const q = mulQuat(baseQuat, quatFromAxisAngle([0, 1, 0], (spinDeg * u * Math.PI) / 180));
    quats.push(q[0], q[1], q[2], q[3]);
  }
  addAnimatedChannel(state, anim, nodeIndex, 'rotation', times, quats, 4, 'LINEAR');
};

const buildElementRootNode = (
  el: CompiledVfxElement,
  baseQuat: readonly [number, number, number, number],
): GltfNode => ({
  name: `vfx_el_${el.id}`,
  ...(el.position
    ? {
        translation: [
          el.position[0] * UNIT_SCALE,
          el.position[1] * UNIT_SCALE,
          el.position[2] * UNIT_SCALE,
        ],
      }
    : {}),
  ...(el.rotationDeg ? { rotation: [baseQuat[0], baseQuat[1], baseQuat[2], baseQuat[3]] } : {}),
  extras: { ashfoxId: el.id, ashfoxKind: 'vfx_element' },
});

const emitElementBody = (
  state: VfxGlbState,
  anim: GltfAnimation,
  el: CompiledVfxElement,
  duration: number,
  node: GltfNode,
  posAcc: number,
  normAcc: number,
  uvAcc: number | undefined,
  indices: number,
  getAlphaMat: (alpha: number) => number,
): void => {
  const alphaInfo = analyzeAlphaCurve(el.alphaCurve);
  if (!el.dissolveAtlas && !alphaInfo.varies) {
    node.mesh = addStaticElementMesh(
      state,
      el.id,
      posAcc,
      normAcc,
      uvAcc,
      indices,
      getAlphaMat(alphaInfo.midAlpha),
    );
    return;
  }
  const count = el.dissolveAtlas
    ? el.dissolveAtlas.frameCount
    : Math.max(4, Math.min(8, el.alphaCurve.length * 2 + 2));
  node.children = [
    ...emitStepChildren(state, anim, el, duration, count, posAcc, normAcc, indices, (f) => ({
      uvAcc: el.dissolveAtlas
        ? state.writer.addFloatAccessor(computeDissolveCellUvs(el, f), 2, false, 34962)
        : uvAcc!,
      matIndex: getAlphaMat(evalScalarLifeCurve(el.alphaCurve, (f + 0.5) / count)),
    })),
  ];
};

const emitElement = (
  state: VfxGlbState,
  anim: GltfAnimation,
  el: CompiledVfxElement,
  duration: number,
): void => {
  const texW = el.dissolveAtlas ? el.dissolveAtlas.atlasWidth : el.texture.width;
  const texH = el.dissolveAtlas ? el.dissolveAtlas.atlasHeight : el.texture.height;
  const rgba = el.dissolveAtlas ? el.dissolveAtlas.rgba : el.texture.rgba;
  const imageIndex = uploadTextureImage(state, `vfx_${el.id}`, texW, texH, rgba);
  const getAlphaMat = createAlphaMaterialResolver(state, el, imageIndex);
  const accessors = state.writer.addInterleavedVertexAccessors(
    el.mesh.positions.map((v) => v * UNIT_SCALE),
    el.mesh.normals,
    el.dissolveAtlas ? undefined : el.mesh.uvs,
  );
  const indices = state.writer.addIndexAccessor(el.mesh.indices);
  const baseQuat = el.rotationDeg ? quatFromEulerXyzDeg(el.rotationDeg) : ([0, 0, 0, 1] as const);
  const nodeIndex = state.nodes.length;
  const node = buildElementRootNode(el, baseQuat);
  state.nodes.push(node);
  emitElementBody(
    state,
    anim,
    el,
    duration,
    node,
    accessors.position,
    accessors.normal,
    accessors.uv,
    indices,
    getAlphaMat,
  );
  state.rootNodes.push(nodeIndex);
  emitSpinTrack(state, anim, nodeIndex, el, baseQuat);
  const scaleTrack = scaleStopsToTrack(el, duration);
  if (scaleTrack.times.length >= 2) {
    addAnimatedChannel(
      state,
      anim,
      nodeIndex,
      'scale',
      scaleTrack.times,
      scaleTrack.values,
      3,
      'LINEAR',
    );
  }
};

const emitBurstStageChildren = (
  state: VfxGlbState,
  anim: GltfAnimation,
  burstId: string,
  track: VfxParticleTrack,
  stageMeshes: readonly number[],
): readonly number[] => {
  const count = stageMeshes.length;
  const life = Math.max(1e-4, track.deathTime - track.birthTime);
  const children: number[] = [];
  for (let k = 0; k < count; k += 1) {
    const cNode = state.nodes.length;
    state.nodes.push({
      name: `burst_${burstId}_${track.particleIndex}_c${k}`,
      mesh: stageMeshes[k]!,
      scale: k === 0 ? [1, 1, 1] : [0, 0, 0],
    });
    children.push(cNode);
    const tStart = Number((track.birthTime + (k / count) * life).toFixed(2));
    const tEnd = Number((track.birthTime + ((k + 1) / count) * life).toFixed(2));
    const times = k === 0 ? [0, tEnd] : k === count - 1 ? [0, tStart] : [0, tStart, tEnd];
    const vals =
      k === 0
        ? [1, 1, 1, 0, 0, 0]
        : k === count - 1
          ? [0, 0, 0, 1, 1, 1]
          : [0, 0, 0, 1, 1, 1, 0, 0, 0];
    addAnimatedChannel(state, anim, cNode, 'scale', times, vals, 3, 'STEP');
  }
  return children;
};

const emitParticleNode = (
  state: VfxGlbState,
  anim: GltfAnimation,
  burstId: string,
  track: VfxParticleTrack,
  stageMeshes: readonly number[],
): number => {
  const pNode = state.nodes.length;
  const children =
    stageMeshes.length > 1 ? emitBurstStageChildren(state, anim, burstId, track, stageMeshes) : [];
  state.nodes.push({
    name: `burst_${burstId}_${track.particleIndex}`,
    ...(stageMeshes.length === 1 ? { mesh: stageMeshes[0]! } : { children: [...children] }),
    scale: [0, 0, 0],
  });
  const posVals = track.position.values.flatMap((v) => [
    v[0] * UNIT_SCALE,
    v[1] * UNIT_SCALE,
    v[2] * UNIT_SCALE,
  ]);
  const rotVals = track.rotation.values.flatMap((q) => [...q]);
  const sclVals = track.scale.values.flatMap((s) => [...s]);
  addAnimatedChannel(
    state,
    anim,
    pNode,
    'translation',
    track.position.times,
    posVals,
    3,
    track.position.interpolation,
  );
  addAnimatedChannel(
    state,
    anim,
    pNode,
    'rotation',
    track.rotation.times,
    rotVals,
    4,
    track.rotation.interpolation,
  );
  addAnimatedChannel(
    state,
    anim,
    pNode,
    'scale',
    track.scale.times,
    sclVals,
    3,
    track.scale.interpolation,
  );
  return pNode;
};

const emitParticleBurst = (state: VfxGlbState, anim: GltfAnimation, burst: VfxBakedBurst): void => {
  if (burst.tracks.length === 0) return;
  const accessors = state.writer.addInterleavedVertexAccessors(
    burst.sharedMesh.positions.map((v) => v * UNIT_SCALE),
    burst.sharedMesh.normals,
  );
  const idxAccessor = state.writer.addIndexAccessor(burst.sharedMesh.indices);
  const stageMeshes = selectStageColorIndices(burst.paletteColors.length).map((colorIdx, k) => {
    const rgb = parseSurfaceColor(burst.paletteColors[colorIdx] ?? '#ffffff');
    const matIndex = addUnlitMaterial(
      state,
      `vfx_burst_${burst.id}_c${k}`,
      undefined,
      burst.blendMode,
      true,
      [rgb.r / 255, rgb.g / 255, rgb.b / 255, 1],
    );
    return addStaticElementMesh(
      state,
      `burst_${burst.id}_c${k}`,
      accessors.position,
      accessors.normal,
      undefined,
      idxAccessor,
      matIndex,
    );
  });
  const particleNodes = burst.tracks.map((track) =>
    emitParticleNode(state, anim, burst.id, track, stageMeshes),
  );
  const burstRoot = state.nodes.length;
  state.nodes.push({
    name: `vfx_burst_${burst.id}`,
    children: particleNodes,
    extras: { ashfoxId: burst.id, ashfoxKind: 'vfx_burst' },
  });
  state.rootNodes.push(burstRoot);
};

export const emitVfxGlb = (compiled: CompiledVfx): Uint8Array => {
  const state = createVfxGlbState();
  const { writer } = state;
  const anim: GltfAnimation = {
    name: compiled.name,
    samplers: [],
    channels: [],
    extras: {
      ashfoxLoop: compiled.loop === 'loop' ? 'loop' : 'once',
      ashfoxDurationSeconds: compiled.durationSeconds,
      ashfoxFps: compiled.fps,
    },
  };
  for (const el of compiled.elements) emitElement(state, anim, el, compiled.durationSeconds);
  for (const burst of compiled.particleBursts) emitParticleBurst(state, anim, burst);
  if (anim.channels.length > 0) state.animations.push(anim);
  const binary = writer.toUint8Array();
  const gltf: GltfDocument = {
    asset: { version: '2.0', generator: 'ashfox vfx compiler' },
    extensionsUsed: ['KHR_materials_unlit'],
    scene: 0,
    scenes: [{ name: compiled.name, nodes: state.rootNodes }],
    nodes: state.nodes,
    ...(binary.byteLength > 0
      ? {
          buffers: [{ byteLength: binary.byteLength }],
          bufferViews: writer.state.bufferViews,
          accessors: writer.state.accessors,
        }
      : {}),
    ...(state.meshes.length > 0 ? { meshes: state.meshes } : {}),
    ...(state.images.length > 0
      ? {
          images: state.images,
          samplers: state.samplers,
          textures: state.images.map((img, idx) => ({ sampler: idx, source: idx, name: img.name })),
        }
      : {}),
    ...(state.materials.length > 0 ? { materials: state.materials } : {}),
    ...(state.animations.length > 0 ? { animations: state.animations } : {}),
  };
  return buildGlb(gltf, binary);
};
