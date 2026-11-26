import type { CompiledModel } from '../../model/compiled';
import { StructureInputError, type StructureSourceUnit } from '../../project/structure/contract';
import type { StructureAuditEvaluator, StructureProduct } from './contract';
import { evaluateStructure } from './eval';
import { buildStructureDocument } from './mesh';
import { encodeStructureNbt } from './nbt';

export const compileStructureUnits = (
  rootPath: string,
  units: ReadonlyMap<string, StructureSourceUnit>,
  customModels: Readonly<Record<string, CompiledModel>>,
  relative: (owner: string, specifier: string) => string,
  evaluateAudit: StructureAuditEvaluator,
): StructureProduct => {
  const root = units.get(rootPath);
  if (!root || root.kind !== 'structure' || root.size === null) {
    throw new StructureInputError({
      code: 'structure.entry',
      file: rootPath,
      pointer: 'structure',
      expected: 'structure entry with size and build',
      actual: root?.kind ?? 'missing',
    });
  }
  const { grid, prefabUses } = evaluateStructure(rootPath, units, relative);
  const volume = grid.size[0] * grid.size[1] * grid.size[2];
  const lighting = {
    size: grid.size,
    sky: new Uint8Array(volume),
    blockR: new Uint8Array(volume),
    blockG: new Uint8Array(volume),
    blockB: new Uint8Array(volume),
  };
  const bakedMesh = {
    batches: [],
    textures: {},
    instances: [],
    rawFaceCount: 0,
    mergedQuadCount: 0,
  };
  const playableMeta = {
    schemaVersion: 1 as const,
    id: root.id,
    unitsPerBlock: 1 as const,
    bounds: { min: [0, 0, 0] as const, max: grid.size },
    colliders: [],
    zones: [],
    lights: [],
    interactables: [],
    sockets: grid.sockets,
    navigation: { entryCells: [], walkableCellCount: 0, floorLevels: [0] },
  };
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
