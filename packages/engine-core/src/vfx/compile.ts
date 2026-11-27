import { deepFreeze } from '../immutable';
import {
  VFX_KIND,
  VFX_SCHEMA_VERSION,
  type CompiledVfx,
  type CompiledVfxElement,
  type VfxBakedBurst,
  type VfxElementSpec,
  type VfxLifeStop,
  type VfxPalette,
  type VfxRecipe,
  type VfxRuntimeStats,
} from './contract';
import { bakeDissolveFlipbook } from './dissolve';
import { resolvePaletteHex } from './oklch';
import { simulateVoxelBurst } from './particles';
import { buildVfxPrimitive } from './primitives';
import { synthesizeVfxTexture } from './textures';

const RECIPE_KEYS = new Set([
  'schema',
  'kind',
  'name',
  'durationSeconds',
  'fps',
  'loop',
  'palette',
  'elements',
  'emitters',
  'budget',
]);
const PALETTE_KEYS = new Set(['name', 'core', 'mid', 'edge', 'smoke']);
const ELEMENT_KEYS = new Set([
  'id',
  'startTime',
  'endTime',
  'blendMode',
  'primitive',
  'texture',
  'dissolve',
  'colorRole',
  'position',
  'rotationDeg',
  'spinDeg',
  'scaleCurve',
  'alphaCurve',
]);
const EMITTER_KEYS = new Set([
  'id',
  'startTime',
  'endTime',
  'seed',
  'count',
  'shape',
  'shapeParams',
  'particle',
  'speedMin',
  'speedMax',
  'lifeMin',
  'lifeMax',
  'gravity',
  'drag',
  'turbulence',
  'vortex',
  'ground',
  'sizeOverLife',
  'colorOverLife',
  'velocityStretch',
  'spinSpeedDeg',
  'blendMode',
]);

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const assertClosedKeys = (
  obj: Record<string, unknown>,
  allowed: Set<string>,
  path: string,
): void => {
  for (const key of Object.keys(obj)) {
    if (!allowed.has(key)) {
      throw new Error(`Unknown key "${key}" in VFX contract at ${path}.`);
    }
  }
};

const validateHexField = (obj: Record<string, unknown>, role: keyof VfxPalette): string => {
  const val = obj[role];
  if (typeof val !== 'string' || !/^#([0-9a-f]{6}|[0-9a-f]{8})$/i.test(val)) {
    throw new RangeError(
      `VFX palette.${role} must be a 6-digit #rrggbb or 8-digit #rrggbbaa hex color.`,
    );
  }
  return val;
};

const validatePalette = (palette: unknown): VfxPalette => {
  if (!isRecord(palette)) throw new TypeError('VFX palette must be an object.');
  assertClosedKeys(palette, PALETTE_KEYS, 'palette');
  const name =
    typeof palette.name === 'string' && palette.name.length > 0 ? palette.name : 'custom';
  return {
    name,
    core: validateHexField(palette, 'core'),
    mid: validateHexField(palette, 'mid'),
    edge: validateHexField(palette, 'edge'),
    smoke: validateHexField(palette, 'smoke'),
  };
};

const isElementArray = (value: unknown): value is readonly VfxElementSpec[] => {
  if (!Array.isArray(value)) return false;
  for (let i = 0; i < value.length; i += 1) {
    const el = value[i];
    if (!isRecord(el)) throw new TypeError(`VFX elements[${i}] must be an object.`);
    assertClosedKeys(el, ELEMENT_KEYS, `elements[${i}]`);
  }
  return true;
};

const isEmitterArray = (value: unknown): value is readonly VfxRecipe['emitters'][number][] => {
  if (!Array.isArray(value)) return false;
  for (let i = 0; i < value.length; i += 1) {
    const em = value[i];
    if (!isRecord(em)) throw new TypeError(`VFX emitters[${i}] must be an object.`);
    assertClosedKeys(em, EMITTER_KEYS, `emitters[${i}]`);
  }
  return true;
};

/** Closed reader/validator for an `ashfox 1` VFX recipe; rejects unknown keys. */
export const readVfxRecipe = (input: unknown): VfxRecipe => {
  if (!isRecord(input)) throw new TypeError('VFX recipe must be an object.');
  assertClosedKeys(input, RECIPE_KEYS, 'recipe');
  if (input.schema !== VFX_SCHEMA_VERSION) {
    throw new RangeError(`VFX schema must be "${VFX_SCHEMA_VERSION}".`);
  }
  if (input.kind !== VFX_KIND) {
    throw new RangeError(`VFX kind must be "${VFX_KIND}".`);
  }
  if (typeof input.name !== 'string' || input.name.length === 0) {
    throw new TypeError('VFX name must be a non-empty string.');
  }
  if (typeof input.durationSeconds !== 'number' || input.durationSeconds <= 0) {
    throw new RangeError('VFX durationSeconds must be positive.');
  }
  if (typeof input.fps !== 'number' || input.fps <= 0) {
    throw new RangeError('VFX fps must be positive.');
  }
  if (input.loop !== 'once' && input.loop !== 'loop') {
    throw new RangeError('VFX loop must be "once" or "loop".');
  }
  const palette = validatePalette(input.palette);
  if (!isElementArray(input.elements) || !isEmitterArray(input.emitters)) {
    throw new TypeError('VFX elements and emitters must be arrays.');
  }
  const recipe: VfxRecipe = {
    schema: VFX_SCHEMA_VERSION,
    kind: VFX_KIND,
    name: input.name,
    durationSeconds: input.durationSeconds,
    fps: input.fps,
    loop: input.loop,
    palette,
    elements: structuredClone(input.elements),
    emitters: structuredClone(input.emitters),
  };
  return deepFreeze(recipe);
};

