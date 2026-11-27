import * as fs from 'node:fs';
import * as path from 'node:path';
import { BuildFailure, loadBundledStdLibrary } from '@ashfox/asset-build';
import {
  describeVirtualModule,
  filterVirtualLibraries,
  formatDidYouMean,
  listVirtualLibraries,
  type VirtualModuleDescription,
} from '@ashfox/engine-core';
import { formatCliResult } from '../onboarding/cli';
import {
  formatModuleListText,
  formatNamespacesText,
  toModuleSummary,
  type LibraryModuleSummary,
  type LibraryNamespaceSummary,
} from './format';

const compareText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

interface ParsedLibraryArgs {
  readonly action: 'namespaces' | 'list' | 'show' | 'eject';
  readonly namespace?: string;
  readonly target?: string;
  readonly toDir: string;
  readonly force: boolean;
  readonly json: boolean;
}

const USAGE =
  'Usage: ashfox library list [--json] | ashfox library <ns> list [prefix] [--json] | show <module> [--json] | eject <module> [--to <dir>] [--force] [--json]';

const readLibraryFlag = (
  args: readonly string[],
  index: number,
  state: { json: boolean; force: boolean; toDir: string },
): number => {
  const arg = args[index]!;
  if (arg === '--json') {
    if (state.json) throw new BuildFailure('cli.arguments', 'Duplicate --json', 2);
    state.json = true;
    return index;
  }
  if (arg === '--force') {
    if (state.force) throw new BuildFailure('cli.arguments', 'Duplicate --force', 2);
    state.force = true;
    return index;
  }
  if (arg === '--to') {
    const dir = args[index + 1];
    if (!dir || dir.startsWith('--')) {
      throw new BuildFailure('cli.arguments', 'Missing directory after --to', 2);
    }
    state.toDir = dir;
    return index + 1;
  }
  throw new BuildFailure('cli.arguments', `Unknown option "${arg}" for ashfox library`, 2);
};

const parseNamespacedArgs = (
  positionals: readonly string[],
  flags: { readonly json: boolean; readonly force: boolean; readonly toDir: string },
): ParsedLibraryArgs => {
  const [ns, sub, target] = positionals;
  if (
    sub === 'list' &&
    positionals.length <= 3 &&
    !flags.force &&
    flags.toDir === 'assets/module'
  ) {
    return { action: 'list', namespace: ns, target, ...flags };
  }
  if (
    sub === 'show' &&
    positionals.length === 3 &&
    !flags.force &&
    flags.toDir === 'assets/module'
  ) {
    return { action: 'show', namespace: ns, target, ...flags };
  }
  if (sub === 'eject' && positionals.length === 3) {
    return { action: 'eject', namespace: ns, target, ...flags };
  }
  throw new BuildFailure('cli.arguments', USAGE, 2);
};

const parseLibraryArgs = (args: readonly string[]): ParsedLibraryArgs => {
  const flags = { json: false, force: false, toDir: 'assets/module' };
  const positionals: string[] = [];
  for (let i = 1; i < args.length; i += 1) {
    const arg = args[i]!;
    if (arg.startsWith('--')) i = readLibraryFlag(args, i, flags);
    else positionals.push(arg);
  }
  if (positionals.length === 0 || (positionals.length === 1 && positionals[0] === 'list')) {
    if (flags.force || flags.toDir !== 'assets/module') {
      throw new BuildFailure('cli.arguments', USAGE, 2);
    }
    return { action: 'namespaces', ...flags };
  }
  return parseNamespacedArgs(positionals, flags);
};

const listNamespaces = (
  entries: ReadonlyMap<string, string>,
): readonly LibraryNamespaceSummary[] => {
  const descriptors = listVirtualLibraries(entries);
  const domains = [...new Set(descriptors.map((d) => d.domain))].sort(compareText);
  return [{ namespace: 'std', moduleCount: descriptors.length, domains }];
};

const assertKnownNamespace = (namespace: string, entries: ReadonlyMap<string, string>): void => {
  const namespaces = listNamespaces(entries).map((n) => n.namespace);
  if (namespaces.includes(namespace)) return;
  const suggestion = formatDidYouMean(namespace, namespaces);
  throw new BuildFailure(
    'library.unknown-namespace',
    `Unknown library namespace "${namespace}".${suggestion}`,
    2,
    undefined,
    "Hint: run 'ashfox library std list'",
  );
};

