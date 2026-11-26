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
  const nbt = encodeStructureNbt(grid);
  const document = buildStructureDocument(grid, customModels);
  const audit = evaluateAudit(grid, prefabUses);
  return { id: root.id, grid, customModels, nbt, document, audit };
};
