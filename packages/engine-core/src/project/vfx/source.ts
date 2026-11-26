import { deepFreeze } from '../../immutable';
import {
  VFX_KIND,
  VFX_SCHEMA_VERSION,
  type VfxBlendMode,
  type VfxDissolveMode,
  type VfxDissolveSpec,
  type VfxElementSpec,
  type VfxEmitterSpec,
  type VfxLoopMode,
  type VfxPalette,
  type VfxRecipe,
  type VfxTextureKind,
  type VfxTextureSpec,
} from '../../vfx/contract';
import {
  lowerAssignOutputs,
  lowerOutputsFromBlock,
  lowerPreviewFromBlock,
  type RawDeclaredOutput,
  type RawDeclaredPreview,
} from '../directory/declarations';
import type {
  AshfoxAssignStmt,
  AshfoxBlock,
  AshfoxExpr,
  AshfoxNamedBlock,
  AshfoxStatement,
} from '../program/syntax/blockAst';
import { parseAshfoxProgram } from '../program/syntax/blockParser';
import { assertWellFormedSourceText } from '../workspace/path';
import type { VfxSourceUnit } from './contract';
import { readVfxEmitter, readVfxPrimitive } from './emitters';
import {
  asColor,
  asName,
  asNumber,
  asNumberCurve,
  asPaletteRole,
  asRange,
  asVec3,
  failVfx,
} from './expr';

const FALLBACK_PALETTE: VfxPalette = {
  name: 'ember_solar',
  core: '#fff7d6',
  mid: '#ff8a24',
  edge: '#b8250e',
  smoke: '#3d2824',
};

const readAssignProps = (block: AshfoxBlock, file: string): Map<string, AshfoxExpr> => {
  const map = new Map<string, AshfoxExpr>();
  for (const stmt of block.statements) {
    if (stmt.kind === 'assign') {
      map.set(stmt.path, stmt.value);
    } else if (stmt.kind === 'named-block') {
      continue;
    } else {
      failVfx(file, stmt.span, 'property assignment', stmt.kind);
    }
  }
  return map;
};

const readPaletteBlock = (stmt: AshfoxNamedBlock, file: string): VfxPalette => {
  const props = readAssignProps(stmt.block, file);
  const core = props.has('core') ? asColor(props.get('core')!, file) : FALLBACK_PALETTE.core;
  const mid = props.has('mid') ? asColor(props.get('mid')!, file) : FALLBACK_PALETTE.mid;
  const edge = props.has('edge') ? asColor(props.get('edge')!, file) : FALLBACK_PALETTE.edge;
  const smoke = props.has('smoke') ? asColor(props.get('smoke')!, file) : FALLBACK_PALETTE.smoke;
  return { name: stmt.name ?? 'custom', core, mid, edge, smoke };
};

const readElementTexture = (
  stmt: AshfoxNamedBlock | undefined,
  blendMode: VfxBlendMode,
  file: string,
): VfxTextureSpec => {
  if (!stmt) {
    return { kind: 'slash_streak', width: 64, height: 64, blendMode, seed: 1 };
  }
  const kind = (stmt.name ?? 'slash_streak') as VfxTextureKind;
  const props = readAssignProps(stmt.block, file);
  return {
    kind,
    width: props.has('width') ? asNumber(props.get('width')!, file) : 64,
    height: props.has('height') ? asNumber(props.get('height')!, file) : 64,
    blendMode,
    seed: props.has('seed') ? asNumber(props.get('seed')!, file) : 7,
    ...(props.has('posterize') ? { posterize: asNumber(props.get('posterize')!, file) } : {}),
    ...(props.has('bristles') ? { bristles: asNumber(props.get('bristles')!, file) } : {}),
    ...(props.has('spikes') ? { spikes: asNumber(props.get('spikes')!, file) } : {}),
    ...(props.has('runes') ? { runes: asNumber(props.get('runes')!, file) } : {}),
    ...(props.has('rings') ? { rings: asNumber(props.get('rings')!, file) } : {}),
    ...(props.has('curl_scale') ? { curlScale: asNumber(props.get('curl_scale')!, file) } : {}),
    ...(props.has('tint') ? { tintRole: asPaletteRole(props.get('tint')!, file) } : {}),
  };
};

