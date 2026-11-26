import { compareText } from '@ashfox/internal-contracts';
import type { Vec3 } from '../model/identity';
import {
  HOOKS_DOCUMENT_SCHEMA_VERSION,
  type CompiledAnchor,
  type CompiledCue,
  type CompiledMeta,
  type CompiledVolume,
  type CompiledZone,
  type HookAnchorDecl,
  type HookCueDecl,
  type HookMetaDecl,
  type HookParentRef,
  type HooksDocument,
  type HookSourceSpan,
  type HookSourceUnit,
  type HookValidationOptions,
  type HookValidationResult,
  type HookVolumeDecl,
  type HookZoneDecl,
} from './contract';
import { buildObbFromBox, facingToNormal, facingToYawDegrees, obbToAabb } from './transform';
import {
  checkParentValid,
  compilePropsAgainstSchema,
  isValidAssetReference,
  isValidMcBlockState,
  isValidMcBlockTemplate,
  pushDiag,
  registerSchemas,
  type ValidationContext,
} from './validateChecks';

const validateBoxBounds = (
  ctx: ValidationContext,
  hook: HookVolumeDecl | HookZoneDecl,
): { readonly min: Vec3; readonly max: Vec3 } => {
  const zero: Vec3 = Object.freeze([0, 0, 0]);
  const from = hook.from ?? zero;
  const to = hook.to ?? zero;
  if (hook.from && hook.to && (from[0] > to[0] || from[1] > to[1] || from[2] > to[2])) {
    pushDiag(
      ctx,
      'hooks.invalid-volume-bounds',
      `Volume "${hook.id}" has inverted bounds.`,
      hook.span,
      hook.id,
    );
  }
  return { min: from, max: to };
};

const validateCueTiming = (ctx: ValidationContext, cue: HookCueDecl): void => {
  if (cue.at !== undefined && (cue.from !== undefined || cue.to !== undefined)) {
    pushDiag(
      ctx,
      'hooks.invalid-cue-timing',
      `Cue "${cue.id}" mixes "at" and "from..to".`,
      cue.span,
      cue.id,
    );
  }
  const neg =
    (cue.at !== undefined && cue.at < 0) ||
    (cue.from !== undefined && cue.from < 0) ||
    (cue.to !== undefined && cue.to < 0);
  if (neg) {
    pushDiag(
      ctx,
      'hooks.invalid-cue-timing',
      `Cue "${cue.id}" timing must be >= 0.`,
      cue.span,
      cue.id,
    );
  }
  if (cue.from !== undefined && cue.to !== undefined && cue.from > cue.to) {
    pushDiag(ctx, 'hooks.invalid-cue-timing', `Cue "${cue.id}" has from > to.`, cue.span, cue.id);
  }
  if (cue.frame !== undefined && (!Number.isInteger(cue.frame) || cue.frame < 0)) {
    pushDiag(
      ctx,
      'hooks.invalid-cue-timing',
      `Cue "${cue.id}" frame must be >= 0 int.`,
      cue.span,
      cue.id,
    );
  }
};

export { isValidAssetReference, isValidMcBlockState, isValidMcBlockTemplate };

const ZERO3: Vec3 = Object.freeze([0, 0, 0]);
const DEFAULT_NORMAL: Vec3 = Object.freeze([0, 0, 1]);

const parentTags = (
  parent: HookParentRef | undefined,
): Partial<Pick<CompiledAnchor, 'room' | 'bone' | 'floor'>> => ({
  ...(parent?.kind === 'room' ? { room: parent.id } : {}),
  ...(parent?.kind === 'bone' ? { bone: parent.id } : {}),
  ...(parent?.kind === 'floor' ? { floor: parent.id } : {}),
});

const checkUniqueId = (
  ctx: ValidationContext,
  seen: Set<string>,
  id: string,
  span: HookSourceSpan,
): void => {
  if (seen.has(id)) pushDiag(ctx, 'hooks.duplicate-id', `Duplicate hook id "${id}".`, span, id);
  seen.add(id);
};

