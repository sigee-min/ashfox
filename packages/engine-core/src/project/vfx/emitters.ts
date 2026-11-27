import type { Vec3 } from '../../model/identity';
import type {
  VfxBlendMode,
  VfxEmitterShape,
  VfxEmitterShapeParams,
  VfxEmitterSpec,
  VfxParticleShape,
  VfxPrimitiveSpec,
} from '../../vfx/contract';
import type { AshfoxExpr, AshfoxNamedBlock } from '../program/syntax/blockAst';
import { collectBlockAssigns } from '../program/syntax/blockLowering';
import {
  asColorRoleList,
  asName,
  asNumber,
  asNumberCurve,
  asPointList,
  asRange,
  asVec3,
  failVfx,
} from './expr';

const readSlashArc = (props: Map<string, AshfoxExpr>, file: string): VfxPrimitiveSpec => {
  const [innerRadius, outerRadius] = props.has('radius')
    ? asRange(props.get('radius')!, file)
    : [6, 16];
  const [thetaStartDeg, thetaEndDeg] = props.has('arc')
    ? asRange(props.get('arc')!, file)
    : [-75, 95];
  const crossed = props.get('crossed');
  return {
    kind: 'slash_arc',
    innerRadius,
    outerRadius,
    thetaStartDeg,
    thetaEndDeg,
    ...(props.has('pitch') ? { pitchTwistDeg: asNumber(props.get('pitch')!, file) } : {}),
    ...(props.has('segments') ? { segments: asNumber(props.get('segments')!, file) } : {}),
    ...(crossed?.kind === 'boolean' ? { crossed: crossed.value } : {}),
  };
};

const readRingPrim = (props: Map<string, AshfoxExpr>, file: string): VfxPrimitiveSpec => {
  const [innerRadius, outerRadius] = props.has('radius')
    ? asRange(props.get('radius')!, file)
    : [4, 14];
  return {
    kind: 'ring',
    innerRadius,
    outerRadius,
    ...(props.has('segments') ? { segments: asNumber(props.get('segments')!, file) } : {}),
    ...(props.has('bevel') ? { bevelHeight: asNumber(props.get('bevel')!, file) } : {}),
    ...(props.has('ripple_amp') ? { rippleAmp: asNumber(props.get('ripple_amp')!, file) } : {}),
    ...(props.has('ripple_freq') ? { rippleFreq: asNumber(props.get('ripple_freq')!, file) } : {}),
  };
};

const readBeamPrim = (props: Map<string, AshfoxExpr>, file: string): VfxPrimitiveSpec => {
  const start: Vec3 = props.has('start') ? asVec3(props.get('start')!, file) : [0, 32, 0];
  const end: Vec3 = props.has('end') ? asVec3(props.get('end')!, file) : [0, 0, 0];
  const width = props.has('width') ? asNumber(props.get('width')!, file) : 3;
  const styleRaw = props.has('style') ? asName(props.get('style')!, file) : 'lightning';
  return {
    kind: 'beam',
    start,
    end,
    width,
    style: styleRaw === 'column' ? 'column' : 'lightning',
    ...(props.has('jagged') ? { jaggedAmp: asNumber(props.get('jagged')!, file) } : {}),
    ...(props.has('forks') ? { forks: asNumber(props.get('forks')!, file) } : {}),
    ...(props.has('seed') ? { seed: asNumber(props.get('seed')!, file) } : {}),
  };
};

const readRibbonPrim = (props: Map<string, AshfoxExpr>, file: string): VfxPrimitiveSpec => ({
  kind: 'ribbon',
  points: props.has('points')
    ? asPointList(props.get('points')!, file)
    : ([
        [-6, 4, 0],
        [0, 8, 0],
        [6, 4, 0],
      ] as const),
  widthStart: props.has('width_start') ? asNumber(props.get('width_start')!, file) : 3,
  widthEnd: props.has('width_end') ? asNumber(props.get('width_end')!, file) : 0.4,
  profile:
    props.has('profile') && asName(props.get('profile')!, file) === 'tube' ? 'tube' : 'crossed',
});

