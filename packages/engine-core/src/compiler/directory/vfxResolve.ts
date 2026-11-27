import type {
  AshfoxBareStmt,
  AshfoxExpr,
  AshfoxNamedBlock,
  AshfoxStatement,
} from '../../project/program/syntax/blockAst';
import { collectBlockAssigns } from '../../project/program/syntax/blockLowering';
import type { VfxSourceUnit } from '../../project/vfx/contract';
import { readVfxEmitter } from '../../project/vfx/emitters';
import { failVfx, type VfxParamEnv } from '../../project/vfx/expr';
import { buildVfxRecipe, readVfxElement } from '../../project/vfx/source';
import type { VfxElementSpec, VfxEmitterSpec, VfxPalette, VfxRecipe } from '../../vfx/contract';

export interface VfxModuleIndex {
  readonly palettes: Map<string, VfxPalette>;
  readonly paramsByAlias: Map<string, Readonly<Record<string, AshfoxExpr>>>;
  readonly elements: Map<string, { readonly alias: string; readonly block: AshfoxNamedBlock }>;
  readonly emitters: Map<string, { readonly alias: string; readonly block: AshfoxNamedBlock }>;
  readonly recipes: Map<string, { readonly alias: string; readonly block: AshfoxNamedBlock }>;
}

const mergeBlocks = (base: AshfoxNamedBlock, override?: AshfoxNamedBlock): AshfoxNamedBlock => {
  if (!override) return base;
  const mergedAssigns = new Map<string, AshfoxStatement>();
  const subBlocks = new Map<string, AshfoxNamedBlock>();
  const pushStmt = (stmt: AshfoxStatement) => {
    if (stmt.kind === 'assign') mergedAssigns.set(stmt.path, stmt);
    else if (stmt.kind === 'named-block') subBlocks.set(stmt.blockKind, stmt);
  };
  base.block.statements.forEach(pushStmt);
  override.block.statements.forEach(pushStmt);
  return {
    ...base,
    name: override.name ?? base.name,
    block: {
      ...base.block,
      statements: [...mergedAssigns.values(), ...subBlocks.values()],
    },
  };
};

const splitTargetRef = (ref: string): { readonly alias: string; readonly name: string } => {
  const dot = ref.lastIndexOf('.');
  return dot >= 0
    ? { alias: ref.slice(0, dot), name: ref.slice(dot + 1) }
    : { alias: '', name: ref };
};

const envForAlias = (
  idx: VfxModuleIndex,
  alias: string,
  extra?: ReadonlyMap<string, AshfoxExpr>,
): VfxParamEnv => {
  const merged = new Map<string, AshfoxExpr>(Object.entries(idx.paramsByAlias.get(alias) ?? {}));
  if (extra) for (const [k, v] of extra) merged.set(k, v);
  return merged;
};

const useTargetName = (stmt: AshfoxBareStmt, file: string): string => {
  const first = stmt.items[0];
  if (!first || first.kind !== 'expr' || first.value.kind !== 'path') {
    return failVfx(file, stmt.span, 'use <module.recipe|element|emitter>', 'invalid use');
  }
  return first.value.value;
};

const readUseOverrides = (stmt: AshfoxBareStmt, file: string): Map<string, AshfoxExpr> =>
  stmt.block ? collectBlockAssigns(stmt.block, file, failVfx, false) : new Map();

const inheritRecipeAssign = (
  stmt: Extract<AshfoxStatement, { readonly kind: 'assign' }>,
  alias: string,
  inheritedProps: Map<string, AshfoxExpr>,
): void => {
  if (stmt.path === 'palette' && stmt.value.kind === 'path' && !stmt.value.value.includes('.')) {
    inheritedProps.set('palette', { ...stmt.value, value: `${alias}.${stmt.value.value}` });
  } else if (!inheritedProps.has(stmt.path)) {
    inheritedProps.set(stmt.path, stmt.value);
  }
};

const addRecipeStatement = (
  stmt: AshfoxStatement,
  alias: string,
  env: VfxParamEnv,
  file: string,
  elementsOut: VfxElementSpec[],
  emittersOut: VfxEmitterSpec[],
  inheritedProps: Map<string, AshfoxExpr>,
): void => {
  if (stmt.kind === 'assign') {
    inheritRecipeAssign(stmt, alias, inheritedProps);
    return;
  }
  if (stmt.kind !== 'named-block') return;
  if (stmt.blockKind === 'element') elementsOut.push(readVfxElement(stmt, file, env));
  else if (stmt.blockKind === 'emitter') emittersOut.push(readVfxEmitter(stmt, file, env));
};

const expandRecipeUse = (
  recipeBlock: AshfoxNamedBlock,
  alias: string,
  overrides: ReadonlyMap<string, AshfoxExpr>,
  idx: VfxModuleIndex,
  file: string,
  elementsOut: VfxElementSpec[],
  emittersOut: VfxEmitterSpec[],
  inheritedProps: Map<string, AshfoxExpr>,
): void => {
  const env = envForAlias(idx, alias, overrides);
  for (const stmt of recipeBlock.block.statements) {
    addRecipeStatement(stmt, alias, env, file, elementsOut, emittersOut, inheritedProps);
  }
  for (const [k, v] of overrides) {
    if (k === 'duration' || k === 'fps' || k === 'loop' || k === 'palette')
      inheritedProps.set(k, v);
  }
};

