import { canonicalJsonString } from '../../../canonicalJson';
import { deepFreeze } from '../../../immutable';
import type { CompiledModel } from '../../../model/compiled';
import type { AnimationClip } from '../../../model/motion';
import type { SceneGraph, SceneNode } from '../../../model/scene';
import type { TextureAsset } from '../../../model/texture';
import type { AssetBuildIdentity } from '../../../project/asset';
import type { AssetDiagnostic } from '../../../project/program/asset/contract';
import type { SourceSpan } from '../../../project/source/contract';
import type {
  AuthoredAssetWorkspace,
  Sha256Digest
} from '../../../project/workspace/contract';
import {
  errorDiagnostic,
  sortWorkspaceDiagnostics,
  type SourceRef,
  type WorkspaceDiagnostic
} from '../../../project/workspace/diagnostic';
import type { WorkspaceEntrySelector } from '../../../project/workspace/graph/contract';
import {
  resolveWorkspaceEntryCompilation,
  type ResolveWorkspaceEntryOptions,
  type WorkspaceEntryCompilation
} from '../../../project/workspace/graph';
import { computeWorkspaceHash } from '../../../project/workspace/hash';
import { sha256Digest } from '../../../provenance/digest';
import { lowerAssetGeometry } from './canonicalGeometry';
import { lowerAssetRigAndMotions } from './canonicalRig';
import { buildAssetHir } from './hir';
import { instantiateAsset } from './instantiate';
import { parentCycles } from './parentCycles';
import type { InstantiatedAssetIr } from './ir';
import { lowerAssetTextures } from './textureBinding';

export type CompileAssetWorkspaceEntryResult =
  | Readonly<{
      readonly ok: true;
      readonly model: CompiledModel;
      readonly build: AssetBuildIdentity;
    }>
  | Readonly<{
      readonly ok: false;
      readonly diagnostics: readonly WorkspaceDiagnostic[];
    }>;

interface RootLocation {
  readonly packageName: string;
  readonly path: string;
  readonly span: SourceSpan;
}

const compareText = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

const sourceRef = (
  packageName: string,
  path: string,
  span: SourceSpan
): SourceRef => Object.freeze({
  packageName,
  path,
  start: Object.freeze({ ...span.start }),
  end: Object.freeze({ ...span.end })
});

const fail = (
  diagnostics: readonly WorkspaceDiagnostic[]
): CompileAssetWorkspaceEntryResult => deepFreeze({
  ok: false as const,
  diagnostics: sortWorkspaceDiagnostics(diagnostics)
});

const packageForPath = (
  files: readonly Readonly<{ readonly identity: Readonly<{
    readonly packageName: string;
    readonly path: string;
  }> }>[],
  path: string,
  fallback: string
): string => files.find((file) => file.identity.path === path)?.identity.packageName ?? fallback;

const workspaceDiagnostics = (
  diagnostics: readonly AssetDiagnostic[],
  files: readonly Readonly<{ readonly identity: Readonly<{
    readonly packageName: string;
    readonly path: string;
  }> }>[],
  fallbackPackage: string
): readonly WorkspaceDiagnostic[] => diagnostics.map((item) => Object.freeze({
  severity: 'error' as const,
  code: item.code,
  message: item.message,
  source: sourceRef(packageForPath(files, item.path, fallbackPackage), item.path, item.span)
}));

const rootDiagnostic = (
  location: RootLocation,
  code: string,
  message: string
): WorkspaceDiagnostic => errorDiagnostic(code, message,
  sourceRef(location.packageName, location.path, location.span));

const validateScene = (
  nodes: readonly SceneNode[],
  roots: readonly string[],
  animations: Readonly<Record<string, AnimationClip>>,
  textures: Readonly<Record<string, TextureAsset>>,
  location: RootLocation
): readonly WorkspaceDiagnostic[] => {
  const diagnostics: WorkspaceDiagnostic[] = [];
  const byId = new Map<string, SceneNode>();
  for (const node of nodes) {
    if (byId.has(node.id)) diagnostics.push(rootDiagnostic(location,
      'asset.canonical-node-duplicate', `Canonical node id "${node.id}" is duplicated.`));
    else byId.set(node.id, node);
  }
  const expectedRoots = [...nodes].filter((node) => node.parentId === null)
    .map((node) => node.id).sort(compareText);
  const actualRoots = [...roots].sort(compareText);
  if (expectedRoots.length === 0 || canonicalJsonString(expectedRoots) !==
      canonicalJsonString(actualRoots)) diagnostics.push(rootDiagnostic(location,
    'asset.canonical-roots', 'Canonical scene roots do not exactly match parentless nodes.'));
  for (const node of nodes) {
    if (node.parentId !== null && byId.get(node.parentId)?.kind !== 'bone') {
      diagnostics.push(rootDiagnostic(location, 'asset.canonical-parent',
        `Canonical node "${node.id}" requires an existing bone parent.`));
    }
    if (node.kind === 'cube' || node.kind === 'plane') {
      for (const face of Object.values(node.faces)) {
        if (face.enabled && (face.textureId === null || textures[face.textureId] === undefined)) {
          diagnostics.push(rootDiagnostic(location, 'asset.canonical-texture',
            `Canonical node "${node.id}" references a missing texture.`));
        }
      }
    }
  }
  for (const clip of Object.values(animations)) for (const channel of Object.values(clip.channels)) {
    if (byId.get(channel.targetNodeId)?.kind !== 'bone') diagnostics.push(rootDiagnostic(
      location, 'asset.canonical-motion-target',
      `Animation "${clip.name}" targets a missing non-bone node.`));
  }
  for (const id of parentCycles(nodes, byId)) {
    diagnostics.push(rootDiagnostic(location, 'asset.canonical-parent-cycle',
      `Canonical parent cycle contains node "${id}".`));
  }
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
  location: RootLocation
): FinalizeModelResult => {
  const orderedNodes = [...rigNodes, ...geometryNodes]
    .sort((left, right) => compareText(left.id, right.id));
  const textureEntries = [...textures].sort((left, right) => compareText(left.id, right.id));
  const textureRecord: Record<string, TextureAsset> = {};
  for (const texture of textureEntries) {
    if (textureRecord[texture.id] !== undefined) return deepFreeze({ ok: false as const,
      diagnostics: [rootDiagnostic(location, 'asset.canonical-texture-duplicate',
        `Canonical texture id "${texture.id}" is duplicated.`)] });
    textureRecord[texture.id] = texture;
  }
  const animationRecord = Object.fromEntries(Object.entries(animations)
    .sort(([left], [right]) => compareText(left, right)));
  const diagnostics = validateScene(orderedNodes, roots, animationRecord,
    textureRecord, location);
  const nodeRecord = Object.fromEntries(orderedNodes.map((node) => [node.id, node]));
  const scene: SceneGraph = { roots: Object.freeze([...roots].sort(compareText)), nodes: nodeRecord };
  const model: CompiledModel = {
    id: `model:${sha256Digest(ir.asset.key).slice('sha256:'.length)}`,
    name: ir.asset.name,
    forward: ir.settings.forward,
    textureDensity: 16,
    textureResolution: Object.freeze([resolution[0], resolution[1]]),
    scene,
    textures: textureRecord,
    animations: animationRecord
  };
  return diagnostics.length > 0
    ? deepFreeze({ ok: false as const, diagnostics })
    : deepFreeze({ ok: true as const, model: deepFreeze(model) });
};