const readElementDissolve = (
  stmt: AshfoxNamedBlock | undefined,
  file: string,
): VfxDissolveSpec | undefined => {
  if (!stmt) return undefined;
  const mode = (stmt.name ?? 'directional_wipe') as VfxDissolveMode;
  const props = readAssignProps(stmt.block, file);
  return {
    mode,
    frames: props.has('frames') ? asNumber(props.get('frames')!, file) : 8,
    edgeWidth: props.has('edge_width') ? asNumber(props.get('edge_width')!, file) : 0.08,
    edgeGlowRole: props.has('edge_glow') ? asPaletteRole(props.get('edge_glow')!, file) : 'core',
    ...(props.has('seed') ? { seed: asNumber(props.get('seed')!, file) } : {}),
    ...(props.has('direction') ? { directionDeg: asNumber(props.get('direction')!, file) } : {}),
  };
};

const collectElementChildren = (stmt: AshfoxNamedBlock, file: string) => {
  const props = new Map<string, AshfoxExpr>();
  let textureBlock: AshfoxNamedBlock | undefined;
  let dissolveBlock: AshfoxNamedBlock | undefined;
  for (const child of stmt.block.statements) {
    if (child.kind === 'assign') props.set(child.path, child.value);
    else if (child.kind === 'named-block' && child.blockKind === 'texture') textureBlock = child;
    else if (child.kind === 'named-block' && child.blockKind === 'dissolve') dissolveBlock = child;
    else failVfx(file, child.span, 'element statement', child.kind);
  }
  return { props, textureBlock, dissolveBlock };
};

const readElement = (stmt: AshfoxNamedBlock, file: string): VfxElementSpec => {
  const id = stmt.name ?? failVfx(file, stmt.span, 'element id', 'anonymous');
  const { props, textureBlock, dissolveBlock } = collectElementChildren(stmt, file);
  const [startTime, endTime] = props.has('at') ? asRange(props.get('at')!, file) : [0, 0.5];
  const blendRaw = props.has('blend') ? asName(props.get('blend')!, file) : 'additive';
  const blendMode: VfxBlendMode =
    blendRaw === 'blend' || blendRaw === 'premul' ? blendRaw : 'additive';
  const scaleExpr = props.get('scale') ?? props.get('scale_over_life');
  const alphaExpr = props.get('alpha') ?? props.get('alpha_over_life');
  return {
    id,
    startTime,
    endTime,
    blendMode,
    primitive: readVfxPrimitive(stmt.typeRef ?? 'slash_arc', props, file),
    texture: readElementTexture(textureBlock, blendMode, file),
    ...(dissolveBlock ? { dissolve: readElementDissolve(dissolveBlock, file) } : {}),
    colorRole: props.has('color') ? asPaletteRole(props.get('color')!, file) : 'core',
    ...(props.has('position') ? { position: asVec3(props.get('position')!, file) } : {}),
    ...(props.has('rotation') ? { rotationDeg: asVec3(props.get('rotation')!, file) } : {}),
    ...(props.has('spin') ? { spinDeg: asNumber(props.get('spin')!, file) } : {}),
    scaleCurve: scaleExpr
      ? asNumberCurve(scaleExpr, file)
      : [
          { t: 0, value: 0.7 },
          { t: 0.35, value: 1 },
          { t: 1, value: 1.15 },
        ],
    ...(alphaExpr ? { alphaCurve: asNumberCurve(alphaExpr, file) } : {}),
  };
};

const collectNamedVfxStmt = (
  stmt: AshfoxNamedBlock,
  file: string,
  outputs: RawDeclaredOutput[],
  previews: RawDeclaredPreview[],
  palettes: Record<string, VfxPalette>,
  elements: VfxElementSpec[],
  emitters: VfxEmitterSpec[],
): void => {
  if (stmt.blockKind === 'outputs') outputs.push(...lowerOutputsFromBlock(stmt.block, file));
  else if (stmt.blockKind === 'preview') previews.push(lowerPreviewFromBlock(stmt, file));
  else if (stmt.blockKind === 'palette') {
    const pal = readPaletteBlock(stmt, file);
    palettes[pal.name] = pal;
  } else if (stmt.blockKind === 'element') elements.push(readElement(stmt, file));
  else if (stmt.blockKind === 'emitter') emitters.push(readVfxEmitter(stmt, file));
  else failVfx(file, stmt.span, 'vfx statement', stmt.kind);
};

