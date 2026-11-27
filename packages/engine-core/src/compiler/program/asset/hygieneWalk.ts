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

export const walkExpr = (expr: ProgramExpr | null | undefined, refs: FileRefSet): void => {
  if (!expr) return;
  if (expr.kind === 'name' || expr.kind === 'member') {
    const dotted = dottedName(expr);
    if (dotted !== null) recordDottedRef(dotted, refs);
    if (expr.kind === 'member') walkExpr(expr.object, refs);
    return;
  }
  if (expr.kind === 'unary') walkExpr(expr.operand, refs);
  else if (expr.kind === 'binary') {
    walkExpr(expr.left, refs);
    walkExpr(expr.right, refs);
  } else if (expr.kind === 'vector') {
    for (const item of expr.values) walkExpr(item, refs);
  } else if (expr.kind === 'call') {
    for (const arg of expr.args) walkExpr(arg, refs);
  }
};

const walkQName = (qname: AssetQualifiedName | null | undefined, refs: FileRefSet): void => {
  if (!qname || qname.segments.length !== 2) return;
  const alias = qname.segments[0]!;
  if (refs.fileImports.has(alias)) refs.aliases.add(alias);
};

const walkProps = (props: readonly ProgramProperty[], refs: FileRefSet): void => {
  for (const prop of props) walkExpr(prop.value, refs);
};

const walkChartStmts = (stmts: readonly ProgramChartStatement[], refs: FileRefSet): void => {
  for (const stmt of stmts) {
    if (stmt.kind === 'property') walkExpr(stmt.value, refs);
    else if (stmt.kind === 'pattern' || stmt.kind === 'stamp') walkProps(stmt.properties, refs);
    else if (stmt.kind === 'face') walkChartStmts(stmt.statements, refs);
  }
};

const walkTexture = (texture: ProgramTextureDecl | null, refs: FileRefSet): void => {
  if (!texture) return;
  for (const stmt of texture.statements) {
    if (stmt.kind === 'property') walkExpr(stmt.value, refs);
    else if (stmt.kind === 'palette' || stmt.kind === 'stamp-decl')
      walkProps(stmt.properties, refs);
    else if (stmt.kind === 'chart') walkChartStmts(stmt.statements, refs);
    else if (stmt.kind === 'grain' && stmt.seed) walkExpr(stmt.seed.value, refs);
  }
};

const walkGeometry = (stmts: readonly AssetGeometryStatement[], refs: FileRefSet): void => {
  for (const stmt of stmts) {
    if (stmt.kind === 'geometry-property') walkExpr(stmt.value, refs);
    else if (stmt.kind === 'geometry-block') walkGeometry(stmt.statements, refs);
  }
};

const walkRigContract = (
  decl: Extract<AssetDeclaration, { readonly kind: 'rig-contract' }>,
  refs: FileRefSet,
): void => {
  walkProps(decl.frame?.properties ?? [], refs);
  for (const j of decl.joints) {
    walkProps(j.frame?.properties ?? [], refs);
    if (j.limits?.pitch) {
      walkExpr(j.limits.pitch[0], refs);
      walkExpr(j.limits.pitch[1], refs);
    }
    if (j.limits?.yaw) {
      walkExpr(j.limits.yaw[0], refs);
      walkExpr(j.limits.yaw[1], refs);
    }
    if (j.limits?.roll) {
      walkExpr(j.limits.roll[0], refs);
      walkExpr(j.limits.roll[1], refs);
    }
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

const walkSurfaceOrContract = (
  decl: Extract<AssetDeclaration, { readonly kind: 'surface' | 'surface-contract' }>,
  refs: FileRefSet,
): void => {
  if (decl.kind === 'surface-contract') {
    walkExpr(decl.atlas?.width, refs);
    walkExpr(decl.atlas?.height, refs);
    for (const ch of decl.charts) {
      walkExpr(ch.width, refs);
      walkExpr(ch.height, refs);
    }
    return;
  }
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
    for (const fl of ik.footLocks) {
      walkExpr(fl[0], refs);
      walkExpr(fl[1], refs);
    }
  }
  for (const s of decl.secondaries) walkProps(s.properties, refs);
  for (const c of decl.combatOps) {
    walkProps(c.properties, refs);
    if (c.timeRange) {
      walkExpr(c.timeRange[0], refs);
      walkExpr(c.timeRange[1], refs);
    }
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

const walkDeclaration = (decl: AssetDeclaration, refs: FileRefSet): void => {
  switch (decl.kind) {
    case 'design':
      for (const f of decl.fields) walkExpr(f.value, refs);
      for (const c of decl.checks) walkExpr(c.value, refs);
      return;
    case 'socket-contract':
      walkProps(decl.frame?.properties ?? [], refs);
      return;
    case 'rig-contract':
      walkRigContract(decl, refs);
      return;
    case 'skeleton':
      walkSkeleton(decl, refs);
      return;
    case 'surface':
    case 'surface-contract':
      walkSurfaceOrContract(decl, refs);
      return;
    case 'motion':
      walkMotion(decl, refs);
      return;
    case 'asset':
      walkAsset(decl, refs);
      return;
    case 'component':
      walkComponent(decl, refs);
      return;
  }
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
