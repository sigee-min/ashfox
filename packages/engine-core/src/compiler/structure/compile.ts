import { hasHooksContent } from '../../hooks/resolve';
import type { HooksDocument } from '../../hooks/contract';
import type { CompiledModel } from '../../model/compiled';
import type { ProjectDocument } from '../../model/document';
import { sealCanonicalBoneFrame, type BoneNode, type SceneNode } from '../../model/scene';
import type { TextureAsset } from '../../model/texture';
import { createProjectDocument } from '../../project/create';
import { StructureInputError, type StructureSourceUnit } from '../../project/structure/contract';
import { describeBlockState } from './blocks';
import type {
  CompoundChildPlacement,
  EvaluatedStructureResult,
  StructureAuditEvaluator,
  StructureFloorMeta,
  StructureGrid,
  StructureProduct,
} from './contract';
import { evaluateStructure } from './eval';
import { buildStructureBakedMesh } from './greedyMesh';
import { computeStructureLighting } from './lighting';
import { buildStructureLodLevels } from './lod';
import { encodeStructureNbt } from './nbt';
import { buildPlayableStructureMeta } from './playableMeta';
import { mergeInteriorHooks } from './interior/hooksBridge';

const makeStubBone = (id: string, parentId: string | null): BoneNode => {
  const bone: BoneNode = {
    id,
    kind: 'bone',
    name: id,
    parentId,
    transform: {
      position: [0, 0, 0],
      rotation: [0, 0, 0],
      scale: [1, 1, 1],
      pivot: [0, 0, 0],
    },
    visible: true,
    canonicalFrame: {
      origin: [0, 0, 0],
      xAxis: [1, 0, 0],
      yAxis: [0, 1, 0],
      zAxis: [0, 0, 1],
      determinant: 1,
      rotation: [0, 0, 0],
    },
  };
  sealCanonicalBoneFrame(bone);
  return bone;
};

const buildStubStructureDocument = (
  grid: StructureGrid,
  customModels: Readonly<Record<string, CompiledModel>>,
): ProjectDocument => {
  const textures: Record<string, TextureAsset> = {};
  const seenModels = new Set<CompiledModel>();
  for (const cp of grid.customPlacements) {
    const model = customModels[cp.assetAlias];
    if (!model || seenModels.has(model)) continue;
    seenModels.add(model);
    for (const [tid, tex] of Object.entries(model.textures)) {
      const newId = `c_${tid}`;
      if (!textures[newId]) textures[newId] = { ...tex, id: newId };
    }
  }
  const nodes: Record<string, SceneNode> = {
    root: makeStubBone('root', null),
    exterior: makeStubBone('exterior', 'root'),
    interior: makeStubBone('interior', 'root'),
    custom: makeStubBone('custom', 'root'),
  };
  const doc = createProjectDocument({
    id: grid.id,
    name: grid.id,
    revision: 'structure-1',
    createdAt: '2026-01-01T00:00:00.000Z',
  });
  doc.settings.forward = 'north';
  doc.settings.textureResolution = { width: 64, height: 64 };
  doc.scene = { roots: ['root'], nodes };
  doc.textures = textures;
  return doc;
};

export const compileStructureUnits = (
  rootPath: string,
  units: ReadonlyMap<string, StructureSourceUnit>,
  customModels: Readonly<Record<string, CompiledModel>>,
  relative: (owner: string, specifier: string) => string,
  evaluateAudit: StructureAuditEvaluator,
  evaluatedGridCache?: Map<string, EvaluatedStructureResult>,
  resolveHooks?: (
    grid: StructureGrid,
    compoundChildren?: readonly CompoundChildPlacement[],
  ) => HooksDocument | undefined,
): StructureProduct => {
  const root = units.get(rootPath);
  if (!root || root.kind !== 'structure' || root.size === null) {
    throw new StructureInputError({
      code: 'structure.entry',
      file: rootPath,
      pointer: 'structure',
      expected: 'structure entry with size and operations',
      actual: root?.kind ?? 'missing',
    });
  }
  const { grid, prefabUses, compoundChildren } = evaluateStructure(
    rootPath,
    units,
    relative,
    evaluatedGridCache,
  );
  const hooks = mergeInteriorHooks(grid, resolveHooks?.(grid, compoundChildren));
  const descriptors = grid.states.map(describeBlockState);
  const { lighting, lights } = computeStructureLighting(grid, descriptors, customModels);
  const bakedMesh = buildStructureBakedMesh(grid, lighting, customModels, { descriptors });
  const lodLevels = buildStructureLodLevels(grid, lighting, customModels, { descriptors });
  const playableMeta = buildPlayableStructureMeta(grid, lights, descriptors);
  const nbt = encodeStructureNbt(grid, hooks);
  const document = buildStubStructureDocument(grid, customModels);
  const audit = evaluateAudit(grid, prefabUses, lighting, bakedMesh);
  return {
    id: root.id,
    grid,
    customModels,
    nbt,
    lighting,
    bakedMesh,
    lodLevels,
    playableMeta,
    ...(hasHooksContent(hooks) ? { hooks } : {}),
    document,
    audit,
    ...(grid.interiors && grid.interiors.length > 0
      ? { interiorAudits: grid.interiors.map((i) => i.audit) }
      : {}),
  };
};

const addCutBand = (byY: Map<number, string[]>, cutY: number, label: string): void => {
  const bucket = byY.get(cutY);
  if (!bucket) byY.set(cutY, [label]);
  else if (bucket.length < 2 && !bucket.includes(label)) bucket.push(label);
};

export const collectStructureCutBands = (
  floors: readonly StructureFloorMeta[],
  height: number,
): readonly { readonly label: string; readonly cutY: number }[] => {
  const byY = new Map<number, string[]>();
  for (const floor of floors) {
    const cutY = Math.min(
      height,
      floor.y + Math.min(3, Math.max(2, Math.floor(floor.height * 0.75))),
    );
    addCutBand(byY, cutY, (floor.name.split('.').pop() ?? floor.name).toUpperCase());
  }
  if (byY.size === 0) for (let y = 4; y < height; y += 5) addCutBand(byY, y, 'BAND');
  const cuts = [...byY.entries()]
    .sort((a, b) => a[0] - b[0])
    .slice(0, 3)
    .map(([cutY, names]) => ({ label: `${names.join('+')} (Y<${cutY})`, cutY }));
  if (cuts.length === 0 || cuts[cuts.length - 1]!.cutY < height)
    cuts.push({ label: `ROOF (Y<${height})`, cutY: height });
  return cuts;
};