const readDomePrim = (props: Map<string, AshfoxExpr>, file: string): VfxPrimitiveSpec => {
  const shapeRaw = props.has('shape') ? asName(props.get('shape')!, file) : 'hemisphere';
  const shape =
    shapeRaw === 'sphere' || shapeRaw === 'cone' || shapeRaw === 'torus' ? shapeRaw : 'hemisphere';
  return {
    kind: 'dome',
    shape,
    radius: props.has('radius') ? asNumber(props.get('radius')!, file) : 10,
    ...(props.has('inner_radius')
      ? { innerRadius: asNumber(props.get('inner_radius')!, file) }
      : {}),
    ...(props.has('height') ? { height: asNumber(props.get('height')!, file) } : {}),
    subdiv: props.has('subdiv') && asNumber(props.get('subdiv')!, file) >= 2 ? 2 : 1,
  };
};

export const readVfxPrimitive = (
  kindName: string,
  props: Map<string, AshfoxExpr>,
  file: string,
): VfxPrimitiveSpec => {
  if (kindName === 'slash_arc') return readSlashArc(props, file);
  if (kindName === 'ring') return readRingPrim(props, file);
  if (kindName === 'beam') return readBeamPrim(props, file);
  if (kindName === 'ribbon') return readRibbonPrim(props, file);
  return readDomePrim(props, file);
};

const readEmitterShape = (
  expr: AshfoxExpr | undefined,
  fallbackType: string,
  file: string,
): { readonly shape: VfxEmitterShape; readonly params?: VfxEmitterShapeParams } => {
  if (!expr)
    return { shape: fallbackType === 'voxel_burst' ? 'cone' : (fallbackType as VfxEmitterShape) };
  if (expr.kind === 'path') return { shape: expr.value as VfxEmitterShape };
  if (expr.kind !== 'call') return failVfx(file, expr.span, 'emitter shape', expr.kind);
  const shape = expr.callee as VfxEmitterShape;
  const args = expr.args.map((a) => asNumber(a, file));
  if (shape === 'cone') return { shape, params: { angleDeg: args[0] ?? 45, radius: args[1] ?? 2 } };
  if (shape === 'sphere' || shape === 'ring') return { shape, params: { radius: args[0] ?? 4 } };
  if (shape === 'arc') return { shape, params: { radius: args[0] ?? 4, sweepDeg: args[1] ?? 180 } };
  return { shape };
};

const readTurbulence = (expr: AshfoxExpr | undefined, file: string) =>
  expr?.kind === 'call'
    ? {
        mode: 'curl' as const,
        freq: expr.args[0] ? asNumber(expr.args[0], file) : 1.5,
        amp: expr.args[1] ? asNumber(expr.args[1], file) : 5,
      }
    : undefined;

const readVortex = (block: AshfoxNamedBlock | undefined, file: string) => {
  if (!block) return undefined;
  const v = collectBlockAssigns(block.block, file, failVfx, true);
  return {
    axis: (v.has('axis') ? asVec3(v.get('axis')!, file) : [0, 1, 0]) as Vec3,
    center: (v.has('center') ? asVec3(v.get('center')!, file) : [0, 4, 0]) as Vec3,
    strength: v.has('strength') ? asNumber(v.get('strength')!, file) : 6,
  };
};

const readGround = (block: AshfoxNamedBlock | undefined, file: string) => {
  if (!block) return undefined;
  const g = collectBlockAssigns(block.block, file, failVfx, true);
  return {
    y: g.has('y') ? asNumber(g.get('y')!, file) : 0,
    bounce: g.has('bounce') ? asNumber(g.get('bounce')!, file) : 0.45,
    friction: g.has('friction') ? asNumber(g.get('friction')!, file) : 0.7,
  };
};

