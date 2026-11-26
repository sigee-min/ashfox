import type { CompiledModel } from '../../model/compiled';
import { StructureInputError, type StructureSourceUnit } from '../../project/structure/contract';
import { describeBlockState } from './blocks';
import type { StructureAuditEvaluator, StructureFloorMeta, StructureProduct } from './contract';
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
