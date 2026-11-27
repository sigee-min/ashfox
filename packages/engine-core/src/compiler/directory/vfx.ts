import type { DirectoryFile } from '../../project/directory/contract';
import { VfxInputError } from '../../project/vfx/contract';
import { parseVfxSource } from '../../project/vfx/source';
import { auditVfx } from '../../vfx/audit';
import { compileVfxRecipe } from '../../vfx/compile';
import type { CompiledVfx, VfxPalette, VfxRecipe } from '../../vfx/contract';
import { emitVfxGlb } from '../../vfx/gltfEmit';
import { VFX_PALETTES } from '../../vfx/presets';
import {
  emitBedrockParticleSpecs,
  emitVfxRuntimeSpec,
  type BedrockParticleSpec,
  type VfxRuntimeSpec,
} from '../../vfx/specEmit';

export interface CompiledVfxBundle {
  readonly recipe: VfxRecipe;
  readonly compiled: CompiledVfx;
  readonly glb: Uint8Array;
  readonly spec: VfxRuntimeSpec;
  readonly particles: readonly BedrockParticleSpec[];
  readonly paths: ReadonlySet<string>;
}

const resolveImportPath = (ownerPath: string, specifier: string): string => {
  if (!specifier.startsWith('./') && !specifier.startsWith('../')) return specifier;
  const parts = ownerPath.split('/').slice(0, -1);
  for (const segment of specifier.split('/')) {
    if (segment === '.' || segment === '') continue;
    if (segment === '..') parts.pop();
    else parts.push(segment);
  }
  return parts.join('/');
};

const collectPalettes = (
  entryPath: string,
  files: ReadonlyMap<string, DirectoryFile>,
  paths: Set<string>,
  palettes: Map<string, VfxPalette>,
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
  for (const [name, pal] of Object.entries(unit.palettes)) {
    const key = aliasPrefix ? `${aliasPrefix}.${name}` : name;
    palettes.set(key, pal);
    if (!palettes.has(name)) palettes.set(name, pal);
  }
  for (const imp of unit.imports) {
    collectPalettes(
      resolveImportPath(entryPath, imp.path),
      files,
      paths,
      palettes,
      seen,
      imp.alias,
    );
  }
};

const resolveVfxEntryPalette = (
  unit: ReturnType<typeof parseVfxSource>,
  entryPath: string,
  files: ReadonlyMap<string, DirectoryFile>,
  paths: Set<string>,
): VfxPalette => {
  const palettes = new Map<string, VfxPalette>(
    Object.entries(VFX_PALETTES)
      .map(([, p]) => [p.name, p] as const)
      .concat(Object.entries(VFX_PALETTES)),
  );
  for (const [k, p] of Object.entries(unit.palettes)) palettes.set(k, p);
  const seen = new Set<string>([entryPath]);
  for (const imp of unit.imports) {
    collectPalettes(
      resolveImportPath(entryPath, imp.path),
      files,
      paths,
      palettes,
      seen,
      imp.alias,
    );
  }
  if (!unit.paletteRef) return unit.recipe!.palette;
  const resolved =
    palettes.get(unit.paletteRef) ?? palettes.get(unit.paletteRef.split('.').pop() ?? '');
  if (!resolved) {
    throw new VfxInputError({
      code: 'vfx.palette',
      file: entryPath,
      pointer: 'palette',
      expected: 'known or imported palette name',
      actual: unit.paletteRef,
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
  if (unit.kind !== 'vfx' || !unit.recipe) {
    throw new VfxInputError({
      code: 'vfx.entry',
      file: entryPath,
      pointer: 'vfx',
      expected: 'vfx top declaration',
      actual: unit.kind,
    });
  }
  const paths = new Set<string>([entryPath]);
  const palette = resolveVfxEntryPalette(unit, entryPath, files, paths);
  const recipe: VfxRecipe = { ...unit.recipe, palette };
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
