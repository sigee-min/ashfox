import { compareText } from '../../../stableOrder';
import { canonicalJsonString } from '../../../canonicalJson';
import { deepFreeze } from '../../../immutable';
import type { CompiledModel } from '../../../model/compiled';
import type { AnimationClip } from '../../../model/motion';
import type { SceneGraph, SceneNode } from '../../../model/scene';
import type { TextureAsset } from '../../../model/texture';
import type { AssetBuildIdentity } from '../../../project/asset';
import type { AssetDiagnostic } from '../../../project/program/asset/contract';
import type { SourceSpan } from '../../../project/source/contract';
import type { AuthoredAssetWorkspace, Sha256Digest } from '../../../project/workspace/contract';
import {
  errorDiagnostic,
  sortWorkspaceDiagnostics,
  type SourceRef,
  type WorkspaceDiagnostic,
} from '../../../project/workspace/diagnostic';
import type { WorkspaceEntrySelector } from '../../../project/workspace/graph/contract';
import {
  resolveWorkspaceEntryCompilation,
  type ResolveWorkspaceEntryOptions,
  type WorkspaceEntryCompilation,
} from '../../../project/workspace/graph';
import { computeWorkspaceHash } from '../../../project/workspace/hash';
import { sha256Digest } from '../../../provenance/digest';
import { lowerAssetGeometry } from './canonicalGeometry';
import { lowerAssetRigAndMotions } from './canonicalRig';
import { buildAssetHir } from './hir';
import { checkAssetHygiene } from './hygiene';
import { instantiateAsset } from './instantiate';
import { parentCycles } from './parentCycles';
import type { InstantiatedAssetIr } from './ir';
import type { AssetAuthoringTelemetry, TextureAuthoringTelemetry } from './texture/telemetry';
import { lowerAssetTextures } from './textureBinding';

type CompileAssetWorkspaceFailure = Readonly<{
  readonly ok: false;
  readonly diagnostics: readonly WorkspaceDiagnostic[];
}>;

export type CompileAssetWorkspaceEntryResult =
  | Readonly<{
      readonly ok: true;
      readonly model: CompiledModel;
      readonly build: AssetBuildIdentity;
    }>
  | CompileAssetWorkspaceFailure;

export type CompileAssetWorkspaceDetailedResult =
  | Readonly<{
      readonly ok: true;
      readonly model: CompiledModel;
      readonly build: AssetBuildIdentity;
      readonly telemetry: AssetAuthoringTelemetry;
    }>
  | CompileAssetWorkspaceFailure;

interface RootLocation {
  readonly packageName: string;
  readonly path: string;
  readonly span: SourceSpan;
}

const sourceRef = (packageName: string, path: string, span: SourceSpan): SourceRef =>
  Object.freeze({
    packageName,
    path,
    start: Object.freeze({ ...span.start }),
    end: Object.freeze({ ...span.end }),
  });

const fail = (diagnostics: readonly WorkspaceDiagnostic[]): CompileAssetWorkspaceFailure =>
  deepFreeze({
    ok: false as const,
    diagnostics: sortWorkspaceDiagnostics(diagnostics),
  });

const packageForPath = (
  files: readonly Readonly<{
    readonly identity: Readonly<{
      readonly packageName: string;
      readonly path: string;
    }>;
  }>[],
  path: string,
  fallback: string,
): string => files.find((file) => file.identity.path === path)?.identity.packageName ?? fallback;

const workspaceDiagnostics = (
  diagnostics: readonly AssetDiagnostic[],
  files: readonly Readonly<{
    readonly identity: Readonly<{
      readonly packageName: string;
      readonly path: string;
    }>;
  }>[],
  fallbackPackage: string,
): readonly WorkspaceDiagnostic[] =>
  diagnostics.map((item) =>
    Object.freeze({
      severity: 'error' as const,
      code: item.code,
      message: item.message,
      source: sourceRef(packageForPath(files, item.path, fallbackPackage), item.path, item.span),
    }),
  );

const rootDiagnostic = (
  location: RootLocation,
  code: string,
  message: string,
): WorkspaceDiagnostic =>
  errorDiagnostic(code, message, sourceRef(location.packageName, location.path, location.span));

