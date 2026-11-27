import { canonicalJsonString } from '../../../canonicalJson';
import { deepFreeze } from '../../../immutable';
import type { CompiledModel } from '../../../model/compiled';
import type { AssetBuildIdentity } from '../../../project/asset';
import type { AssetDiagnostic } from '../../../project/program/asset/contract';
import type { AuthoredAssetWorkspace, Sha256Digest } from '../../../project/workspace/contract';
import { errorDiagnostic } from '../../../project/workspace/diagnostic';
import type { WorkspaceEntrySelector } from '../../../project/workspace/graph/contract';
import {
  resolveWorkspaceEntryCompilation,
  type ResolveWorkspaceEntryOptions,
  type WorkspaceEntryCompilation,
} from '../../../project/workspace/graph';
import { computeWorkspaceHash } from '../../../project/workspace/hash';
import { sha256Digest } from '../../../provenance/digest';
import { lowerAssetGeometry } from './canonicalGeometry';
import { validateMotionExpressionRefs } from './canonicalExpr';
import { lowerAssetRigAndMotions } from './canonicalRig';
import {
  failWithDiagnostics,
  geometryFailureDiagnostic,
  mapWorkspaceDiagnostics,
  rootLocationOf,
  type CompileAssetWorkspaceFailure,
  type RootLocation,
} from './diagnosticMap';
import { buildAssetHir } from './hir';
import { checkAssetHygiene } from './hygiene';
import { instantiateAsset } from './instantiate';
import type { InstantiatedAssetIr } from './ir';
import { finalizeCompiledModel } from './sceneIndex';
import type { AssetAuthoringTelemetry, TextureAuthoringTelemetry } from './texture/telemetry';
import { lowerAssetTextures } from './textureBinding';

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
  if (geometry === null) return { ok: false, diagnostics: [geometryFailureDiagnostic(location)] };
  return { ok: true, nodes: geometry.nodes };
};

const collectTextureTelemetry = (
  plans: Parameters<typeof lowerAssetGeometry>[1],
): AssetAuthoringTelemetry => {
  const textureTelemetry: Record<string, TextureAuthoringTelemetry> = Object.create(null);
  for (const plan of plans) {
    if (plan.telemetry !== undefined) textureTelemetry[plan.texture.id] = plan.telemetry;
  }
  return { textures: textureTelemetry };
};

/** Runs every lowering stage, stopping at the first stage that reports diagnostics. */
const lowerClosure = (closure: WorkspaceEntryCompilation['closure']): LoweringResult => {
  const location = rootLocationOf(closure);
  const failWith = (diagnostics: readonly AssetDiagnostic[]): LoweringResult => ({
    ok: false,
    result: failWithDiagnostics(
      mapWorkspaceDiagnostics(diagnostics, closure.files, location.packageName),
    ),
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
  const exprDiagnostics = validateMotionExpressionRefs(instantiated.ir, geometry.nodes);
  if (exprDiagnostics.length > 0) return failWith(exprDiagnostics);
  const finalized = finalizeCompiledModel(
    instantiated.ir,
    rig.bones,
    geometry.nodes,
    rig.roots,
    rig.animations,
    textures.plans.map((plan) => plan.texture),
    textures.resolution,
    location,
    rig.expressionSpecsByClipId,
  );
  if (!finalized.ok) return { ok: false, result: failWithDiagnostics(finalized.diagnostics) };
  return {
    ok: true,
    model: finalized.model,
    telemetry: collectTextureTelemetry(textures.plans),
  };
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
    return failWithDiagnostics([
      errorDiagnostic('asset.compiler-failure', 'Asset compilation failed closed.'),
    ]);
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
    if (!resolved.ok) return failWithDiagnostics(resolved.diagnostics);
    return compileResolvedAssetWorkspaceEntry(computeWorkspaceHash(workspace), resolved.value);
  } catch {
    return failWithDiagnostics([
      errorDiagnostic('asset.compiler-failure', 'Asset compilation failed closed.'),
    ]);
  }
};