/** Internal lowering of a closure from the current validated compilation snapshot. */
export const compileResolvedAssetWorkspaceEntry = (
  workspaceHash: Sha256Digest,
  resolved: WorkspaceEntryCompilation
): CompileAssetWorkspaceEntryResult => {
  try {
    const closure = resolved.closure;
    const rootLocation: RootLocation = {
      packageName: closure.root.identity.packageName,
      path: closure.root.identity.path,
      span: closure.root.unit.span
    };
    const hir = buildAssetHir(closure);
    if (!hir.ok) return fail(workspaceDiagnostics(hir.diagnostics, closure.files,
      rootLocation.packageName));
    const instantiated = instantiateAsset(hir.hir);
    if (!instantiated.ok) return fail(workspaceDiagnostics(instantiated.diagnostics,
      closure.files, rootLocation.packageName));
    const textures = lowerAssetTextures(hir.hir, instantiated.ir);
    if (!textures.ok) return fail(workspaceDiagnostics(textures.diagnostics,
      closure.files, rootLocation.packageName));
    const rig = lowerAssetRigAndMotions(instantiated.ir);
    if (!rig.ok) return fail(workspaceDiagnostics(rig.diagnostics, closure.files,
      rootLocation.packageName));
    const geometryIssues: AssetDiagnostic[] = [];
    const geometry = lowerAssetGeometry(instantiated.ir, textures.plans,
      (path, span, code, message) => geometryIssues.push(Object.freeze({
        severity: 'error', path, span, code, message
      })));
    if (geometry === null || geometryIssues.length > 0) return fail(workspaceDiagnostics(
      geometryIssues.length > 0 ? geometryIssues : [Object.freeze({ severity: 'error',
        path: rootLocation.path, span: rootLocation.span, code: 'asset.canonical-geometry',
        message: 'Canonical geometry lowering failed closed.' })], closure.files,
      rootLocation.packageName));
    const finalized = finalizeModel(instantiated.ir, rig.bones, geometry.nodes,
      rig.roots, rig.animations, textures.plans.map((plan) => plan.texture),
      textures.resolution, rootLocation);
    if (!finalized.ok) return fail(finalized.diagnostics);
    const productHash = sha256Digest(canonicalJsonString(finalized.model)) as Sha256Digest;
    const build: AssetBuildIdentity = deepFreeze({
      packageName: resolved.build.packageName,
      entryName: resolved.build.entryName,
      path: resolved.build.entryPath,
      workspaceHash,
      closureHash: resolved.build.closureHash,
      buildKey: resolved.build.buildKey,
      compilerFingerprint: resolved.build.compilerFingerprint,
      productHash
    });
    return deepFreeze({ ok: true as const, model: finalized.model, build });
  } catch {
    return fail([errorDiagnostic('asset.compiler-failure',
      'Asset compilation failed closed.')]);
  }
};

/** Compile one selected workspace entry through the complete hermetic pipeline. */
export const compileAssetWorkspaceEntry = (
  workspace: AuthoredAssetWorkspace,
  selector: WorkspaceEntrySelector,
  options: ResolveWorkspaceEntryOptions = {}
): CompileAssetWorkspaceEntryResult => {
  try {
    const resolved = resolveWorkspaceEntryCompilation(workspace, selector, options);
    if (!resolved.ok) return fail(resolved.diagnostics);
    return compileResolvedAssetWorkspaceEntry(computeWorkspaceHash(workspace), resolved.value);
  } catch {
    return fail([errorDiagnostic('asset.compiler-failure', 'Asset compilation failed closed.')]);
  }
};