/** Indexes nodes by id, reporting every repeated id in node order. */
const indexSceneNodes = (
  nodes: readonly SceneNode[],
  location: RootLocation,
  diagnostics: WorkspaceDiagnostic[],
): Map<string, SceneNode> => {
  const byId = new Map<string, SceneNode>();
  for (const node of nodes) {
    if (byId.has(node.id))
      diagnostics.push(
        rootDiagnostic(
          location,
          'asset.canonical-node-duplicate',
          `Canonical node id "${node.id}" is duplicated.`,
        ),
      );
    else byId.set(node.id, node);
  }
  return byId;
};

const rootsMatchParentless = (nodes: readonly SceneNode[], roots: readonly string[]): boolean => {
  const expectedRoots = [...nodes]
    .filter((node) => node.parentId === null)
    .map((node) => node.id)
    .sort(compareText);
  const actualRoots = [...roots].sort(compareText);
  return (
    expectedRoots.length > 0 &&
    canonicalJsonString(expectedRoots) === canonicalJsonString(actualRoots)
  );
};

const hasBoneParent = (node: SceneNode, byId: ReadonlyMap<string, SceneNode>): boolean =>
  node.parentId === null || byId.get(node.parentId)?.kind === 'bone';

/** One missing-texture diagnostic per enabled face without a bound texture. */
const missingTextureCount = (
  node: SceneNode,
  textures: Readonly<Record<string, TextureAsset>>,
): number => {
  if (node.kind !== 'cube' && node.kind !== 'plane') return 0;
  return Object.values(node.faces).filter(
    (face) => face.enabled && (face.textureId === null || textures[face.textureId] === undefined),
  ).length;
};

const nodeDiagnostics = (
  node: SceneNode,
  byId: ReadonlyMap<string, SceneNode>,
  textures: Readonly<Record<string, TextureAsset>>,
  location: RootLocation,
): readonly WorkspaceDiagnostic[] => {
  const diagnostics: WorkspaceDiagnostic[] = [];
  if (!hasBoneParent(node, byId))
    diagnostics.push(
      rootDiagnostic(
        location,
        'asset.canonical-parent',
        `Canonical node "${node.id}" requires an existing bone parent.`,
      ),
    );
  const missing = missingTextureCount(node, textures);
  for (let index = 0; index < missing; index += 1)
    diagnostics.push(
      rootDiagnostic(
        location,
        'asset.canonical-texture',
        `Canonical node "${node.id}" references a missing texture.`,
      ),
    );
  return diagnostics;
};

const motionTargetDiagnostics = (
  animations: Readonly<Record<string, AnimationClip>>,
  byId: ReadonlyMap<string, SceneNode>,
  location: RootLocation,
): readonly WorkspaceDiagnostic[] =>
  Object.values(animations).flatMap((clip) =>
    Object.values(clip.channels)
      .filter((channel) => byId.get(channel.targetNodeId)?.kind !== 'bone')
      .map(() =>
        rootDiagnostic(
          location,
          'asset.canonical-motion-target',
          `Animation "${clip.name}" targets a missing non-bone node.`,
        ),
      ),
  );

const validateScene = (
  nodes: readonly SceneNode[],
  roots: readonly string[],
  animations: Readonly<Record<string, AnimationClip>>,
  textures: Readonly<Record<string, TextureAsset>>,
  location: RootLocation,
): readonly WorkspaceDiagnostic[] => {
  const diagnostics: WorkspaceDiagnostic[] = [];
  const byId = indexSceneNodes(nodes, location, diagnostics);
  if (!rootsMatchParentless(nodes, roots))
    diagnostics.push(
      rootDiagnostic(
        location,
        'asset.canonical-roots',
        'Canonical scene roots do not exactly match parentless nodes.',
      ),
    );
  for (const node of nodes) diagnostics.push(...nodeDiagnostics(node, byId, textures, location));
  diagnostics.push(...motionTargetDiagnostics(animations, byId, location));
  for (const id of parentCycles(nodes, byId))
    diagnostics.push(
      rootDiagnostic(
        location,
        'asset.canonical-parent-cycle',
        `Canonical parent cycle contains node "${id}".`,
      ),
    );
  return diagnostics;
};