const DEFAULT_ALPHA_CURVE: readonly VfxLifeStop<number>[] = Object.freeze([
  { t: 0, value: 1 },
  { t: 1, value: 0 },
]);

const compileElement = (el: VfxElementSpec, palette: VfxPalette): CompiledVfxElement => {
  const mesh = buildVfxPrimitive(el.primitive);
  const texture = synthesizeVfxTexture(el.texture, palette);
  const dissolveAtlas = el.dissolve
    ? bakeDissolveFlipbook(texture, el.dissolve, palette)
    : undefined;
  return Object.freeze({
    id: el.id,
    startTime: el.startTime,
    endTime: el.endTime,
    blendMode: el.blendMode,
    mesh,
    texture,
    ...(dissolveAtlas ? { dissolveAtlas } : {}),
    colorHex: resolvePaletteHex(palette, el.colorRole),
    ...(el.position ? { position: el.position } : {}),
    ...(el.rotationDeg ? { rotationDeg: el.rotationDeg } : {}),
    ...(el.spinDeg !== undefined ? { spinDeg: el.spinDeg } : {}),
    scaleCurve: el.scaleCurve,
    alphaCurve: el.alphaCurve ?? DEFAULT_ALPHA_CURVE,
    drawCalls: 1,
  });
};

const computeStats = (
  elements: readonly CompiledVfxElement[],
  bursts: readonly VfxBakedBurst[],
): VfxRuntimeStats => {
  let drawCalls = 0;
  let triangles = 0;
  let textureBytes = 0;
  let meshBytes = 0;
  let animBytes = 0;
  let particleCount = 0;
  for (const el of elements) {
    drawCalls += el.drawCalls;
    triangles += el.mesh.triangleCount;
    meshBytes += el.mesh.vertexCount * 20 + el.mesh.triangleCount * 6;
    textureBytes += el.dissolveAtlas
      ? Math.round(el.dissolveAtlas.rgba.length * 0.22)
      : Math.round(el.texture.rgba.length * 0.3);
  }
  for (const burst of bursts) {
    drawCalls += burst.drawCalls;
    particleCount += burst.particleCount;
    triangles += burst.sharedMesh.triangleCount * burst.particleCount;
    meshBytes += burst.sharedMesh.vertexCount * 20 + burst.sharedMesh.triangleCount * 6;
    for (const tr of burst.tracks) {
      animBytes +=
        tr.position.times.length * 16 + tr.rotation.times.length * 12 + tr.scale.times.length * 16;
    }
  }
  return Object.freeze({
    drawCalls,
    triangles,
    estimatedGlbBytes: 512 + meshBytes + textureBytes + animBytes,
    particleCount,
    textureBytes,
  });
};

/** Deterministically compile a closed `VfxRecipe` into triple-delivery `CompiledVfx` IR. */
export const compileVfxRecipe = (recipeInput: VfxRecipe): CompiledVfx => {
  const recipe = readVfxRecipe(recipeInput);
  const elements = Object.freeze(recipe.elements.map((el) => compileElement(el, recipe.palette)));
  const particleBursts = Object.freeze(
    recipe.emitters.map((em) => simulateVoxelBurst(em, recipe.palette, recipe.durationSeconds)),
  );
  const stats = computeStats(elements, particleBursts);
  const frameCount = Math.max(4, Math.min(36, Math.round(recipe.durationSeconds * recipe.fps)));
  const columns = Math.ceil(Math.sqrt(frameCount));
  const rows = Math.ceil(frameCount / columns);
  return Object.freeze({
    schema: recipe.schema,
    kind: recipe.kind,
    name: recipe.name,
    durationSeconds: recipe.durationSeconds,
    fps: recipe.fps,
    loop: recipe.loop,
    palette: recipe.palette,
    elements,
    particleBursts,
    stats,
    flipbookManifest: Object.freeze({
      columns,
      rows,
      frameCount,
      fps: recipe.fps,
      durationSeconds: recipe.durationSeconds,
    }),
  });
};
