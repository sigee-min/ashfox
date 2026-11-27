import type {
  AssetDeclaration,
  AssetGeometryStatement,
  AssetQualifiedName,
} from '../../../project/program/asset/contract';
import type {
  ProgramChartStatement,
  ProgramExpr,
  ProgramProperty,
  ProgramTextureDecl,
  ProgramTextureStatement,
} from '../../../project/program/syntax/contract';
import type { WorkspaceCompilationFile } from '../../../project/workspace/closure';
import { parseHooksSource } from '../../../hooks/parse';
import { collectUsedHookAliases } from '../../../hooks/resolve';

export interface FileRefSet {
  readonly aliases: Set<string>;
  readonly decls: Set<string>;
  readonly remoteDecls: Set<string>;
  readonly localDecls: ReadonlySet<string>;
  readonly fileImports: ReadonlyMap<string, string>;
}

const noop = (): void => {};

const dottedName = (expr: ProgramExpr): string | null => {
  if (expr.kind === 'name') return expr.value;
  if (expr.kind !== 'member') return null;
  const obj = dottedName(expr.object);
  return obj === null ? null : obj + '.' + expr.member;
};

const recordDottedRef = (name: string, refs: FileRefSet): void => {
  if (!name.includes('.')) return;
  const segments = name.split('.');
  const head = segments[0]!;
  if (refs.fileImports.has(head)) {
    refs.aliases.add(head);
    const targetKey = refs.fileImports.get(head);
    if (targetKey !== undefined && segments[1])
      refs.remoteDecls.add(`${targetKey}\u0000${segments[1]}`);
    return;
  }
  if (refs.localDecls.has(head)) refs.decls.add(head);
};

type ExprWalker = (expr: ProgramExpr, refs: FileRefSet) => void;

const exprWalker =
  <K extends ProgramExpr['kind']>(
    walk: (expr: Extract<ProgramExpr, { readonly kind: K }>, refs: FileRefSet) => void,
  ): ExprWalker =>
  (expr, refs) =>
    walk(expr as Extract<ProgramExpr, { readonly kind: K }>, refs);

const walkNameOrMember = (
  expr: Extract<ProgramExpr, { readonly kind: 'name' | 'member' }>,
  refs: FileRefSet,
): void => {
  const dotted = dottedName(expr);
  if (dotted !== null) recordDottedRef(dotted, refs);
  if (expr.kind === 'member') walkExpr(expr.object, refs);
};

const EXPR_WALKERS: Readonly<Record<ProgramExpr['kind'], ExprWalker>> = {
  number: noop,
  string: noop,
  boolean: noop,
  color: noop,
  name: exprWalker<'name'>(walkNameOrMember),
  member: exprWalker<'member'>(walkNameOrMember),
  unary: exprWalker<'unary'>((expr, refs) => walkExpr(expr.operand, refs)),
  binary: exprWalker<'binary'>((expr, refs) => {
    walkExpr(expr.left, refs);
    walkExpr(expr.right, refs);
  }),
  vector: exprWalker<'vector'>((expr, refs) => {
    for (const item of expr.values) walkExpr(item, refs);
  }),
  call: exprWalker<'call'>((expr, refs) => {
    for (const arg of expr.args) walkExpr(arg, refs);
  }),
};

export const walkExpr = (expr: ProgramExpr | null | undefined, refs: FileRefSet): void => {
  if (!expr) return;
  EXPR_WALKERS[expr.kind](expr, refs);
};

const walkPair = (
  pair: readonly [ProgramExpr, ProgramExpr] | null | undefined,
  refs: FileRefSet,
): void => {
  if (!pair) return;
  walkExpr(pair[0], refs);
  walkExpr(pair[1], refs);
};

const walkQName = (qname: AssetQualifiedName | null | undefined, refs: FileRefSet): void => {
  if (!qname || qname.segments.length !== 2) return;
  const alias = qname.segments[0]!;
  if (refs.fileImports.has(alias)) refs.aliases.add(alias);
};

