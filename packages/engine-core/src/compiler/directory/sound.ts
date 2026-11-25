import {
  compileSoundRecipe,
  parseSoundUnit,
  soundRecipeBudget,
  type SoundBudget,
  type SoundNamedDecl,
  type SoundProduct,
  type SoundSourceUnit,
} from '@ashfox/audio-core';
import type { DirectoryFile } from '../../project/directory/contract';

const relativePath = (owner: string, target: string): string => {
  if (!target.startsWith('./') && !target.startsWith('../')) {
    throw new Error(`${owner}: sound.invalid-import: Sound imports must be relative .ashfox paths`);
  }
  if (!target.endsWith('.ashfox') || /[\\\x00-\x1f]/u.test(target)) {
    throw new Error(`${owner}: sound.invalid-import: Invalid sound import "${target}"`);
  }
  const parts = owner.split('/').slice(0, -1);
  for (const segment of target.split('/')) {
    if (segment === '.') continue;
    if (segment === '..') {
      if (!parts.length) throw new Error(`${owner}: sound.invalid-import: Import escapes root`);
      parts.pop();
    } else if (!segment) throw new Error(`${owner}: sound.invalid-import: Empty path segment`);
    else parts.push(segment);
  }
  return parts.join('/');
};

interface SoundGraphState {
  readonly files: ReadonlyMap<string, DirectoryFile>;
  readonly entryPath: string;
  readonly units: Map<string, SoundSourceUnit>;
  readonly visiting: Set<string>;
  readonly usedImports: Map<string, Set<string>>;
  readonly usedDecls: Set<string>;
}

const markImportUsed = (state: SoundGraphState, owner: string, alias: string): void => {
  const set = state.usedImports.get(owner) ?? new Set<string>();
  set.add(alias);
  state.usedImports.set(owner, set);
};

const visitSoundUnit = (state: SoundGraphState, filePath: string): void => {
  if (state.visiting.has(filePath)) throw new Error(`${filePath}: sound.cycle: Import cycle`);
  if (state.units.has(filePath)) return;
  if (state.visiting.size >= 32)
    throw new Error(`${filePath}: sound.depth: Import depth exceeds 32`);
  const file = state.files.get(filePath);
  if (!file) throw new Error(`${filePath}: sound.missing: Missing sound source`);
  state.visiting.add(filePath);
  const unit = parseSoundUnit(file.source, filePath);
  if (filePath !== state.entryPath && unit.kind !== 'module') {
    throw new Error(`${filePath}: sound.expected-module: Import must refer to a sound module`);
  }
  for (const dep of unit.imports) visitSoundUnit(state, relativePath(filePath, dep.path));
  state.units.set(filePath, unit);
  state.visiting.delete(filePath);
};

const isRefValue = (v: unknown): v is { readonly $ref: string } =>
  Boolean(
    v &&
    typeof v === 'object' &&
    !Array.isArray(v) &&
    typeof (v as { $ref?: unknown }).$ref === 'string',
  );

const findNamedDecl = (
  state: SoundGraphState,
  ownerPath: string,
  refName: string,
  declKind: 'voice' | 'sequence',
): {
  readonly owner: string;
  readonly id: string;
  readonly value: Readonly<Record<string, unknown>>;
} => {
  const unit = state.units.get(ownerPath)!;
  if (!refName.includes('.')) {
    const list = declKind === 'voice' ? unit.voices : unit.sequences;
    const hit = list.find((d) => d.id === refName);
    if (!hit)
      throw new Error(`${ownerPath}: sound.unknown-${declKind}: Unknown ${declKind} "${refName}"`);
    state.usedDecls.add(`${ownerPath}\u0000${declKind}\u0000${hit.id}`);
    return { owner: ownerPath, id: hit.id, value: hit.value };
  }
  const [alias, id] = refName.split('.');
  const imp = unit.imports.find((i) => i.alias === alias);
  if (!imp || !id)
    throw new Error(`${ownerPath}: sound.unknown-import: Unknown import ref "${refName}"`);
  markImportUsed(state, ownerPath, alias!);
  const targetPath = relativePath(ownerPath, imp.path);
  const target = state.units.get(targetPath)!;
  const list = declKind === 'voice' ? target.voices : target.sequences;
  const hit = list.find((d) => d.id === id && d.exported);
  if (!hit)
    throw new Error(
      `${ownerPath}: sound.unknown-${declKind}: Unknown exported ${declKind} "${refName}"`,
    );
  state.usedDecls.add(`${targetPath}\u0000${declKind}\u0000${hit.id}`);
  return { owner: targetPath, id: hit.id, value: hit.value };
};

const resolveStepVoiceRefs = (
  state: SoundGraphState,
  ownerPath: string,
  seqVal: Record<string, unknown>,
): Record<string, unknown> => {
  if (!Array.isArray(seqVal.steps)) return seqVal;
  const steps = seqVal.steps.map((rawStep) => {
    if (!rawStep || typeof rawStep !== 'object' || Array.isArray(rawStep)) return rawStep;
    const step = { ...(rawStep as Record<string, unknown>) };
    if (isRefValue(step.voice)) {
      const target = findNamedDecl(state, ownerPath, step.voice.$ref, 'voice');
      step.voice = target.id;
    }
    return step;
  });
  return { ...seqVal, steps };
};

