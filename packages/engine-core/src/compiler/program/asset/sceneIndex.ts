import { canonicalJsonString } from '../../../canonicalJson';
import { deepFreeze } from '../../../immutable';
import type { CompiledModel } from '../../../model/compiled';
import type { CompiledHitZone, ModelDamageStateMeta } from '../../../model/hitzone';
import {
  compileExpressionChannels,
  isExpressionVariantNode,
  type ExpressionMotionSlotSpec,
} from '../../../model/expression';
import type { AnimationClip } from '../../../model/motion';
import type { SceneNode } from '../../../model/scene';
import type { TextureAsset } from '../../../model/texture';
import type { WorkspaceDiagnostic } from '../../../project/workspace/diagnostic';
import { sha256Digest } from '../../../provenance/digest';
import { compareText } from '../../../stableOrder';
import { rootDiagnostic, type RootLocation } from './diagnosticMap';
import type { InstantiatedAssetIr } from './ir';
import { parentCycles } from './parentCycles';

type FinalizeModelResult =
  | Readonly<{ readonly ok: true; readonly model: CompiledModel }>
  | Readonly<{ readonly ok: false; readonly diagnostics: readonly WorkspaceDiagnostic[] }>;

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
  if (node.kind === 'bone' || node.kind === 'locator') return 0;
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
      .filter((channel) => {
        const target = byId.get(channel.targetNodeId);
        return (
          target?.kind !== 'bone' && !(target !== undefined && isExpressionVariantNode(target))
        );
      })
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

const buildTextureRecord = (
  textures: readonly TextureAsset[],
  location: RootLocation,
):
  | Readonly<{ readonly ok: true; readonly record: Record<string, TextureAsset> }>
  | Readonly<{ readonly ok: false; readonly diagnostics: readonly WorkspaceDiagnostic[] }> => {
  const record: Record<string, TextureAsset> = {};
  for (const texture of [...textures].sort((left, right) => compareText(left.id, right.id))) {
    if (record[texture.id] !== undefined) {
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
    }
    record[texture.id] = texture;
  }
  return { ok: true, record };
};

const mergeClipExpressionSpecs = (
  animations: Readonly<Record<string, AnimationClip>>,
  nodeRecord: Readonly<Record<string, SceneNode>>,
  expressionSpecsByClipId: Readonly<Record<string, readonly ExpressionMotionSlotSpec[]>>,
): Readonly<Record<string, AnimationClip>> => {
  const expanded = Object.entries(animations).map(([clipId, clip]) => {
    const specs = expressionSpecsByClipId[clipId];
    if (!specs || specs.length === 0) return [clipId, clip] as const;
    const exprChannels = compileExpressionChannels(specs, nodeRecord, clip.durationSeconds, clipId);
    const merged = Object.fromEntries(
      Object.entries({ ...clip.channels, ...exprChannels }).sort(([l], [r]) => compareText(l, r)),
    );
    return [clipId, deepFreeze({ ...clip, channels: merged })] as const;
  });
  return Object.fromEntries(expanded.sort(([left], [right]) => compareText(left, right)));
};

const resolveCompiledHitzones = (
  ir: InstantiatedAssetIr,
  byId: ReadonlyMap<string, SceneNode>,
  location: RootLocation,
): {
  readonly hitzones: readonly CompiledHitZone[];
  readonly diagnostics: readonly WorkspaceDiagnostic[];
} => {
  if (!ir.hitzones || ir.hitzones.length === 0) return { hitzones: [], diagnostics: [] };
  const bones = [...byId.values()].filter((n) => n.kind === 'bone');
  const diagnostics: WorkspaceDiagnostic[] = [];
  const hitzones = ir.hitzones.map((hz) => {
    const direct = byId.get(hz.bone);
    const matched = direct?.kind === 'bone' ? direct : bones.find((b) => b.name === hz.bone);
    if (!matched) {
      diagnostics.push(
        rootDiagnostic(
          location,
          'asset.invalid-hitzone-bone',
          `Hitzone "${hz.id}" references missing bone "${hz.bone}".`,
        ),
      );
    }
    return Object.freeze({
      id: hz.id,
      bone: matched?.id ?? hz.bone,
      shape: hz.shape,
      multiplier: hz.multiplier,
      tag: hz.tag,
    });
  });
  return { hitzones, diagnostics };
};

const toModelDamageState = (ir: InstantiatedAssetIr): ModelDamageStateMeta | undefined => {
  const ds = ir.damageState;
  if (!ds) return undefined;
  return Object.freeze({
    state: ds.state,
    ...(ds.baseId ? { baseId: ds.baseId } : {}),
    ...(ds.breakVfx ? { breakVfx: ds.breakVfx } : {}),
    ...(ds.breakSound ? { breakSound: ds.breakSound } : {}),
  });
};

/** Index scene nodes, check parent cycles and bindings, and assemble the frozen CompiledModel. */
export const finalizeCompiledModel = (
  ir: InstantiatedAssetIr,
  rigNodes: readonly SceneNode[],
  geometryNodes: readonly SceneNode[],
  roots: readonly string[],
  animations: Readonly<Record<string, AnimationClip>>,
  textures: readonly TextureAsset[],
  resolution: readonly [number, number],
  location: RootLocation,
  expressionSpecsByClipId: Readonly<Record<string, readonly ExpressionMotionSlotSpec[]>> = {},
): FinalizeModelResult => {
  const orderedNodes = [...rigNodes, ...geometryNodes].sort((l, r) => compareText(l.id, r.id));
  const texResult = buildTextureRecord(textures, location);
  if (!texResult.ok) return texResult;
  const nodeRecord = Object.fromEntries(orderedNodes.map((node) => [node.id, node]));
  const animationRecord = mergeClipExpressionSpecs(animations, nodeRecord, expressionSpecsByClipId);
  const diagnostics = validateScene(
    orderedNodes,
    roots,
    animationRecord,
    texResult.record,
    location,
  );
  const byId = new Map(orderedNodes.map((node) => [node.id, node]));
  const hzResolved = resolveCompiledHitzones(ir, byId, location);
  const allDiagnostics = [...diagnostics, ...hzResolved.diagnostics];
  const hitzones = hzResolved.hitzones;
  const damageState = toModelDamageState(ir);
  const model: CompiledModel = {
    id: `model:${sha256Digest(ir.asset.key).slice('sha256:'.length)}`,
    name: ir.asset.name,
    forward: ir.settings.forward,
    ...(ir.settings.profile !== null && ir.settings.profile !== undefined
      ? { profile: ir.settings.profile }
      : {}),
    textureDensity: 16,
    textureResolution: Object.freeze([resolution[0], resolution[1]]),
    scene: { roots: Object.freeze([...roots].sort(compareText)), nodes: nodeRecord },
    textures: texResult.record,
    animations: animationRecord,
    ...(hitzones.length > 0 ? { hitzones: Object.freeze(hitzones) } : {}),
    ...(damageState ? { damageState } : {}),
  };
  return allDiagnostics.length > 0
    ? deepFreeze({ ok: false as const, diagnostics: allDiagnostics })
    : deepFreeze({ ok: true as const, model });
};