type FinalizeModelResult =
  | Readonly<{ readonly ok: true; readonly model: CompiledModel }>
  | Readonly<{ readonly ok: false; readonly diagnostics: readonly WorkspaceDiagnostic[] }>;

const finalizeModel = (
  ir: InstantiatedAssetIr,
  rigNodes: readonly SceneNode[],
  geometryNodes: readonly SceneNode[],
  roots: readonly string[],
  animations: Readonly<Record<string, AnimationClip>>,
  textures: readonly TextureAsset[],
  resolution: readonly [number, number],
  location: RootLocation,
): FinalizeModelResult => {
  const orderedNodes = [...rigNodes, ...geometryNodes].sort((left, right) =>
    compareText(left.id, right.id),
  );
  const textureEntries = [...textures].sort((left, right) => compareText(left.id, right.id));
  const textureRecord: Record<string, TextureAsset> = {};
  for (const texture of textureEntries) {
    if (textureRecord[texture.id] !== undefined)
      return deepFreeze({
        ok: false as const,
        diagnostics: [
          rootDiagnostic(
            location,
            'asset.canonical-texture-duplicate',
            `Canonical texture id "${texture.id}" is duplicated.`,
          ),
        ],
      });
    textureRecord[texture.id] = texture;
  }
  const animationRecord = Object.fromEntries(
    Object.entries(animations).sort(([left], [right]) => compareText(left, right)),
  );
  const diagnostics = validateScene(orderedNodes, roots, animationRecord, textureRecord, location);
  const nodeRecord = Object.fromEntries(orderedNodes.map((node) => [node.id, node]));
  const scene: SceneGraph = {
    roots: Object.freeze([...roots].sort(compareText)),
    nodes: nodeRecord,
  };
  const model: CompiledModel = {
    id: `model:${sha256Digest(ir.asset.key).slice('sha256:'.length)}`,
    name: ir.asset.name,
    forward: ir.settings.forward,
    ...(ir.settings.profile !== null && ir.settings.profile !== undefined
      ? { profile: ir.settings.profile }
      : {}),
    textureDensity: 16,
    textureResolution: Object.freeze([resolution[0], resolution[1]]),
    scene,
    textures: textureRecord,
    animations: animationRecord,
  };
  return diagnostics.length > 0
    ? deepFreeze({ ok: false as const, diagnostics })
    : deepFreeze({ ok: true as const, model: deepFreeze(model) });
};

type LoweringResult =
  | Readonly<{
      readonly ok: true;
      readonly model: CompiledModel;
      readonly telemetry: AssetAuthoringTelemetry;
    }>
  | Readonly<{ readonly ok: false; readonly result: CompileAssetWorkspaceFailure }>;

type GeometryNodes = NonNullable<ReturnType<typeof lowerAssetGeometry>>['nodes'];

type GeometryResult =
  | Readonly<{ readonly ok: true; readonly nodes: GeometryNodes }>
  | Readonly<{ readonly ok: false; readonly diagnostics: readonly AssetDiagnostic[] }>;

const rootLocationOf = (closure: WorkspaceEntryCompilation['closure']): RootLocation => ({
  packageName: closure.root.identity.packageName,
  path: closure.root.identity.path,
  span: closure.root.unit.span,
});

const geometryFailure = (location: RootLocation): AssetDiagnostic =>
  Object.freeze({
    severity: 'error',
    path: location.path,
    span: location.span,
    code: 'asset.canonical-geometry',
    message: 'Canonical geometry lowering failed closed.',
  });

const lowerGeometryStage = (
  ir: InstantiatedAssetIr,
  plans: Parameters<typeof lowerAssetGeometry>[1],
  location: RootLocation,
): GeometryResult => {
  const geometryIssues: AssetDiagnostic[] = [];
  const geometry = lowerAssetGeometry(ir, plans, (path, span, code, message) =>
    geometryIssues.push(Object.freeze({ severity: 'error', path, span, code, message })),
  );
  if (geometryIssues.length > 0) return { ok: false, diagnostics: geometryIssues };
  if (geometry === null) return { ok: false, diagnostics: [geometryFailure(location)] };
  return { ok: true, nodes: geometry.nodes };
};

