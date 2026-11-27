import { readResourcePacks } from './packRead';
import { readExportAdapterInput } from '../exportInput';
import { parseDirectoryJson } from './json';
import { readWorkspaceManifest, type WorkspacePackage } from '../workspace';
import { isStdLibraryLogicalPath } from '../stdlib/resolve';
import { deepFreeze } from '../../immutable';
import type { DirectoryWorkspace } from './contract';
import type { DirectoryPack } from './pack';
import { failWorkspaceConfig, readClosedRecord } from './validate';

const EXPORT_FORMATS = [
  'png',
  'glb',
  'gltf',
  'wav',
  'java_structure',
  'java_block',
  'geckolib5',
  'bedrock',
] as const;
const MINECRAFT_FORMATS = ['java_block', 'geckolib5', 'bedrock'] as const;
const RESERVED_OUTPUT_ROOTS = ['.git', 'node_modules', '.ashfox', '.ashfoxworkspace'] as const;

export const directoryPath = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length > 0 &&
  value.length <= 240 &&
  !value.startsWith('/') &&
  !/[\\:*?\[\]{}\x00-\x1f]/.test(value) &&
  value.split('/').every((p) => p !== '' && p !== '.' && p !== '..') &&
  value.normalize('NFC') === value;

const pattern = (value: unknown): value is string =>
  typeof value === 'string' &&
  value.length <= 240 &&
  value.length > 0 &&
  !value.startsWith('/') &&
  !value.startsWith('!') &&
  !/[\\:\[\]{}\x00-\x1f]/.test(value) &&
  value.split('/').every((p) => p !== '' && p !== '.' && p !== '..');

export const matchDirectoryPattern = (path: string, glob: string): boolean => {
  let expression = '^';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i]!;
    if (c === '*' && glob[i + 1] === '*') {
      i++;
      if (glob[i + 1] === '/') {
        i++;
        expression += '(?:.*/)?';
      } else expression += '.*';
    } else if (c === '*') expression += '[^/]*';
    else if (c === '?') expression += '[^/]';
    else expression += c.replace(/[.+^$()|]/g, '\\$&');
  }
  return new RegExp(expression + '$').test(path);
};

export const isDirectorySource = (config: DirectoryWorkspace, path: string): boolean => {
  const excluded = [
    '.git',
    'node_modules',
    '.ashfox',
    config.build.directory,
    ...config.exports.map((e) => e.directory),
    ...(config.packs ?? []).map((p) => p.directory),
  ];
  if (excluded.some((p) => path === p || path.startsWith(p + '/'))) return false;
  return (
    path.endsWith('.ashfox') &&
    config.include.some((p) => matchDirectoryPattern(path, p)) &&
    !config.ignore.some((p) => matchDirectoryPattern(path, p))
  );
};

const isMinecraftExport = (value: unknown): boolean =>
  value !== null &&
  typeof value === 'object' &&
  'format' in value &&
  MINECRAFT_FORMATS.includes(String(value.format) as (typeof MINECRAFT_FORMATS)[number]);

const isGltfExport = (value: unknown): boolean =>
  value !== null &&
  typeof value === 'object' &&
  'format' in value &&
  (value.format === 'glb' || value.format === 'gltf');

const validateExportAdapter = (entry: Record<string, unknown>, pointer: string): void => {
  try {
    readExportAdapterInput({
      target: entry.format,
      namespace: entry.namespace,
      modelPath: entry.modelPath,
    });
  } catch (error) {
    failWorkspaceConfig(
      pointer,
      'valid Minecraft export adapter',
      error instanceof Error ? error.message : error,
    );
  }
};

const hasGltfField = (value: unknown, field: 'encoding' | 'modelPath'): boolean =>
  isGltfExport(value) && typeof value === 'object' && value !== null && field in value;

