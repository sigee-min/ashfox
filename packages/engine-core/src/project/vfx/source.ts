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
  AshfoxBareStmt,
  AshfoxExpr,
  AshfoxNamedBlock,
  AshfoxStatement,
} from '../program/syntax/blockAst';
import { collectBlockAssigns, parseAshfoxTop } from '../program/syntax/blockLowering';
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
  type VfxParamEnv,
} from './expr';

const FALLBACK_PALETTE: VfxPalette = {
  name: 'ember_solar',
  core: '#fff7d6',
  mid: '#ff8a24',
  edge: '#b8250e',
  smoke: '#3d2824',
};

const readPaletteBlock = (stmt: AshfoxNamedBlock, file: string): VfxPalette => {
  const props = collectBlockAssigns(stmt.block, file, failVfx, true);
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
  env?: VfxParamEnv,
): VfxTextureSpec => {
  if (!stmt) {
    return { kind: 'slash_streak', width: 64, height: 64, blendMode, seed: 1 };
  }
  const kind = (stmt.name ?? 'slash_streak') as VfxTextureKind;
  const props = collectBlockAssigns(stmt.block, file, failVfx, true);
  return {
    kind,
    width: props.has('width') ? asNumber(props.get('width')!, file, env) : 64,
    height: props.has('height') ? asNumber(props.get('height')!, file, env) : 64,
    blendMode,
    seed: props.has('seed') ? asNumber(props.get('seed')!, file, env) : 7,
    ...(props.has('posterize') ? { posterize: asNumber(props.get('posterize')!, file, env) } : {}),
    ...(props.has('bristles') ? { bristles: asNumber(props.get('bristles')!, file, env) } : {}),
    ...(props.has('spikes') ? { spikes: asNumber(props.get('spikes')!, file, env) } : {}),
    ...(props.has('runes') ? { runes: asNumber(props.get('runes')!, file, env) } : {}),
    ...(props.has('rings') ? { rings: asNumber(props.get('rings')!, file, env) } : {}),
    ...(props.has('curl_scale')
      ? { curlScale: asNumber(props.get('curl_scale')!, file, env) }
      : {}),
    ...(props.has('tint') ? { tintRole: asPaletteRole(props.get('tint')!, file, env) } : {}),
  };
};

const readElementDissolve = (
  stmt: AshfoxNamedBlock | undefined,
  file: string,
  env?: VfxParamEnv,
): VfxDissolveSpec | undefined => {
  if (!stmt) return undefined;
  const mode = (stmt.name ?? 'directional_wipe') as VfxDissolveMode;
  const props = collectBlockAssigns(stmt.block, file, failVfx, true);
  return {
    mode,
    frames: props.has('frames') ? asNumber(props.get('frames')!, file, env) : 8,
    edgeWidth: props.has('edge_width') ? asNumber(props.get('edge_width')!, file, env) : 0.08,
    edgeGlowRole: props.has('edge_glow')
      ? asPaletteRole(props.get('edge_glow')!, file, env)
      : 'core',
    ...(props.has('seed') ? { seed: asNumber(props.get('seed')!, file, env) } : {}),
    ...(props.has('direction')
      ? { directionDeg: asNumber(props.get('direction')!, file, env) }
      : {}),
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
    else
      failVfx(
        file,
        child.span,
        'element statement',
        child.kind === 'named-block' ? child.blockKind : child.kind,
        ['texture', 'dissolve'],
      );
  }
  return { props, textureBlock, dissolveBlock };
};

