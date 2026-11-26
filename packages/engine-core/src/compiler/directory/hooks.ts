import type { HooksDocument, HookTransformContext } from '../../hooks/contract';
import { checkWorkspaceModularity, normalizeWorkspacePath } from '../../hooks/modularityGuard';
import { compileHooksForWorkspaceFile, hasHooksContent } from '../../hooks/resolve';
import type { DirectoryFile, DirectoryWorkspace } from '../../project/directory/contract';
import { parseHooksSource } from '../../hooks/parse';
import {
  directoryPath,
  isDirectorySource,
  readDirectoryWorkspace,
} from '../../project/directory/read';
import type { WorkspaceEntrySelector } from '../../project/workspace';

export { readDirectoryWorkspace, directoryPath, isDirectorySource };

export const buildModuleAliasMap = (config: DirectoryWorkspace): ReadonlyMap<string, string> => {
  const aliases = new Map<string, string>();
  for (const pkg of config.packages) {
    for (const mod of pkg.manifest.modules) {
      const subpath = mod.subpath.replace(/^\.\//u, '');
      const fullPath = normalizeWorkspacePath(pkg.root ? `${pkg.root}/${mod.path}` : mod.path);
      aliases.set(`${pkg.name}/${subpath}`, fullPath);
    }
  }
  return aliases;
};

const enqueueHookImports = (
  filePath: string,
  source: string,
  filesByPath: ReadonlyMap<string, DirectoryFile>,
  seen: ReadonlySet<string>,
  stack: string[],
  moduleAliases?: ReadonlyMap<string, string>,
): void => {
  const dir = filePath.includes('/') ? filePath.slice(0, filePath.lastIndexOf('/')) : '';
  for (const imp of parseHooksSource(source, filePath, { allowHostStatements: true }).unit
    .imports) {
    const next = imp.path.startsWith('.')
      ? normalizeWorkspacePath(dir ? `${dir}/${imp.path}` : imp.path)
      : moduleAliases?.get(imp.path);
    if (next && !seen.has(next) && filesByPath.has(next)) stack.push(next);
  }
};

export const collectHookModuleClosure = (
  entryPaths: readonly string[],
  filesByPath: ReadonlyMap<string, DirectoryFile>,
  moduleAliases?: ReadonlyMap<string, string>,
): ReadonlySet<string> => {
  const seen = new Set<string>();
  const stack = [...entryPaths];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (seen.has(cur)) continue;
    seen.add(cur);
    const file = filesByPath.get(cur);
    if (file) enqueueHookImports(cur, file.source, filesByPath, seen, stack, moduleAliases);
  }
  return seen;
};

export const assertSoundWorkspaceBudget = (
  path: string,
  sources: number,
  total: {
    readonly outputFrames: number;
    readonly eventFrames: number;
    readonly weightedFrames: number;
  },
): void => {
  if (
    sources > 32 ||
    total.outputFrames > 11520000 ||
    total.eventFrames > 24000000 ||
    total.weightedFrames > 192000000
  ) {
    throw new Error(
      `${path}: sound workspace budget exceeded: sources=${sources}/32, rawFrames=${total.outputFrames}/11520000, eventFrames=${total.eventFrames}/24000000, weightedFrames=${total.weightedFrames}/192000000`,
    );
  }
};

const EXPORT_FORMATS = {
  sprite: ['png'],
  model: ['glb', 'gltf', 'java_block', 'geckolib5', 'bedrock'],
  sound: ['wav'],
  structure: ['java_structure', 'glb'],
  vfx: ['glb'],
} as const;

const checkPackSounds = (
  pack: NonNullable<DirectoryWorkspace['packs']>[number],
  exportsByName: ReadonlyMap<string, DirectoryWorkspace['exports'][number]>,
  soundsOf: (entry: WorkspaceEntrySelector) => readonly { readonly variant: string }[] | undefined,
): void => {
  if (pack.format !== 'minecraft_java') return;
  for (const sound of pack.sounds) {
    const target = exportsByName.get(sound.source)!;
    const available = soundsOf(target.entry);
    if (!available) throw new Error('Pack sound source kind mismatch: ' + sound.source);
    const set = new Set(available.map((s) => s.variant));
    if (sound.variants !== 'all' && sound.variants.some((v) => !set.has(v.id))) {
      throw new Error('Unknown sound variant in pack: ' + pack.name + '/' + sound.id);
    }
  }
};

export const directoryCompilationExportsCheck = (
  config: DirectoryWorkspace,
  productsByEntry: ReadonlyMap<
    string,
    { readonly kind: 'sprite' | 'model' | 'sound' | 'structure' | 'vfx' }
  >,
  soundsOf: (entry: WorkspaceEntrySelector) => readonly { readonly variant: string }[] | undefined,
  entryKey: (e: WorkspaceEntrySelector) => string,
): void => {
  for (const target of config.exports) {
    const p = productsByEntry.get(entryKey(target.entry))!;
    if (!EXPORT_FORMATS[p.kind].some((format) => format === target.format)) {
      throw new Error('Export format does not match entry kind: ' + target.name);
    }
  }
  const exportsByName = new Map(config.exports.map((target) => [target.name, target]));
  for (const pack of config.packs ?? []) checkPackSounds(pack, exportsByName, soundsOf);
};

export interface DirectoryFailure {
  readonly ok: false;
  readonly diagnostics: readonly {
    readonly code: string;
    readonly file: string;
    readonly message: string;
  }[];
}

export const checkDirectoryModularity = (
  files: readonly DirectoryFile[],
): DirectoryFailure | null => {
  const res = checkWorkspaceModularity(files);
  if (res.ok) return null;
  return {
    ok: false,
    diagnostics: res.diagnostics
      .filter((d) => d.severity === 'error')
      .map((d) => ({
        code: d.code,
        file: d.file,
        message: `${d.line}:${d.column}: ${d.message}`,
      })),
  };
};

export const resolveDirectoryHooks = (
  entryPath: string,
  filesByPath: ReadonlyMap<string, DirectoryFile>,
  nonModelPaths?: Set<string>,
  context?: HookTransformContext,
  moduleAliases?: ReadonlyMap<string, string>,
): { readonly hooks?: HooksDocument; readonly failure?: DirectoryFailure } => {
  const res = compileHooksForWorkspaceFile(entryPath, filesByPath, context, moduleAliases);
  for (const p of res.referencedPaths) nonModelPaths?.add(p);
  if (!res.ok) {
    return {
      failure: {
        ok: false,
        diagnostics: res.diagnostics.map((d) => ({
          code: d.code,
          file: d.file,
          message: `${d.line}:${d.column}: ${d.message}`,
        })),
      },
    };
  }
  return { hooks: hasHooksContent(res.document) ? res.document : undefined };
};