const resolveMcOverrides = (
  ctx: ValidationContext,
  spatialIds: ReadonlySet<string>,
): ReadonlyMap<string, string> => {
  const map = new Map<string, string>();
  for (const decl of ctx.unit.mcBlocks) {
    if (!spatialIds.has(decl.targetId)) {
      pushDiag(
        ctx,
        'hooks.unknown-mc-block-target',
        `mc_block target "${decl.targetId}" does not exist.`,
        decl.span,
        decl.targetId,
      );
    }
    if (!isValidMcBlockState(decl.blockState)) {
      pushDiag(
        ctx,
        'hooks.invalid-mc-block',
        `Invalid mc_block state "${decl.blockState}".`,
        decl.span,
        decl.blockState,
      );
    }
    map.set(decl.targetId, decl.blockState);
  }
  return map;
};

const renderMcBlockTemplate = (
  template: string | undefined,
  facing: string | undefined,
  props: Readonly<Record<string, unknown>>,
): string | undefined => {
  if (!template) return undefined;
  return template.replace(/\$\{([A-Za-z_][A-Za-z0-9_]*)\}/g, (_all, key: string) => {
    if (key === 'facing') return facing ?? 'north';
    const val = props[key];
    return val === undefined ? '' : String(val);
  });
};

const compileAnchor = (
  ctx: ValidationContext,
  a: HookAnchorDecl,
  seenIds: Set<string>,
  mcOverrides: ReadonlyMap<string, string>,
): CompiledAnchor => {
  checkUniqueId(ctx, seenIds, a.id, a.span);
  checkParentValid(ctx, a.parent, a.id, a.span);
  const compiled = compilePropsAgainstSchema(ctx, a.schema, 'anchor', a.props, a.span);
  const propMc = typeof compiled.props.mc_block === 'string' ? compiled.props.mc_block : undefined;
  const schemaMc = renderMcBlockTemplate(compiled.schemaMcBlock, a.facing, compiled.props);
  const mcBlock = mcOverrides.get(a.id) ?? a.mcBlock ?? propMc ?? schemaMc;
  if (mcBlock !== undefined && !isValidMcBlockState(mcBlock)) {
    pushDiag(
      ctx,
      'hooks.invalid-mc-block',
      `Invalid mc_block state "${mcBlock}".`,
      a.span,
      mcBlock,
    );
  }
  const normal: Vec3 = a.normal ?? (a.facing ? facingToNormal(a.facing) : DEFAULT_NORMAL);
  const rotation: Vec3 =
    a.rotate ?? Object.freeze([0, a.facing ? facingToYawDegrees(a.facing) : 0, 0]);
  return Object.freeze({
    id: a.id,
    schema: compiled.canonicalSchema,
    position: a.at ?? ZERO3,
    normal,
    rotation,
    space: a.space,
    ...(a.parent ? { parent: a.parent } : {}),
    ...parentTags(a.parent),
    ...(mcBlock ? { mcBlock } : {}),
    props: compiled.props,
  });
};

const compileVolume = (
  ctx: ValidationContext,
  v: HookVolumeDecl,
  seenIds: Set<string>,
  mcOverrides: ReadonlyMap<string, string>,
): CompiledVolume => {
  checkUniqueId(ctx, seenIds, v.id, v.span);
  checkParentValid(ctx, v.parent, v.id, v.span);
  const compiled = compilePropsAgainstSchema(ctx, v.schema, 'volume', v.props, v.span);
  const bounds = validateBoxBounds(ctx, v);
  const obb = buildObbFromBox(bounds.min, bounds.max, v.rotate);
  const aabb = obbToAabb(obb);
  const propMc = typeof compiled.props.mc_block === 'string' ? compiled.props.mc_block : undefined;
  const schemaMc = renderMcBlockTemplate(compiled.schemaMcBlock, undefined, compiled.props);
  const mcBlock = mcOverrides.get(v.id) ?? v.mcBlock ?? propMc ?? schemaMc;
  if (mcBlock !== undefined && !isValidMcBlockState(mcBlock)) {
    pushDiag(
      ctx,
      'hooks.invalid-mc-block',
      `Invalid mc_block state "${mcBlock}".`,
      v.span,
      mcBlock,
    );
  }
  return Object.freeze({
    id: v.id,
    schema: compiled.canonicalSchema,
    min: aabb.min,
    max: aabb.max,
    obb,
    space: v.space,
    ...(v.parent ? { parent: v.parent } : {}),
    ...parentTags(v.parent),
    ...(v.enclosure ? { enclosure: v.enclosure } : {}),
    ...(mcBlock ? { mcBlock } : {}),
    props: compiled.props,
  });
};