const resolveRecipeGraph = (state: SoundGraphState): Record<string, unknown> => {
  const root = state.units.get(state.entryPath)!;
  const body = { ...root.body, id: root.id } as Record<string, unknown>;
  if (Array.isArray(body.voices)) {
    body.voices = body.voices.map((item) => {
      if (!isRefValue(item)) return item;
      const decl = findNamedDecl(state, state.entryPath, item.$ref, 'voice');
      return { ...decl.value, id: decl.id };
    });
  }
  if (Array.isArray(body.sequences)) {
    body.sequences = body.sequences.map((item) => {
      if (!isRefValue(item)) {
        return item && typeof item === 'object' && !Array.isArray(item)
          ? resolveStepVoiceRefs(state, state.entryPath, item as Record<string, unknown>)
          : item;
      }
      const decl = findNamedDecl(state, state.entryPath, item.$ref, 'sequence');
      return resolveStepVoiceRefs(state, decl.owner, { ...decl.value, id: decl.id });
    });
  }
  return body;
};

const checkNamedUsage = (
  usedDecls: ReadonlySet<string>,
  filePath: string,
  declKind: 'voice' | 'sequence',
  isRoot: boolean,
  decls: readonly SoundNamedDecl[],
): void => {
  for (const decl of decls) {
    if (!isRoot && decl.exported) continue;
    if (!usedDecls.has(`${filePath}\u0000${declKind}\u0000${decl.id}`)) {
      throw new Error(`${filePath}: sound.unused-${declKind}: Unused ${declKind} "${decl.id}"`);
    }
  }
};

const checkUnitSoundHygiene = (
  state: SoundGraphState,
  filePath: string,
  unit: SoundSourceUnit,
): void => {
  const used = state.usedImports.get(filePath) ?? new Set<string>();
  const deadImport = unit.imports.find((i) => !used.has(i.alias));
  if (deadImport)
    throw new Error(`${filePath}: sound.unused-import: Unused import "${deadImport.alias}"`);
  const isRoot = filePath === state.entryPath;
  checkNamedUsage(state.usedDecls, filePath, 'voice', isRoot, unit.voices);
  checkNamedUsage(state.usedDecls, filePath, 'sequence', isRoot, unit.sequences);
};

const checkSoundHygiene = (state: SoundGraphState): void => {
  for (const [filePath, unit] of state.units) checkUnitSoundHygiene(state, filePath, unit);
  const rootFile = state.files.get(state.entryPath)!;
  const rootUnit = state.units.get(state.entryPath)!;
  const nonEmptyLines = rootFile.source.split(/\r?\n/u).filter((l) => l.trim().length > 0).length;
  const inlineVoices = Array.isArray(rootUnit.body.voices) ? rootUnit.body.voices.length : 0;
  const inlineSeqs = Array.isArray(rootUnit.body.sequences) ? rootUnit.body.sequences.length : 0;
  if (nonEmptyLines > 140 && rootUnit.imports.length === 0 && inlineVoices + inlineSeqs >= 4) {
    throw new Error(
      `${state.entryPath}: sound.monolithic-entry: Sound entry mixes ${inlineVoices + inlineSeqs} inline voices/sequences across ${nonEmptyLines} non-empty lines with no imports. Extract reusable voices/sequences into a module.`,
    );
  }
};

export interface CompiledDirectorySound {
  readonly unit: SoundSourceUnit;
  readonly budget: SoundBudget;
  readonly sounds: readonly SoundProduct[];
  readonly soundPaths: readonly string[];
}

export const prepareDirectorySound = (
  files: ReadonlyMap<string, DirectoryFile>,
  entryPath: string,
): {
  readonly unit: SoundSourceUnit;
  readonly resolvedRecipe: Readonly<Record<string, unknown>>;
  readonly budget: SoundBudget;
  readonly soundPaths: readonly string[];
} => {
  const state: SoundGraphState = {
    files,
    entryPath,
    units: new Map(),
    visiting: new Set(),
    usedImports: new Map(),
    usedDecls: new Set(),
  };
  visitSoundUnit(state, entryPath);
  const root = state.units.get(entryPath)!;
  if (root.kind !== 'sound') throw new Error(`${entryPath}: Expected sound entry`);
  const resolvedRecipe = resolveRecipeGraph(state);
  checkSoundHygiene(state);
  const budget = soundRecipeBudget(resolvedRecipe);
  return {
    unit: root,
    resolvedRecipe,
    budget,
    soundPaths: [...state.units.keys()],
  };
};

export const compilePreparedSound = (
  prepared: ReturnType<typeof prepareDirectorySound>,
  entryPath: string,
): CompiledDirectorySound => ({
  unit: prepared.unit,
  budget: prepared.budget,
  sounds: compileSoundRecipe(prepared.resolvedRecipe, entryPath),
  soundPaths: prepared.soundPaths,
});