const collectVfxStatements = (statements: readonly AshfoxStatement[], file: string) => {
  const imports: { path: string; alias: string }[] = [];
  const outputs: RawDeclaredOutput[] = [];
  const previews: RawDeclaredPreview[] = [];
  const palettes: Record<string, VfxPalette> = {};
  const props = new Map<string, AshfoxExpr>();
  const elements: VfxElementSpec[] = [];
  const emitters: VfxEmitterSpec[] = [];
  for (const stmt of statements) {
    if (stmt.kind === 'import') imports.push({ path: stmt.path, alias: stmt.alias });
    else if (stmt.kind === 'export' && stmt.declaration.blockKind === 'palette') {
      const pal = readPaletteBlock(stmt.declaration, file);
      palettes[pal.name] = pal;
    } else if (stmt.kind === 'named-block')
      collectNamedVfxStmt(stmt, file, outputs, previews, palettes, elements, emitters);
    else if (stmt.kind === 'assign') {
      if (stmt.path === 'outputs')
        outputs.push(...lowerAssignOutputs(stmt as AshfoxAssignStmt, file));
      else props.set(stmt.path, stmt.value);
    } else failVfx(file, stmt.span, 'vfx statement', stmt.kind);
  }
  return { imports, outputs, previews, palettes, props, elements, emitters };
};

const resolveVfxPalette = (
  props: Map<string, AshfoxExpr>,
  palettes: Record<string, VfxPalette>,
  file: string,
): { readonly paletteRef: string | null; readonly palette: VfxPalette } => {
  const paletteRef = props.has('palette') ? asName(props.get('palette')!, file) : null;
  const fallback = Object.values(palettes)[0] ?? FALLBACK_PALETTE;
  const palette = paletteRef && palettes[paletteRef] ? palettes[paletteRef]! : fallback;
  return { paletteRef, palette };
};

const buildVfxRecipe = (
  name: string,
  props: Map<string, AshfoxExpr>,
  palette: VfxPalette,
  elements: VfxElementSpec[],
  emitters: VfxEmitterSpec[],
  file: string,
): VfxRecipe => ({
  schema: VFX_SCHEMA_VERSION,
  kind: VFX_KIND,
  name,
  durationSeconds: props.has('duration') ? asNumber(props.get('duration')!, file) : 0.65,
  fps: props.has('fps') ? asNumber(props.get('fps')!, file) : 30,
  loop: (props.has('loop') && asName(props.get('loop')!, file) === 'loop'
    ? 'loop'
    : 'once') as VfxLoopMode,
  palette,
  elements,
  emitters,
});

export const parseVfxSource = (source: string, file: string): VfxSourceUnit => {
  assertWellFormedSourceText(source);
  const parsed = parseAshfoxProgram(source, file);
  if (!parsed.file || parsed.diagnostics.length > 0) {
    const diag = parsed.diagnostics[0];
    failVfx(
      file,
      diag?.span ?? { start: { line: 1, column: 1 }, end: { line: 1, column: 1 } },
      'valid ashfox 1 vfx source',
      diag?.message ?? 'parse error',
    );
  }
  const top = parsed.file!.top;
  if (top.kind !== 'vfx' && top.kind !== 'module')
    return failVfx(file, top.span, 'vfx or module top block', top.kind);
  const { imports, outputs, previews, palettes, props, elements, emitters } = collectVfxStatements(
    top.block.statements,
    file,
  );
  const { paletteRef, palette } = resolveVfxPalette(props, palettes, file);
  const recipe =
    top.kind === 'module'
      ? null
      : buildVfxRecipe(top.name, props, palette, elements, emitters, file);
  return deepFreeze({
    kind: top.kind,
    id: top.name,
    imports,
    outputs,
    previews,
    palettes,
    paletteRef,
    recipe,
  });
};
