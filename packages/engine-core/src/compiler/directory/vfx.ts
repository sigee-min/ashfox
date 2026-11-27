import type { DirectoryFile } from '../../project/directory/contract';
import type { AshfoxExpr } from '../../project/program/syntax/blockAst';
import { isVirtualLibrarySpecifier, virtualLibraryLogicalPath } from '../../project/stdlib/resolve';
import { VfxInputError, type VfxSourceUnit } from '../../project/vfx/contract';
import { asName, type VfxParamEnv } from '../../project/vfx/expr';
import { parseVfxSource } from '../../project/vfx/source';
import { auditVfx } from '../../vfx/audit';
import { compileVfxRecipe } from '../../vfx/compile';
import type { CompiledVfx, VfxPalette, VfxRecipe } from '../../vfx/contract';
import { emitVfxGlb } from '../../export/targets/gltf/vfxGltf';
import { VFX_PALETTES } from '../../vfx/presets';
import {
  emitBedrockParticleSpecs,
  emitVfxRuntimeSpec,
  type BedrockParticleSpec,
  type VfxRuntimeSpec,
} from '../../vfx/specEmit';
import { assembleVfxRecipeFromGraph, indexUnitExports, type VfxModuleIndex } from './vfxResolve';

export interface CompiledVfxBundle {
  readonly recipe: VfxRecipe;
  readonly compiled: CompiledVfx;
  readonly glb: Uint8Array;
  readonly spec: VfxRuntimeSpec;
  readonly particles: readonly BedrockParticleSpec[];
  readonly paths: ReadonlySet<string>;
}

const resolveImportPath = (ownerPath: string, specifier: string): string => {
  if (isVirtualLibrarySpecifier(specifier)) return virtualLibraryLogicalPath(specifier);
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return specifier;
  const parts = ownerPath.split('/').slice(0, -1);
  for (const segment of specifier.split('/')) {
    if (segment === '.' || segment === '') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  return parts.join('/');
};

const collectModules = (
  entryPath: string,
  files: ReadonlyMap<string, DirectoryFile>,
  paths: Set<string>,
  idx: VfxModuleIndex,
  seen: Set<string>,
  aliasPrefix?: string,
): void => {
  if (seen.has(entryPath)) return;
  seen.add(entryPath);
  paths.add(entryPath);
  const file = files.get(entryPath);
  if (!file) {
    throw new VfxInputError({
      code: 'vfx.import',
      file: entryPath,
      pointer: 'import',
      expected: 'existing VFX module file',
      actual: 'missing',
    });
  }
  const unit = parseVfxSource(file.source, entryPath);
  indexUnitExports(unit, idx, aliasPrefix);
  for (const imp of unit.imports) {
    collectModules(resolveImportPath(entryPath, imp.path), files, paths, idx, seen, imp.alias);
  }
};

const createModuleIndex = (
  unit: VfxSourceUnit,
  entryPath: string,
  files: ReadonlyMap<string, DirectoryFile>,
  paths: Set<string>,
): VfxModuleIndex => {
  const idx: VfxModuleIndex = {
    palettes: new Map<string, VfxPalette>(
      Object.entries(VFX_PALETTES)
        .map(([, p]) => [p.name, p] as const)
        .concat(Object.entries(VFX_PALETTES)),
    ),
    paramsByAlias: new Map(),
    elements: new Map(),
    emitters: new Map(),
    recipes: new Map(),
  };
  indexUnitExports(unit, idx);
  const seen = new Set<string>([entryPath]);
  for (const imp of unit.imports) {
    collectModules(resolveImportPath(entryPath, imp.path), files, paths, idx, seen, imp.alias);
  }
  return idx;
};

const lookupPalette = (
  props: ReadonlyMap<string, AshfoxExpr>,
  idx: VfxModuleIndex,
  entryPath: string,
  env: VfxParamEnv,
  fallback: VfxPalette,
): VfxPalette => {
  const paletteRef = props.has('palette') ? asName(props.get('palette')!, entryPath, env) : null;
  if (!paletteRef) return fallback;
  const resolved =
    idx.palettes.get(paletteRef) ?? idx.palettes.get(paletteRef.split('.').pop() ?? '');
  if (!resolved) {
    throw new VfxInputError({
      code: 'vfx.palette',
      file: entryPath,
      pointer: 'palette',
      expected: 'known or imported palette name',
      actual: paletteRef,
    });
  }
  return resolved;
};

export const compileDirectoryVfx = (
  files: ReadonlyMap<string, DirectoryFile>,
  entryPath: string,
): CompiledVfxBundle => {
  const entry = files.get(entryPath);
  if (!entry) {
    throw new VfxInputError({
      code: 'vfx.entry',
      file: entryPath,
      pointer: 'entry',
      expected: 'vfx source file',
      actual: 'missing',
    });
  }
  const unit = parseVfxSource(entry.source, entryPath);
  if (unit.kind !== 'vfx') {
    throw new VfxInputError({
      code: 'vfx.entry',
      file: entryPath,
      pointer: 'vfx',
      expected: 'vfx top declaration',
      actual: unit.kind,
    });
  }
  const paths = new Set<string>([entryPath]);
  const idx = createModuleIndex(unit, entryPath, files, paths);
  const fallbackPalette =
    unit.recipe?.palette ?? Object.values(unit.palettes)[0] ?? VFX_PALETTES.EmberSolar;
  const recipe: VfxRecipe = unit.recipe
    ? {
        ...unit.recipe,
        palette: lookupPalette(
          new Map(Object.entries(unit.props)),
          idx,
          entryPath,
          new Map(Object.entries(unit.params)),
          unit.recipe.palette,
        ),
      }
    : assembleVfxRecipeFromGraph(unit, entryPath, idx, (props, env) =>
        lookupPalette(props, idx, entryPath, env, fallbackPalette),
      );
  const compiled = compileVfxRecipe(recipe);
  const audit = auditVfx(compiled);
  if (!audit.passed) {
    throw new VfxInputError({
      code: 'vfx.audit',
      file: entryPath,
      pointer: 'budget',
      expected: `passing VFX audit (score=${audit.score})`,
      actual: audit.hardGateFailures.join('; ') || `score ${audit.score}`,
    });
  }
  const glb = emitVfxGlb(compiled);
  const spec = emitVfxRuntimeSpec(compiled);
  const particles = emitBedrockParticleSpecs(recipe);
  return { recipe, compiled, glb, spec, particles, paths };
};
