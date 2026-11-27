import { AUDIO_POLICY } from '@ashfox/audio-core';
import { compareText } from '@ashfox/internal-contracts';
import { canonicalJsonString } from '../../canonicalJson';
import type { DirectoryFile, DirectoryWorkspace } from '../../project/directory/contract';
import { readDirectoryWorkspace } from '../../project/directory/read';
import { lexProgramSource } from '../../project/program/syntax/lex';
import { SPRITE_POLICY } from '../../project/sprite/contract';
import { mergeVirtualLibraryFiles } from '../../project/stdlib/resolve';
import { ASHFOX_WORKSPACE_COMPILER_FINGERPRINT } from '../../project/workspace';
import { sha256Digest } from '../../provenance/digest';
import { withStructureTileTextureCache } from '../structure/atlas';
import type { StructureAuditEvaluator } from '../structure/contract';
import { createDirectoryWorkspaceCache, type DirectoryWorkspaceCache } from './cache';
import {
  assertSourceBudget,
  declaredEntries,
  declaredFiles,
  entryKey,
  sortDirectoryProducts,
  type DirectoryEntry as Entry,
} from './checks';
import { checkDirectoryModularity, directoryCompilationExportsCheck } from './hooks';
import { validateCanonicalLayout } from './layout';
import { compileModels } from './models';
import {
  compileFailure,
  createDomainCompileContext,
  DOMAIN_ENTRY_COMPILERS,
  resolveDomainKind,
  runDomainEntry,
  type DirectoryDiagnostic,
  type DirectoryProduct,
  type EntryOutput,
} from './registry';

export type { DirectoryProduct };

export type DirectoryCompilation =
  | {
      readonly ok: true;
      readonly config: DirectoryWorkspace;
      readonly sourceHash: string;
      readonly buildKey: string;
      readonly products: readonly DirectoryProduct[];
    }
  | { readonly ok: false; readonly diagnostics: readonly DirectoryDiagnostic[] };

export type DirectoryFailure = Extract<DirectoryCompilation, { readonly ok: false }>;

type Files = ReadonlyMap<string, DirectoryFile>;

const entryTopKind = (
  filePath: string,
  filesByPath: Files,
  cache?: DirectoryWorkspaceCache,
): string | undefined => {
  if (cache?.topKinds.has(filePath)) return cache.topKinds.get(filePath);
  const kind = lexProgramSource(filesByPath.get(filePath)!.source).tokens[2]?.value;
  cache?.topKinds.set(filePath, kind);
  return kind;
};

const runEntryLoop = (
  entries: readonly Entry[],
  kinds: ReadonlyMap<string, string | undefined>,
  filesByPath: Files,
  evaluateStructureAudit: StructureAuditEvaluator,
  cache: DirectoryWorkspaceCache | undefined,
): EntryOutput | DirectoryFailure => {
  const output: EntryOutput = {
    products: [],
    nonModelPaths: new Set(),
    structureCustomPaths: new Set(),
    modelEntries: [],
  };
  const ctx = createDomainCompileContext(
    entries,
    kinds,
    filesByPath,
    evaluateStructureAudit,
    output.nonModelPaths,
    cache,
  );
  for (const e of entries) {
    const domainKind = resolveDomainKind(kinds.get(e.path));
    if (!domainKind) {
      output.modelEntries.push(e);
      continue;
    }
    const failure = runDomainEntry(DOMAIN_ENTRY_COMPILERS[domainKind], e, ctx, output);
    if (failure) return failure;
  }
  return output;
};

/** Compiles sprite, structure, sound, and vfx entries in declaration order and defers models. */
const compileEntries = (
  entries: readonly Entry[],
  filesByPath: Files,
  evaluateStructureAudit: StructureAuditEvaluator,
  cache?: DirectoryWorkspaceCache,
): EntryOutput | DirectoryFailure => {
  const kinds = new Map(entries.map((e) => [e.path, entryTopKind(e.path, filesByPath, cache)]));
  return cache
    ? withStructureTileTextureCache(cache.tileTextures, () =>
        runEntryLoop(entries, kinds, filesByPath, evaluateStructureAudit, cache),
      )
    : runEntryLoop(entries, kinds, filesByPath, evaluateStructureAudit, undefined);
};

const compileDirectory = (
  configuration: string,
  files: readonly DirectoryFile[],
  evaluateStructureAudit: StructureAuditEvaluator,
  useCache: boolean,
  virtualLibraries?: ReadonlyMap<string, string>,
): DirectoryCompilation => {
  const config = readDirectoryWorkspace(configuration);
  const effectiveFiles = mergeVirtualLibraryFiles(files, virtualLibraries, (path, source) => ({
    path,
    source,
  }));
  assertSourceBudget(effectiveFiles);
  const filesByPath = declaredFiles(config, effectiveFiles);
  const entries = declaredEntries(config);
  const cache = useCache ? createDirectoryWorkspaceCache() : undefined;
  validateCanonicalLayout(
    config,
    filesByPath,
    entries.map((e) => e.path),
    cache,
  );
  const modFailure = checkDirectoryModularity(effectiveFiles);
  if (modFailure) return modFailure;
  const output = compileEntries(entries, filesByPath, evaluateStructureAudit, cache);
  if ('ok' in output) return output;
  const modelFailure = compileModels(config, effectiveFiles, filesByPath, output, cache);
  if (modelFailure) return modelFailure;
  const productsByEntry = new Map(
    output.products.map((product) => [entryKey(product.entry), product]),
  );
  directoryCompilationExportsCheck(
    config,
    productsByEntry,
    (entry) => {
      const p = productsByEntry.get(entryKey(entry));
      return p?.kind === 'sound' ? p.sounds : undefined;
    },
    entryKey,
  );
  const products = sortDirectoryProducts(output.products);
  const sourceHash = sha256Digest(
    canonicalJsonString({
      config,
      files: [...effectiveFiles].sort((a, b) => compareText(a.path, b.path)),
    }),
  );
  const buildKey = sha256Digest(
    sourceHash +
      SPRITE_POLICY +
      AUDIO_POLICY +
      ASHFOX_WORKSPACE_COMPILER_FINGERPRINT +
      ':directory-v2',
  );
  return { ok: true, config, sourceHash, buildKey, products: Object.freeze(products) };
};

export const compileDirectoryWorkspace = (
  configuration: string,
  files: readonly DirectoryFile[],
  evaluateStructureAudit: StructureAuditEvaluator,
  useCache = true,
  virtualLibraries?: ReadonlyMap<string, string>,
): DirectoryCompilation => {
  try {
    return compileDirectory(
      configuration,
      files,
      evaluateStructureAudit,
      useCache,
      virtualLibraries,
    );
  } catch (error) {
    return compileFailure(error);
  }
};