const compileCue = (ctx: ValidationContext, c: HookCueDecl, seenIds: Set<string>): CompiledCue => {
  checkUniqueId(ctx, seenIds, c.id, c.span);
  validateCueTiming(ctx, c);
  const compiled = compilePropsAgainstSchema(ctx, c.schema, 'cue', c.props, c.span);
  return Object.freeze({
    id: c.id,
    schema: compiled.canonicalSchema,
    ...(c.clip ? { clip: c.clip } : {}),
    ...(c.at !== undefined ? { at: c.at } : {}),
    ...(c.from !== undefined ? { from: c.from } : {}),
    ...(c.to !== undefined ? { to: c.to } : {}),
    ...(c.frame !== undefined ? { frame: c.frame } : {}),
    props: compiled.props,
  });
};

const compileMeta = (
  ctx: ValidationContext,
  m: HookMetaDecl,
  seenIds: Set<string>,
): CompiledMeta => {
  checkUniqueId(ctx, seenIds, m.id, m.span);
  const compiled = compilePropsAgainstSchema(ctx, m.schema, 'meta', m.props, m.span);
  return Object.freeze({
    id: m.id,
    schema: compiled.canonicalSchema,
    ...(m.target ? { target: m.target } : {}),
    props: compiled.props,
  });
};

const compileZone = (
  ctx: ValidationContext,
  z: HookZoneDecl,
  seenIds: Set<string>,
): CompiledZone => {
  checkUniqueId(ctx, seenIds, z.id, z.span);
  checkParentValid(ctx, z.parent, z.id, z.span);
  const bounds = validateBoxBounds(ctx, z);
  const obb = buildObbFromBox(bounds.min, bounds.max);
  const aabb = obbToAabb(obb);
  const compiled = z.schema
    ? compilePropsAgainstSchema(ctx, z.schema, 'volume', z.props, z.span)
    : { canonicalSchema: undefined, props: Object.freeze({}) };
  return Object.freeze({
    id: z.id,
    ...(compiled.canonicalSchema ? { schema: compiled.canonicalSchema } : {}),
    min: aabb.min,
    max: aabb.max,
    obb,
    enclosure: z.enclosure,
    ...(z.shape ? { shape: z.shape } : {}),
    ...(z.parent ? { parent: z.parent } : {}),
    props: compiled.props,
  });
};

/** Validate a parsed hooks unit against closed schemas and compile a deterministic `HooksDocument`. */
export const validateHooksUnit = (
  unit: HookSourceUnit,
  options: HookValidationOptions = {},
): HookValidationResult => {
  const ctx: ValidationContext = {
    unit,
    options,
    schemas: new Map(),
    importAliases: new Set(),
    diagnostics: [],
  };
  registerSchemas(ctx);
  const seenIds = new Set<string>();
  const spatialIds = new Set<string>([
    ...unit.anchors.map((a) => a.id),
    ...unit.volumes.map((v) => v.id),
  ]);
  const mcOverrides = resolveMcOverrides(ctx, spatialIds);
  const byId = <T extends { readonly id: string }>(a: T, b: T): number => compareText(a.id, b.id);
  const document: HooksDocument = Object.freeze({
    schemaVersion: HOOKS_DOCUMENT_SCHEMA_VERSION,
    assetId: unit.id,
    schemas: Object.freeze([...unit.schemas].sort(byId)),
    anchors: Object.freeze(
      unit.anchors.map((a) => compileAnchor(ctx, a, seenIds, mcOverrides)).sort(byId),
    ),
    volumes: Object.freeze(
      unit.volumes.map((v) => compileVolume(ctx, v, seenIds, mcOverrides)).sort(byId),
    ),
    cues: Object.freeze(unit.cues.map((c) => compileCue(ctx, c, seenIds)).sort(byId)),
    meta: Object.freeze(unit.meta.map((m) => compileMeta(ctx, m, seenIds)).sort(byId)),
    zones: Object.freeze(unit.zones.map((z) => compileZone(ctx, z, seenIds)).sort(byId)),
  });
  return Object.freeze({
    ok: ctx.diagnostics.length === 0,
    document,
    diagnostics: Object.freeze(ctx.diagnostics),
  });
};