const walkProps = (props: readonly ProgramProperty[], refs: FileRefSet): void => {
  for (const prop of props) walkExpr(prop.value, refs);
};

type ChartStmtWalker = (stmt: ProgramChartStatement, refs: FileRefSet) => void;

const chartWalker =
  <K extends ProgramChartStatement['kind']>(
    walk: (stmt: Extract<ProgramChartStatement, { readonly kind: K }>, refs: FileRefSet) => void,
  ): ChartStmtWalker =>
  (stmt, refs) =>
    walk(stmt as Extract<ProgramChartStatement, { readonly kind: K }>, refs);

const walkChartStmts = (stmts: readonly ProgramChartStatement[], refs: FileRefSet): void => {
  for (const stmt of stmts) CHART_STMT_WALKERS[stmt.kind](stmt, refs);
};

const CHART_STMT_WALKERS: Readonly<Record<ProgramChartStatement['kind'], ChartStmtWalker>> = {
  property: chartWalker<'property'>((stmt, refs) => walkExpr(stmt.value, refs)),
  pattern: chartWalker<'pattern'>((stmt, refs) => walkProps(stmt.properties, refs)),
  stamp: chartWalker<'stamp'>((stmt, refs) => walkProps(stmt.properties, refs)),
  face: chartWalker<'face'>((stmt, refs) => walkChartStmts(stmt.statements, refs)),
  coverage: noop,
};

type TextureStmtWalker = (stmt: ProgramTextureStatement, refs: FileRefSet) => void;

const textureWalker =
  <K extends ProgramTextureStatement['kind']>(
    walk: (stmt: Extract<ProgramTextureStatement, { readonly kind: K }>, refs: FileRefSet) => void,
  ): TextureStmtWalker =>
  (stmt, refs) =>
    walk(stmt as Extract<ProgramTextureStatement, { readonly kind: K }>, refs);

const TEXTURE_STMT_WALKERS: Readonly<Record<ProgramTextureStatement['kind'], TextureStmtWalker>> = {
  property: textureWalker<'property'>((stmt, refs) => walkExpr(stmt.value, refs)),
  palette: textureWalker<'palette'>((stmt, refs) => walkProps(stmt.properties, refs)),
  'stamp-decl': textureWalker<'stamp-decl'>((stmt, refs) => walkProps(stmt.properties, refs)),
  chart: textureWalker<'chart'>((stmt, refs) => walkChartStmts(stmt.statements, refs)),
  grain: textureWalker<'grain'>((stmt, refs) => walkExpr(stmt.seed?.value, refs)),
  tone: noop,
};

const walkTexture = (texture: ProgramTextureDecl | null, refs: FileRefSet): void => {
  if (!texture) return;
  for (const stmt of texture.statements) TEXTURE_STMT_WALKERS[stmt.kind](stmt, refs);
};

type GeometryStmtWalker = (stmt: AssetGeometryStatement, refs: FileRefSet) => void;

const geometryWalker =
  <K extends AssetGeometryStatement['kind']>(
    walk: (stmt: Extract<AssetGeometryStatement, { readonly kind: K }>, refs: FileRefSet) => void,
  ): GeometryStmtWalker =>
  (stmt, refs) =>
    walk(stmt as Extract<AssetGeometryStatement, { readonly kind: K }>, refs);

const walkGeometry = (stmts: readonly AssetGeometryStatement[], refs: FileRefSet): void => {
  for (const stmt of stmts) GEOMETRY_STMT_WALKERS[stmt.kind](stmt, refs);
};

const GEOMETRY_STMT_WALKERS: Readonly<Record<AssetGeometryStatement['kind'], GeometryStmtWalker>> =
  {
    'geometry-property': geometryWalker<'geometry-property'>((stmt, refs) =>
      walkExpr(stmt.value, refs),
    ),
    'geometry-block': geometryWalker<'geometry-block'>((stmt, refs) =>
      walkGeometry(stmt.statements, refs),
    ),
    'geometry-surface-bind': noop,
  };