const exportKeysFor = (value: unknown): readonly string[] => {
  if (isMinecraftExport(value)) {
    return ['name', 'entry', 'format', 'directory', 'namespace', 'modelPath'];
  }
  return [
    'name',
    'entry',
    'format',
    'directory',
    ...(hasGltfField(value, 'encoding') ? ['encoding'] : []),
    ...(hasGltfField(value, 'modelPath') ? ['modelPath'] : []),
  ];
};

const readDirectoryExport = (
  value: unknown,
  index: number,
  packages: readonly WorkspacePackage[],
  names: Set<string>,
): string => {
  const pointer = `/exports/${index}`;
  const entry = readClosedRecord(value, exportKeysFor(value), pointer);
  if ('encoding' in entry && !['portable', 'optimized'].includes(String(entry.encoding))) {
    failWorkspaceConfig(`${pointer}/encoding`, 'portable|optimized', entry.encoding);
  }
  if ('modelPath' in entry && !directoryPath(entry.modelPath)) {
    failWorkspaceConfig(`${pointer}/modelPath`, 'relative modelPath', entry.modelPath);
  }
  if (isMinecraftExport(entry)) validateExportAdapter(entry, pointer);
  const name = entry.name;
  if (typeof name !== 'string' || !/^[a-z][a-z0-9_]{0,47}$/.test(name) || names.has(name)) {
    return failWorkspaceConfig(`${pointer}/name`, 'unique export id', name);
  }
  names.add(name);
  const directory = entry.directory;
  if (!directoryPath(directory)) {
    return failWorkspaceConfig(`${pointer}/directory`, 'relative directory', directory);
  }
  if (!EXPORT_FORMATS.includes(String(entry.format) as (typeof EXPORT_FORMATS)[number])) {
    failWorkspaceConfig(`${pointer}/format`, EXPORT_FORMATS.join(' | '), entry.format);
  }
  const selector = readClosedRecord(entry.entry, ['packageName', 'entryName'], `${pointer}/entry`);
  const pkg = packages.find((candidate) => candidate.name === selector.packageName);
  if (!pkg?.manifest.entries.some((declared) => declared.name === selector.entryName)) {
    failWorkspaceConfig(`${pointer}/entry`, 'declared entry', JSON.stringify(selector));
  }
  return directory.toLowerCase();
};

const readWorkspacePackages = (rawPackages: unknown): readonly WorkspacePackage[] => {
  const manifest = readWorkspaceManifest({
    format: 'ashfox-workspace',
    version: 1,
    packages: rawPackages,
  });
  if (!manifest.ok) {
    return failWorkspaceConfig(
      '/packages',
      'valid package declarations',
      JSON.stringify(manifest.diagnostics),
    );
  }
  return manifest.value.packages;
};

const readGlobs = (record: Record<string, unknown>, field: 'include' | 'ignore'): string[] => {
  const list = record[field];
  if (!Array.isArray(list) || list.length > 64 || list.some((glob) => !pattern(glob))) {
    failWorkspaceConfig(`/${field}`, 'up to 64 root-relative globs (*, **, ?)', list);
  }
  return list as string[];
};

const validatePackEntry = (pack: DirectoryPack, index: number, names: Set<string>): string => {
  if (
    typeof pack.name !== 'string' ||
    !/^[a-z][a-z0-9_]{0,47}$/.test(pack.name) ||
    names.has(pack.name)
  ) {
    failWorkspaceConfig(`/packs/${index}/name`, 'unique export/pack id', pack.name);
  }
  names.add(pack.name);
  if (!directoryPath(pack.directory)) {
    failWorkspaceConfig(`/packs/${index}/directory`, 'relative directory', pack.directory);
  }
  return pack.directory.toLowerCase();
};

const overlaps = (left: string, right: string): boolean =>
  left === right || left.startsWith(`${right}/`);