/** Runs every lowering stage, stopping at the first stage that reports diagnostics. */
const lowerClosure = (closure: WorkspaceEntryCompilation['closure']): LoweringResult => {
  const location = rootLocationOf(closure);
  const failWith = (diagnostics: readonly AssetDiagnostic[]): LoweringResult => ({
    ok: false,
    result: fail(workspaceDiagnostics(diagnostics, closure.files, location.packageName)),
  });
  const hir = buildAssetHir(closure);
  if (!hir.ok) return failWith(hir.diagnostics);
  const hygiene = checkAssetHygiene(closure, hir.hir);
  if (hygiene.length > 0) return failWith(hygiene);
  const instantiated = instantiateAsset(hir.hir);
  if (!instantiated.ok) return failWith(instantiated.diagnostics);
  const textures = lowerAssetTextures(hir.hir, instantiated.ir);
  if (!textures.ok) return failWith(textures.diagnostics);
  const rig = lowerAssetRigAndMotions(instantiated.ir);
  if (!rig.ok) return failWith(rig.diagnostics);
  const geometry = lowerGeometryStage(instantiated.ir, textures.plans, location);
  if (!geometry.ok) return failWith(geometry.diagnostics);
  const finalized = finalizeModel(
    instantiated.ir,
    rig.bones,
    geometry.nodes,
    rig.roots,
    rig.animations,
    textures.plans.map((plan) => plan.texture),
    textures.resolution,
    location,
  );
  if (!finalized.ok) return { ok: false, result: fail(finalized.diagnostics) };
  const textureTelemetry: Record<string, TextureAuthoringTelemetry> = Object.create(null);
  for (const plan of textures.plans) {
    if (plan.telemetry !== undefined) textureTelemetry[plan.texture.id] = plan.telemetry;
  }
  return { ok: true, model: finalized.model, telemetry: { textures: textureTelemetry } };
};

const buildIdentity = (
  workspaceHash: Sha256Digest,
  resolved: WorkspaceEntryCompilation,
  model: CompiledModel,
): AssetBuildIdentity =>
  deepFreeze({
    packageName: resolved.build.packageName,
    entryName: resolved.build.entryName,
    path: resolved.build.entryPath,
    workspaceHash,
    closureHash: resolved.build.closureHash,
    buildKey: resolved.build.buildKey,
    compilerFingerprint: resolved.build.compilerFingerprint,
    productHash: sha256Digest(canonicalJsonString(model)) as Sha256Digest,
  });

/** Internal lowering returning model, build identity, and pre-grain authoring telemetry. */
export const compileResolvedAssetWorkspaceEntryDetailed = (
  workspaceHash: Sha256Digest,
  resolved: WorkspaceEntryCompilation,
): CompileAssetWorkspaceDetailedResult => {
  try {
    const lowered = lowerClosure(resolved.closure);
    if (!lowered.ok) return lowered.result;
    const build = buildIdentity(workspaceHash, resolved, lowered.model);
    return deepFreeze({
      ok: true as const,
      model: lowered.model,
      build,
      telemetry: lowered.telemetry,
    });
  } catch {
    return fail([errorDiagnostic('asset.compiler-failure', 'Asset compilation failed closed.')]);
  }
};

/** Internal lowering of a closure from the current validated compilation snapshot. */
export const compileResolvedAssetWorkspaceEntry = (
  workspaceHash: Sha256Digest,
  resolved: WorkspaceEntryCompilation,
): CompileAssetWorkspaceEntryResult => {
  const result = compileResolvedAssetWorkspaceEntryDetailed(workspaceHash, resolved);
  if (!result.ok) return result;
  return deepFreeze({ ok: true as const, model: result.model, build: result.build });
};

/** Compile one selected workspace entry through the complete hermetic pipeline. */
export const compileAssetWorkspaceEntry = (
  workspace: AuthoredAssetWorkspace,
  selector: WorkspaceEntrySelector,
  options: ResolveWorkspaceEntryOptions = {},
): CompileAssetWorkspaceEntryResult => {
  try {
    const resolved = resolveWorkspaceEntryCompilation(workspace, selector, options);
    if (!resolved.ok) return fail(resolved.diagnostics);
    return compileResolvedAssetWorkspaceEntry(computeWorkspaceHash(workspace), resolved.value);
  } catch {
    return fail([errorDiagnostic('asset.compiler-failure', 'Asset compilation failed closed.')]);
  }
};
