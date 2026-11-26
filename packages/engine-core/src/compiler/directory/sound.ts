import {
  applySoundDefaults,
  compileSoundRecipe,
  parseSoundUnit,
  resolveSoundParams,
  soundRecipeBudget,
  type SoundBudget,
  type SoundImportDecl,
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
  readonly collectedVoices: Map<string, Record<string, unknown>>;
  readonly usedVoiceIds: Set<string>;
}

const markImportUsed = (state: SoundGraphState, owner: string, alias: string): void => {
  const set = state.usedImports.get(owner) ?? new Set<string>();
  set.add(alias);
  state.usedImports.set(owner, set);
};

const visitSoundUnit = (state: SoundGraphState, filePath: string): void => {
  if (state.visiting.has(filePath)) throw new Error(`${filePath}: sound.cycle: Import cycle`);
  if (state.units.has(filePath)) return;
  if (state.visiting.size >= 32) {
    throw new Error(`${filePath}: sound.depth: Import depth exceeds 32`);
  }
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

const mergeImportParams = (
  ownerPath: string,
  imp: SoundImportDecl,
  target: SoundSourceUnit,
): SoundSourceUnit['params'] => {
  if (!imp.params) return target.params;
  for (const key of Object.keys(imp.params)) {
    if (!Object.hasOwn(target.params, key)) {
      throw new Error(
        `${ownerPath}: sound.unknown-param: Unknown parameter "${key}" on import "${imp.alias}"`,
      );
    }
  }
  return { ...target.params, ...imp.params };
};

const resolveNamedDecl = (
  state: SoundGraphState,
  ownerPath: string,
  refName: string,
  declKind: 'voice' | 'sequence',
  ownerParams: SoundSourceUnit['params'],
  ownerScopeKey = 'local',
  ownerAlias?: string,
): {
  readonly owner: string;
  readonly scopeKey: string;
  readonly id: string;
  readonly alias?: string;
  readonly value: Readonly<Record<string, unknown>>;
  readonly params: SoundSourceUnit['params'];
} => {
  const unit = state.units.get(ownerPath)!;
  if (!refName.includes('.')) {
    const list = declKind === 'voice' ? unit.voices : unit.sequences;
    const hit = list.find((d) => d.id === refName);
    if (!hit) {
      throw new Error(`${ownerPath}: sound.unknown-${declKind}: Unknown ${declKind} "${refName}"`);
    }
    state.usedDecls.add(`${ownerPath}\u0000${declKind}\u0000${hit.id}`);
    return {
      owner: ownerPath,
      scopeKey: ownerScopeKey,
      id: hit.id,
      ...(ownerAlias ? { alias: ownerAlias } : {}),
      value: hit.value,
      params: ownerParams,
    };
  }
  const [alias, id] = refName.split('.');
  const imp = unit.imports.find((i) => i.alias === alias);
  if (!imp || !id) {
    throw new Error(`${ownerPath}: sound.unknown-import: Unknown import ref "${refName}"`);
  }
  markImportUsed(state, ownerPath, alias!);
  const targetPath = relativePath(ownerPath, imp.path);
  const target = state.units.get(targetPath)!;
  const list = declKind === 'voice' ? target.voices : target.sequences;
  const hit = list.find((d) => d.id === id && d.exported);
  if (!hit) {
    throw new Error(
      `${ownerPath}: sound.unknown-${declKind}: Unknown exported ${declKind} "${refName}"`,
    );
  }
  state.usedDecls.add(`${targetPath}\u0000${declKind}\u0000${hit.id}`);
  const nextScope = ownerScopeKey === 'local' ? alias! : `${ownerScopeKey}.${alias!}`;
  const nextAlias = ownerAlias ? `${ownerAlias}_${alias!}` : alias!;
  return {
    owner: targetPath,
    scopeKey: nextScope,
    id: hit.id,
    alias: nextAlias,
    value: hit.value,
    params: mergeImportParams(ownerPath, imp, target),
  };
};

const resolveVoiceRef = (
  state: SoundGraphState,
  ownerPath: string,
  rawRef: unknown,
  ownerParams: SoundSourceUnit['params'],
  ownerScopeKey = 'local',
  ownerAlias?: string,
): string => {
  const refName = isRefValue(rawRef) ? rawRef.$ref : String(rawRef);
  const decl = resolveNamedDecl(
    state,
    ownerPath,
    refName,
    'voice',
    ownerParams,
    ownerScopeKey,
    ownerAlias,
  );
  const cacheKey = `${decl.owner}\u0000${decl.scopeKey}\u0000${decl.id}`;
  const cached = state.collectedVoices.get(cacheKey);
  if (cached) return String(cached.id);

  let assignedId = decl.id;
  if (state.usedVoiceIds.has(assignedId)) {
    assignedId = `${decl.alias ?? state.units.get(decl.owner)!.id}_${decl.id}`;
  }
  state.usedVoiceIds.add(assignedId);
  const placeholder: Record<string, unknown> = { id: assignedId };
  state.collectedVoices.set(cacheKey, placeholder);

  const resolved = resolveSoundParams(decl.value, decl.params, (msg) => {
    throw new Error(`${decl.owner}: ${msg}`);
  }) as Record<string, unknown>;
  if (resolved.duck && typeof resolved.duck === 'object' && !Array.isArray(resolved.duck)) {
    const duck = { ...(resolved.duck as Record<string, unknown>) };
    duck.by = resolveVoiceRef(state, decl.owner, duck.by, decl.params, decl.scopeKey, decl.alias);
    resolved.duck = duck;
  }
  Object.assign(placeholder, resolved, { id: assignedId });
  return assignedId;
};

const resolveSequenceSteps = (
  state: SoundGraphState,
  ownerPath: string,
  seqVal: Record<string, unknown>,
  ownerParams: SoundSourceUnit['params'],
  ownerScopeKey = 'local',
  ownerAlias?: string,
): Record<string, unknown> => {
  const resolvedSeq = resolveSoundParams(seqVal, ownerParams, (msg) => {
    throw new Error(`${ownerPath}: ${msg}`);
  }) as Record<string, unknown>;
  if (!Array.isArray(resolvedSeq.steps)) return resolvedSeq;
  const steps = resolvedSeq.steps.map((rawStep) => {
    if (!rawStep || typeof rawStep !== 'object' || Array.isArray(rawStep)) return rawStep;
    const step = { ...(rawStep as Record<string, unknown>) };
    step.voice = resolveVoiceRef(
      state,
      ownerPath,
      step.voice,
      ownerParams,
      ownerScopeKey,
      ownerAlias,
    );
    return step;
  });
  return { ...resolvedSeq, steps };
};

const resolveRecipeGraph = (state: SoundGraphState): Record<string, unknown> => {
  const root = state.units.get(state.entryPath)!;
  const sequences = root.sequences.map((seq) => {
    state.usedDecls.add(`${state.entryPath}\u0000sequence\u0000${seq.id}`);
    return resolveSequenceSteps(state, state.entryPath, { ...seq.value, id: seq.id }, root.params);
  });
  return applySoundDefaults(
    {
      ...root.body,
      id: root.id,
      voices: [...state.collectedVoices.values()],
      sequences,
    },
    root.params,
    (msg) => {
      throw new Error(`${state.entryPath}: ${msg}`);
    },
  );
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
  if (deadImport) {
    throw new Error(`${filePath}: sound.unused-import: Unused import "${deadImport.alias}"`);
  }
  const isRoot = filePath === state.entryPath;
  checkNamedUsage(state.usedDecls, filePath, 'voice', isRoot, unit.voices);
  checkNamedUsage(state.usedDecls, filePath, 'sequence', isRoot, unit.sequences);
};

const checkSoundHygiene = (state: SoundGraphState): void => {
  for (const [filePath, unit] of state.units) checkUnitSoundHygiene(state, filePath, unit);
  const rootFile = state.files.get(state.entryPath)!;
  const rootUnit = state.units.get(state.entryPath)!;
  const nonEmptyLines = rootFile.source.split(/\r?\n/u).filter((l) => l.trim().length > 0).length;
  const declCount = rootUnit.voices.length + rootUnit.sequences.length;
  if (nonEmptyLines > 140 && rootUnit.imports.length === 0 && declCount >= 4) {
    throw new Error(
      `${state.entryPath}: sound.monolithic-entry: Sound entry mixes ${declCount} inline voices/seqs across ${nonEmptyLines} non-empty lines with no imports. Extract reusable voices/seqs into a module.`,
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
    collectedVoices: new Map(),
    usedVoiceIds: new Set(),
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