const walkRigContract = (
  decl: Extract<AssetDeclaration, { readonly kind: 'rig-contract' }>,
  refs: FileRefSet,
): void => {
  walkProps(decl.frame?.properties ?? [], refs);
  for (const j of decl.joints) {
    walkProps(j.frame?.properties ?? [], refs);
    walkPair(j.limits?.pitch, refs);
    walkPair(j.limits?.yaw, refs);
    walkPair(j.limits?.roll, refs);
  }
  for (const ik of decl.ikLimbs) {
    walkExpr(ik.pole, refs);
    walkExpr(ik.ground, refs);
  }
  for (const anchor of decl.anchors) walkExpr(anchor.offset, refs);
  for (const s of decl.sockets) {
    walkQName(s.contract, refs);
    walkProps(s.frame?.properties ?? [], refs);
  }
};

const walkSkeleton = (
  decl: Extract<AssetDeclaration, { readonly kind: 'skeleton' }>,
  refs: FileRefSet,
): void => {
  walkQName(decl.implements, refs);
  for (const b of decl.binds) {
    walkExpr(b.parentOrigin, refs);
    walkProps(b.frame?.properties ?? [], refs);
  }
};

const walkSurfaceContract = (
  decl: Extract<AssetDeclaration, { readonly kind: 'surface-contract' }>,
  refs: FileRefSet,
): void => {
  walkExpr(decl.atlas?.width, refs);
  walkExpr(decl.atlas?.height, refs);
  for (const ch of decl.charts) {
    walkExpr(ch.width, refs);
    walkExpr(ch.height, refs);
  }
};

const walkSurface = (
  decl: Extract<AssetDeclaration, { readonly kind: 'surface' }>,
  refs: FileRefSet,
): void => {
  walkQName(decl.contract, refs);
  for (const prop of decl.materialProperties ?? []) walkExpr(prop.value, refs);
  for (const slot of decl.slots) walkExpr(slot.value, refs);
  walkTexture(decl.texture, refs);
};

const walkMotionTracks = (
  tracks: Extract<AssetDeclaration, { readonly kind: 'motion' }>['tracks'],
  refs: FileRefSet,
): void => {
  for (const t of tracks) {
    for (const k of t.keyframes) {
      walkExpr(k.time, refs);
      walkExpr(k.value, refs);
      for (const a of k.curve.args) walkExpr(a, refs);
    }
  }
};

const walkMotionWaves = (
  waves: Extract<AssetDeclaration, { readonly kind: 'motion' }>['waves'],
  refs: FileRefSet,
): void => {
  for (const w of waves) {
    walkExpr(w.expression, refs);
    walkExpr(w.scale, refs);
    for (const a of w.args) walkExpr(a.value, refs);
  }
};

const walkMotionExtras = (
  decl: Extract<AssetDeclaration, { readonly kind: 'motion' }>,
  refs: FileRefSet,
): void => {
  for (const ik of decl.iks) {
    for (const fl of ik.footLocks) walkPair(fl, refs);
  }
  for (const s of decl.secondaries) walkProps(s.properties, refs);
  for (const c of decl.combatOps) {
    walkProps(c.properties, refs);
    walkPair(c.timeRange, refs);
  }
  for (const cue of decl.cues) {
    walkExpr(cue.time, refs);
    walkExpr(cue.endTime, refs);
    walkProps(cue.payload, refs);
  }
};

const walkMotion = (
  decl: Extract<AssetDeclaration, { readonly kind: 'motion' }>,
  refs: FileRefSet,
): void => {
  walkQName(decl.rig, refs);
  walkProps(decl.properties, refs);
  walkMotionTracks(decl.tracks, refs);
  walkMotionWaves(decl.waves, refs);
  for (const p of decl.poses) for (const e of p.entries) walkExpr(e.value, refs);
  for (const pk of decl.poseKeys) {
    walkExpr(pk.time, refs);
    for (const a of pk.curve.args) walkExpr(a, refs);
  }
  for (const l of decl.layers) {
    walkProps(l.properties, refs);
    walkProps(l.gait?.properties ?? [], refs);
    walkMotionTracks(l.tracks, refs);
    walkMotionWaves(l.waves, refs);
    for (const pk of l.poseKeys) walkExpr(pk.time, refs);
  }
  for (const exp of decl.expressions ?? []) {
    for (const entry of exp.entries) {
      walkExpr(entry.startTime, refs);
      walkExpr(entry.endTime, refs);
    }
  }
  walkMotionExtras(decl, refs);
};