const readBlendMode = (expr: AshfoxExpr | undefined, file: string): VfxBlendMode | undefined => {
  if (!expr) return undefined;
  const blend = asName(expr, file);
  return blend === 'additive' || blend === 'blend' || blend === 'premul' ? blend : undefined;
};

const readEmitterOptional = (
  props: Map<string, AshfoxExpr>,
  groundBlock: AshfoxNamedBlock | undefined,
  vortexBlock: AshfoxNamedBlock | undefined,
  file: string,
) => {
  const turbulence = readTurbulence(props.get('turbulence'), file);
  const vortex = readVortex(vortexBlock, file);
  const ground = readGround(groundBlock, file);
  const blendMode = readBlendMode(props.get('blend'), file);
  return {
    ...(turbulence ? { turbulence } : {}),
    ...(vortex ? { vortex } : {}),
    ...(ground ? { ground } : {}),
    ...(blendMode ? { blendMode } : {}),
  };
};

const collectEmitterChildren = (stmt: AshfoxNamedBlock, file: string) => {
  const props = new Map<string, AshfoxExpr>();
  let ground: AshfoxNamedBlock | undefined;
  let vortex: AshfoxNamedBlock | undefined;
  for (const child of stmt.block.statements) {
    if (child.kind === 'assign') props.set(child.path, child.value);
    else if (child.kind !== 'named-block')
      failVfx(file, child.span, 'emitter statement', child.kind);
    else if (child.blockKind === 'ground') ground = child;
    else if (child.blockKind === 'vortex') vortex = child;
    else failVfx(file, child.span, 'emitter statement', child.blockKind, ['ground', 'vortex']);
  }
  return { props, ground, vortex };
};

const numOr = (
  props: Map<string, AshfoxExpr>,
  key: string,
  fallback: number,
  file: string,
): number => (props.has(key) ? asNumber(props.get(key)!, file) : fallback);

const DEFAULT_SIZE_CURVE = [
  { t: 0, value: 1 },
  { t: 1, value: 0 },
] as const;

export const readVfxEmitter = (stmt: AshfoxNamedBlock, file: string): VfxEmitterSpec => {
  const id = stmt.name ?? failVfx(file, stmt.span, 'emitter id', 'anonymous');
  const { props, ground, vortex } = collectEmitterChildren(stmt, file);
  const [startTime, endTime] = props.has('at') ? asRange(props.get('at')!, file) : [0, 0.5];
  const { shape, params } = readEmitterShape(props.get('shape'), stmt.typeRef ?? 'cone', file);
  const [speedMin, speedMax] = props.has('speed') ? asRange(props.get('speed')!, file) : [8, 18];
  const [lifeMin, lifeMax] = props.has('life') ? asRange(props.get('life')!, file) : [0.25, 0.55];
  const sizeExpr = props.get('size_over_life');
  const colorExpr = props.get('color_over_life');
  const stretchExpr = props.get('velocity_stretch');
  const spinExpr = props.get('spin_speed');
  const particleExpr = props.get('particle');
  return {
    id,
    startTime,
    endTime,
    seed: numOr(props, 'seed', 42, file),
    count: numOr(props, 'count', 20, file),
    shape,
    ...(params ? { shapeParams: params } : {}),
    particle: (particleExpr ? asName(particleExpr, file) : 'shard') as VfxParticleShape,
    speedMin,
    speedMax,
    lifeMin,
    lifeMax,
    gravity: numOr(props, 'gravity', -20, file),
    drag: numOr(props, 'drag', 1.0, file),
    sizeOverLife: sizeExpr ? asNumberCurve(sizeExpr, file) : [...DEFAULT_SIZE_CURVE],
    colorOverLife: colorExpr ? asColorRoleList(colorExpr, file) : ['core', 'mid', 'edge'],
    ...(stretchExpr ? { velocityStretch: asNumber(stretchExpr, file) } : {}),
    ...(spinExpr ? { spinSpeedDeg: asNumber(spinExpr, file) } : {}),
    ...readEmitterOptional(props, ground, vortex, file),
  };
};
