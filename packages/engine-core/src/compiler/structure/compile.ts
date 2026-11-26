import type { CompiledModel } from '../../model/compiled';
import { StructureInputError, type StructureSourceUnit } from '../../project/structure/contract';
import { describeBlockState } from './blocks';
import type { StructureAuditEvaluator, StructureProduct } from './contract';
import { evaluateStructure } from './eval';
import { buildStructureBakedMesh } from './greedyMesh';
import { computeStructureLighting } from './lighting';
import { buildStructureDocument } from './mesh';
import { encodeStructureNbt } from './nbt';
import { buildPlayableStructureMeta } from './playableMeta';

export const compileStructureUnits = (
  rootPath: string,
  units: ReadonlyMap<string, StructureSourceUnit>,
  customModels: Readonly<Record<string, CompiledModel>>,
  relative: (owner: string, specifier: string) => string,
  evaluateAudit: StructureAuditEvaluator,
): StructureProduct => {
  const root = units.get(rootPath);
  if (!root || (root.kind !== 'structure' && root.kind !== 'compound') || root.size === null) {
    throw new StructureInputError({
      code: 'structure.entry',
      file: rootPath,
      pointer: 'structure',
      expected: 'structure or compound entry with size and build',
      actual: root?.kind ?? 'missing',
    });
  }
  const { grid, prefabUses } = evaluateStructure(rootPath, units, relative);
  const descriptors = grid.states.map(describeBlockState);
  const { lighting, lights } = computeStructureLighting(grid, descriptors, customModels);
  const bakedMesh = buildStructureBakedMesh(grid, lighting, customModels);
  const playableMeta = buildPlayableStructureMeta(grid, lights);
  const nbt = encodeStructureNbt(grid);
  const document = buildStructureDocument(grid, customModels);
  const audit = evaluateAudit(grid, prefabUses, lighting, bakedMesh);
  return {
    id: root.id,
    grid,
    customModels,
    nbt,
    lighting,
    bakedMesh,
    playableMeta,
    document,
    audit,
  };
};