const walkAsset = (
  decl: Extract<AssetDeclaration, { readonly kind: 'asset' }>,
  refs: FileRefSet,
): void => {
  walkExpr(decl.settings?.density, refs);
  walkQName(decl.skeleton, refs);
  for (const m of decl.motions) walkQName(m, refs);
  for (const u of decl.uses) {
    walkQName(u.component, refs);
    for (const p of u.parameterSets) walkExpr(p.value, refs);
    for (const pb of u.portBindings) walkQName(pb.target, refs);
  }
};

const walkComponent = (
  decl: Extract<AssetDeclaration, { readonly kind: 'component' }>,
  refs: FileRefSet,
): void => {
  for (const port of decl.ports) walkQName(port.type, refs);
  for (const sb of decl.socketBindings) walkProps(sb.frame?.properties ?? [], refs);
  walkGeometry(decl.geometry.statements, refs);
};

type DeclWalker = (decl: AssetDeclaration, refs: FileRefSet) => void;

const declWalker =
  <K extends AssetDeclaration['kind']>(
    walk: (decl: Extract<AssetDeclaration, { readonly kind: K }>, refs: FileRefSet) => void,
  ): DeclWalker =>
  (decl, refs) =>
    walk(decl as Extract<AssetDeclaration, { readonly kind: K }>, refs);

const DECL_WALKERS: Readonly<Record<AssetDeclaration['kind'], DeclWalker>> = {
  design: declWalker<'design'>((decl, refs) => {
    for (const f of decl.fields) walkExpr(f.value, refs);
    for (const c of decl.checks) walkExpr(c.value, refs);
  }),
  'socket-contract': declWalker<'socket-contract'>((decl, refs) => {
    walkProps(decl.frame?.properties ?? [], refs);
  }),
  'rig-contract': declWalker<'rig-contract'>(walkRigContract),
  skeleton: declWalker<'skeleton'>(walkSkeleton),
  'surface-contract': declWalker<'surface-contract'>(walkSurfaceContract),
  surface: declWalker<'surface'>(walkSurface),
  motion: declWalker<'motion'>(walkMotion),
  asset: declWalker<'asset'>(walkAsset),
  component: declWalker<'component'>(walkComponent),
};

const walkDeclaration = (decl: AssetDeclaration, refs: FileRefSet): void => {
  DECL_WALKERS[decl.kind](decl, refs);
};

export const collectDeclRefs = (
  decl: AssetDeclaration,
  fileImports: ReadonlyMap<string, string>,
  localDecls: ReadonlySet<string>,
): FileRefSet => {
  const refs: FileRefSet = {
    aliases: new Set<string>(),
    decls: new Set<string>(),
    remoteDecls: new Set<string>(),
    localDecls,
    fileImports,
  };
  walkDeclaration(decl, refs);
  return refs;
};

export const collectFileAliasRefs = (
  file: WorkspaceCompilationFile,
  fileImports: ReadonlyMap<string, string>,
): ReadonlySet<string> => {
  const localDecls = new Set(file.unit.declarations.map((d) => d.id));
  const refs: FileRefSet = {
    aliases: new Set<string>(),
    decls: new Set<string>(),
    remoteDecls: new Set<string>(),
    localDecls,
    fileImports,
  };
  for (const decl of file.unit.declarations) walkDeclaration(decl, refs);
  const hookAliases = collectUsedHookAliases(
    parseHooksSource(file.source, file.identity.path, { allowHostStatements: true }).unit,
  );
  for (const alias of hookAliases) {
    if (fileImports.has(alias)) refs.aliases.add(alias);
  }
  return refs.aliases;
};