export const readVfxElement = (
  stmt: AshfoxNamedBlock,
  file: string,
  env?: VfxParamEnv,
): VfxElementSpec => {
  const id = stmt.name ?? failVfx(file, stmt.span, 'element id', 'anonymous');
  const { props, textureBlock, dissolveBlock } = collectElementChildren(stmt, file);
  const [startTime, endTime] = props.has('at') ? asRange(props.get('at')!, file, env) : [0, 0.5];
  const blendRaw = props.has('blend') ? asName(props.get('blend')!, file, env) : 'additive';
  const blendMode: VfxBlendMode =
    blendRaw === 'blend' || blendRaw === 'premul' ? blendRaw : 'additive';
  const scaleExpr = props.get('scale') ?? props.get('scale_over_life');
  const alphaExpr = props.get('alpha') ?? props.get('alpha_over_life');
  return {
    id,
    startTime,
    endTime,
    blendMode,
    primitive: readVfxPrimitive(stmt.typeRef ?? 'slash_arc', props, file, env),
    texture: readElementTexture(textureBlock, blendMode, file, env),
    ...(dissolveBlock ? { dissolve: readElementDissolve(dissolveBlock, file, env) } : {}),
    colorRole: props.has('color') ? asPaletteRole(props.get('color')!, file, env) : 'core',
    ...(props.has('position') ? { position: asVec3(props.get('position')!, file, env) } : {}),
    ...(props.has('rotation') ? { rotationDeg: asVec3(props.get('rotation')!, file, env) } : {}),
    ...(props.has('spin') ? { spinDeg: asNumber(props.get('spin')!, file, env) } : {}),
    scaleCurve: scaleExpr
      ? asNumberCurve(scaleExpr, file, env)
      : [
          { t: 0, value: 0.7 },
          { t: 0.35, value: 1 },
          { t: 1, value: 1.15 },
        ],
    ...(alphaExpr ? { alphaCurve: asNumberCurve(alphaExpr, file, env) } : {}),
  };
};

interface CollectedVfx {
  readonly imports: { path: string; alias: string }[];
  readonly outputs: RawDeclaredOutput[];
  readonly previews: RawDeclaredPreview[];
  readonly params: Record<string, AshfoxExpr>;
  readonly palettes: Record<string, VfxPalette>;
  readonly elementBlocks: Record<string, AshfoxNamedBlock>;
  readonly emitterBlocks: Record<string, AshfoxNamedBlock>;
  readonly recipeBlocks: Record<string, AshfoxNamedBlock>;
  readonly entryElements: AshfoxNamedBlock[];
  readonly entryEmitters: AshfoxNamedBlock[];
  readonly uses: AshfoxBareStmt[];
  readonly props: Map<string, AshfoxExpr>;
}

const collectExportedVfxDecl = (decl: AshfoxNamedBlock, file: string, acc: CollectedVfx): void => {
  if (decl.blockKind === 'palette') {
    const pal = readPaletteBlock(decl, file);
    acc.palettes[pal.name] = pal;
    return;
  }
  const id = decl.name ?? failVfx(file, decl.span, `exported ${decl.blockKind} name`, 'anonymous');
  if (decl.blockKind === 'element') acc.elementBlocks[id] = decl;
  else if (decl.blockKind === 'emitter') acc.emitterBlocks[id] = decl;
  else if (decl.blockKind === 'recipe') acc.recipeBlocks[id] = decl;
  else {
    failVfx(file, decl.span, 'exported palette, element, emitter, or recipe', decl.blockKind);
  }
};

const collectNamedVfxStmt = (stmt: AshfoxNamedBlock, file: string, acc: CollectedVfx): void => {
  if (stmt.blockKind === 'outputs') acc.outputs.push(...lowerOutputsFromBlock(stmt.block, file));
  else if (stmt.blockKind === 'preview') acc.previews.push(lowerPreviewFromBlock(stmt, file));
  else if (stmt.blockKind === 'params') {
    for (const [k, v] of collectBlockAssigns(stmt.block, file, failVfx, false)) {
      acc.params[k] = v;
    }
  } else if (stmt.blockKind === 'palette') {
    const pal = readPaletteBlock(stmt, file);
    acc.palettes[pal.name] = pal;
  } else if (stmt.blockKind === 'element') acc.entryElements.push(stmt);
  else if (stmt.blockKind === 'emitter') acc.entryEmitters.push(stmt);
  else
    failVfx(file, stmt.span, 'vfx statement', stmt.blockKind, [
      'params',
      'palette',
      'element',
      'emitter',
      'outputs',
      'preview',
    ]);
};