const validateOutputDirectories = (directories: readonly string[]): void => {
  const bad = directories.some(
    (dir, i) =>
      RESERVED_OUTPUT_ROOTS.some((reserved) => overlaps(dir, reserved)) ||
      directories.some((other, j) => i !== j && overlaps(dir, other)),
  );
  if (bad)
    failWorkspaceConfig(
      '/build',
      'disjoint output directories outside reserved paths',
      directories,
    );
};

const validateDeclaredSources = (
  result: DirectoryWorkspace,
  packages: readonly WorkspacePackage[],
): void => {
  const roots = packages.filter((pkg) => pkg.name !== 'std').map((pkg) => pkg.root.toLowerCase());
  const nestedRoot = roots.some((a, i) =>
    roots.some((b, j) => i !== j && (a === b || a === '' || b.startsWith(`${a}/`))),
  );
  if (nestedRoot) failWorkspaceConfig('/packages', 'disjoint package roots', roots);
  const declared = packages.flatMap((pkg) =>
    [...pkg.manifest.entries, ...pkg.manifest.modules].map((entry) =>
      [pkg.root, entry.path].filter(Boolean).join('/'),
    ),
  );
  if (new Set(declared.map((path) => path.toLowerCase())).size !== declared.length) {
    failWorkspaceConfig('/packages', 'unique source paths', declared);
  }
  if (!declared.length) failWorkspaceConfig('/packages', 'at least one entry', 'empty');
  for (const path of declared) {
    if (!isStdLibraryLogicalPath(path) && !isDirectorySource(result, path)) {
      failWorkspaceConfig(
        '/include',
        'declared source must be included, not ignored or under output',
        path,
      );
    }
  }
};

/** Validates and freezes a `.ashfoxworkspace` configuration document. */
export const readDirectoryWorkspace = (source: string): DirectoryWorkspace => {
  const parsed = parseDirectoryJson(source, '.ashfoxworkspace');
  const hasPacks = parsed !== null && typeof parsed === 'object' && 'packs' in parsed;
  const rootKeys = [
    'format',
    'version',
    'name',
    'packages',
    'include',
    'ignore',
    'build',
    'exports',
    ...(hasPacks ? ['packs'] : []),
  ];
  const record = readClosedRecord(parsed, rootKeys, '');
  if (record.format !== 'ashfox-workspace' || record.version !== 2) {
    failWorkspaceConfig(
      '/version',
      'root configuration version 2; use import for embedded v1',
      record.version,
    );
  }
  if (typeof record.name !== 'string' || !/^[a-z][a-z0-9_-]{0,47}$/.test(record.name)) {
    failWorkspaceConfig('/name', 'project name', record.name);
  }
  const packages = readWorkspacePackages(record.packages);
  const include = readGlobs(record, 'include');
  const ignore = readGlobs(record, 'ignore');
  if (include.length === 0) failWorkspaceConfig('/include', 'at least one pattern', 'empty');
  const build = readClosedRecord(record.build, ['directory'], '/build');
  if (!directoryPath(build.directory))
    failWorkspaceConfig('/build/directory', 'non-root relative directory', build.directory);
  if (!Array.isArray(record.exports))
    failWorkspaceConfig('/exports', 'array of exports', record.exports);
  const names = new Set<string>();
  const directories = [(build.directory as string).toLowerCase()];
  (record.exports as unknown[]).forEach((value, index) =>
    directories.push(readDirectoryExport(value, index, packages, names)),
  );
  const packs = readResourcePacks(record.packs, record.exports as DirectoryWorkspace['exports']);
  packs.forEach((pack, index) => directories.push(validatePackEntry(pack, index, names)));
  validateOutputDirectories(directories);
  const result: DirectoryWorkspace = deepFreeze({
    format: 'ashfox-workspace',
    version: 2,
    name: record.name as string,
    packages,
    include,
    ignore,
    build: { directory: build.directory as string },
    exports: record.exports as DirectoryWorkspace['exports'],
    ...(hasPacks ? { packs } : {}),
  });
  validateDeclaredSources(result, packages);
  return result;
};