const resolveModuleDescription = (
  namespace: string,
  rawModule: string,
  entries: ReadonlyMap<string, string>,
): VirtualModuleDescription => {
  const normalized = rawModule.replace(/\.ashfox$/u, '').replace(/^\/+|\/+$/gu, '');
  const specifier = `${namespace}/${normalized}`;
  const source = entries.get(specifier);
  if (typeof source !== 'string') {
    const moduleIds = listVirtualLibraries(entries).map((d) => d.id);
    const suggestion = formatDidYouMean(normalized, moduleIds);
    throw new BuildFailure(
      'library.unknown-module',
      `Unknown module "${rawModule}" in namespace "${namespace}".${suggestion}`,
      2,
      undefined,
      "Hint: run 'ashfox library std list'",
    );
  }
  return describeVirtualModule(specifier, source);
};

const executeList = (
  namespace: string,
  prefix: string | undefined,
  entries: ReadonlyMap<string, string>,
  json: boolean,
): void => {
  const cleanPrefix = prefix ? prefix.replace(/^\/+|\/+$/gu, '') : undefined;
  const summaries: readonly LibraryModuleSummary[] = filterVirtualLibraries(
    entries,
    cleanPrefix,
  ).map((descriptor) => {
    const source = entries.get(descriptor.specifier) ?? '';
    return toModuleSummary(describeVirtualModule(descriptor.specifier, source));
  });
  if (json) {
    process.stdout.write(
      formatCliResult('library', true, {
        namespace,
        prefix: cleanPrefix ?? null,
        modules: summaries,
      }),
    );
    return;
  }
  process.stdout.write(formatModuleListText(namespace, summaries));
};

const executeShow = (namespace: string, desc: VirtualModuleDescription, json: boolean): void => {
  if (json) {
    process.stdout.write(
      formatCliResult('library', true, {
        namespace,
        ...toModuleSummary(desc),
        logicalPath: desc.logicalPath,
        imports: desc.imports,
        detailedExports: desc.exports,
        detailedParams: desc.params,
        source: desc.source,
      }),
    );
    return;
  }
  process.stdout.write(desc.source.endsWith('\n') ? desc.source : `${desc.source}\n`);
};

const executeEject = (
  namespace: string,
  desc: VirtualModuleDescription,
  toDir: string,
  force: boolean,
  json: boolean,
): void => {
  const name = path.posix.basename(desc.id);
  const destination = path.resolve(toDir, `${name}.ashfox`);
  const existed = fs.existsSync(destination);
  if (existed && !force) {
    throw new BuildFailure(
      'library.eject-exists',
      `Destination file already exists: ${destination}`,
      2,
      undefined,
      'Hint: pass --force to overwrite or choose a different --to directory',
    );
  }
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, desc.source, { encoding: 'utf8', flag: force ? 'w' : 'wx' });
  if (json) {
    process.stdout.write(
      formatCliResult('library', true, {
        namespace,
        module: desc.id,
        specifier: desc.specifier,
        path: destination,
        overwritten: existed,
      }),
    );
    return;
  }
  process.stdout.write(`Ejected ${desc.specifier} to ${destination}\n`);
};

export const runLibraryCommand = (args: readonly string[]): void => {
  const parsed = parseLibraryArgs(args);
  const entries = loadBundledStdLibrary();
  if (parsed.action === 'namespaces') {
    const namespaces = listNamespaces(entries);
    if (parsed.json) {
      process.stdout.write(formatCliResult('library', true, { namespaces }));
    } else {
      process.stdout.write(formatNamespacesText(namespaces));
    }
    return;
  }
  const ns = parsed.namespace!;
  assertKnownNamespace(ns, entries);
  if (parsed.action === 'list') {
    executeList(ns, parsed.target, entries, parsed.json);
    return;
  }
  const desc = resolveModuleDescription(ns, parsed.target!, entries);
  if (parsed.action === 'show') {
    executeShow(ns, desc, parsed.json);
    return;
  }
  executeEject(ns, desc, parsed.toDir, parsed.force, parsed.json);
};