const resolveEntryElement = (
  stmt: AshfoxNamedBlock,
  idx: VfxModuleIndex,
  entryEnv: VfxParamEnv,
  file: string,
): VfxElementSpec => {
  if (!stmt.typeRef?.includes('.')) return readVfxElement(stmt, file, entryEnv);
  const tpl = idx.elements.get(stmt.typeRef);
  if (!tpl) return failVfx(file, stmt.span, 'exported VFX element', stmt.typeRef);
  return readVfxElement(mergeBlocks(tpl.block, stmt), file, envForAlias(idx, tpl.alias, entryEnv));
};

const resolveEntryEmitter = (
  stmt: AshfoxNamedBlock,
  idx: VfxModuleIndex,
  entryEnv: VfxParamEnv,
  file: string,
): VfxEmitterSpec => {
  if (!stmt.typeRef?.includes('.')) return readVfxEmitter(stmt, file, entryEnv);
  const tpl = idx.emitters.get(stmt.typeRef);
  if (!tpl) return failVfx(file, stmt.span, 'exported VFX emitter', stmt.typeRef);
  return readVfxEmitter(mergeBlocks(tpl.block, stmt), file, envForAlias(idx, tpl.alias, entryEnv));
};

export const indexUnitExports = (
  unit: VfxSourceUnit,
  idx: VfxModuleIndex,
  aliasPrefix?: string,
): void => {
  if (aliasPrefix) idx.paramsByAlias.set(aliasPrefix, unit.params);
  for (const [name, pal] of Object.entries(unit.palettes)) {
    const key = aliasPrefix ? `${aliasPrefix}.${name}` : name;
    idx.palettes.set(key, pal);
    if (!idx.palettes.has(name)) idx.palettes.set(name, pal);
  }
  const register = <T>(
    map: Map<string, { readonly alias: string; readonly block: T }>,
    items: Readonly<Record<string, T>>,
  ) => {
    for (const [name, block] of Object.entries(items)) {
      const alias = aliasPrefix ?? '';
      const key = aliasPrefix ? `${aliasPrefix}.${name}` : name;
      map.set(key, { alias, block });
      if (!map.has(name)) map.set(name, { alias, block });
    }
  };
  register(idx.elements, unit.elementBlocks);
  register(idx.emitters, unit.emitterBlocks);
  register(idx.recipes, unit.recipeBlocks);
};

export const assembleVfxRecipeFromGraph = (
  unit: VfxSourceUnit,
  entryPath: string,
  idx: VfxModuleIndex,
  resolvePalette: (props: ReadonlyMap<string, AshfoxExpr>, env: VfxParamEnv) => VfxPalette,
): VfxRecipe => {
  const entryEnv = new Map<string, AshfoxExpr>(Object.entries(unit.params));
  const rootEnv = new Map<string, AshfoxExpr>();
  const inheritedProps = new Map<string, AshfoxExpr>();
  const elements: VfxElementSpec[] = [];
  const emitters: VfxEmitterSpec[] = [];
  for (const useStmt of unit.uses) {
    const target = useTargetName(useStmt, entryPath);
    const overrides = readUseOverrides(useStmt, entryPath);
    const rec = idx.recipes.get(target);
    if (rec) {
      for (const [k, v] of envForAlias(idx, rec.alias, overrides)) rootEnv.set(k, v);
      expandRecipeUse(
        rec.block,
        rec.alias,
        overrides,
        idx,
        entryPath,
        elements,
        emitters,
        inheritedProps,
      );
      continue;
    }
    const el = idx.elements.get(target);
    if (el) {
      elements.push(readVfxElement(el.block, entryPath, envForAlias(idx, el.alias, overrides)));
      continue;
    }
    const em = idx.emitters.get(target);
    if (em) {
      emitters.push(readVfxEmitter(em.block, entryPath, envForAlias(idx, em.alias, overrides)));
      continue;
    }
    const { name } = splitTargetRef(target);
    failVfx(entryPath, useStmt.span, 'exported recipe, element, or emitter', name);
  }
  for (const [k, v] of entryEnv) rootEnv.set(k, v);
  for (const el of unit.entryElements)
    elements.push(resolveEntryElement(el, idx, entryEnv, entryPath));
  for (const em of unit.entryEmitters)
    emitters.push(resolveEntryEmitter(em, idx, entryEnv, entryPath));
  const mergedProps = new Map<string, AshfoxExpr>(inheritedProps);
  for (const [k, v] of Object.entries(unit.props)) mergedProps.set(k, v);
  const palette = resolvePalette(mergedProps, rootEnv);
  return buildVfxRecipe(unit.id, mergedProps, palette, elements, emitters, entryPath, rootEnv);
};