const collectVfxStatements = (
  statements: readonly AshfoxStatement[],
  file: string,
): CollectedVfx => {
  const acc: CollectedVfx = {
    imports: [],
    outputs: [],
    previews: [],
    params: {},
    palettes: {},
    elementBlocks: {},
    emitterBlocks: {},
    recipeBlocks: {},
    entryElements: [],
    entryEmitters: [],
    uses: [],
    props: new Map(),
  };
  for (const stmt of statements) {
    if (stmt.kind === 'import') acc.imports.push({ path: stmt.path, alias: stmt.alias });
    else if (stmt.kind === 'export') collectExportedVfxDecl(stmt.declaration, file, acc);
    else if (stmt.kind === 'named-block') collectNamedVfxStmt(stmt, file, acc);
    else if (stmt.kind === 'bare' && stmt.stmtKind === 'use') acc.uses.push(stmt);
    else if (stmt.kind === 'assign') {
      if (stmt.path === 'outputs')
        acc.outputs.push(...lowerAssignOutputs(stmt as AshfoxAssignStmt, file));
      else acc.props.set(stmt.path, stmt.value);
    } else failVfx(file, stmt.span, 'vfx statement', stmt.kind);
  }
  return acc;
};

const resolveVfxPalette = (
  props: ReadonlyMap<string, AshfoxExpr>,
  palettes: Record<string, VfxPalette>,
  file: string,
  env?: VfxParamEnv,
): { readonly paletteRef: string | null; readonly palette: VfxPalette } => {
  const paletteRef = props.has('palette') ? asName(props.get('palette')!, file, env) : null;
  const fallback = Object.values(palettes)[0] ?? FALLBACK_PALETTE;
  const palette = paletteRef && palettes[paletteRef] ? palettes[paletteRef]! : fallback;
  return { paletteRef, palette };
};

export const buildVfxRecipe = (
  name: string,
  props: ReadonlyMap<string, AshfoxExpr>,
  palette: VfxPalette,
  elements: VfxElementSpec[],
  emitters: VfxEmitterSpec[],
  file: string,
  env?: VfxParamEnv,
): VfxRecipe => ({
  schema: VFX_SCHEMA_VERSION,
  kind: VFX_KIND,
  name,
  durationSeconds: props.has('duration') ? asNumber(props.get('duration')!, file, env) : 0.65,
  fps: props.has('fps') ? asNumber(props.get('fps')!, file, env) : 30,
  loop: (props.has('loop') && asName(props.get('loop')!, file, env) === 'loop'
    ? 'loop'
    : 'once') as VfxLoopMode,
  palette,
  elements,
  emitters,
});

const needsDirectoryGraph = (acc: CollectedVfx): boolean =>
  acc.uses.length > 0 ||
  acc.entryElements.some((el) => el.typeRef?.includes('.') ?? false) ||
  acc.entryEmitters.some((em) => em.typeRef?.includes('.') ?? false);

export const parseVfxSource = (source: string, file: string): VfxSourceUnit => {
  const top = parseAshfoxTop(
    source,
    file,
    ['vfx', 'module'],
    (span, message) => failVfx(file, span, 'valid ashfox 1 vfx source', message),
    failVfx,
    'vfx or module top block',
  );
  const acc = collectVfxStatements(top.block.statements, file);
  const env: VfxParamEnv = new Map(Object.entries(acc.params));
  const { paletteRef, palette } = resolveVfxPalette(acc.props, acc.palettes, file, env);
  const recipe =
    top.kind === 'module' || needsDirectoryGraph(acc)
      ? null
      : buildVfxRecipe(
          top.name,
          acc.props,
          palette,
          acc.entryElements.map((el) => readVfxElement(el, file, env)),
          acc.entryEmitters.map((em) => readVfxEmitter(em, file, env)),
          file,
          env,
        );
  return deepFreeze({
    kind: top.kind,
    id: top.name,
    imports: acc.imports,
    outputs: acc.outputs,
    previews: acc.previews,
    params: acc.params,
    palettes: acc.palettes,
    elementBlocks: acc.elementBlocks,
    emitterBlocks: acc.emitterBlocks,
    recipeBlocks: acc.recipeBlocks,
    entryElements: acc.entryElements,
    entryEmitters: acc.entryEmitters,
    uses: acc.uses,
    props: Object.fromEntries(acc.props.entries()),
    paletteRef,
    recipe,
  });
};
