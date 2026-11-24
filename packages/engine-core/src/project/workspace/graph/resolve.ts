import { errorDiagnostic, type WorkspaceDiagnostic } from '../diagnostic';
import type { WorkspaceParsedImport } from '../contract';
import { type NodeRef, type PackageIndex } from './contract';
import { normalizeLogicalPath } from '../path';

interface PackageSpecifier {
  readonly packageName: string;
  readonly subpath: string;
}

const isNormalizedRelativeSpecifier = (specifier: string): boolean =>
  specifier.startsWith('./') &&
  !specifier.includes('//') &&
  !specifier.includes('/./') &&
  !specifier.includes('/../') &&
  !specifier.endsWith('/') &&
  specifier.normalize('NFC') === specifier;

/** Applies relative segments to the importer directory; undefined escapes the root. */
const applySegments = (importer: string, specifier: string): string | undefined => {
  const base = importer.split('/');
  base.pop();
  for (const segment of specifier.split('/')) {
    if (segment === '' || segment === '.') continue;
    if (segment !== '..') base.push(segment);
    else if (base.length === 0) return undefined;
    else base.pop();
  }
  return base.join('/');
};

const relativeTargetPath = (
  importer: string,
  specifier: string,
  root: string,
): string | undefined => {
  if (!isNormalizedRelativeSpecifier(specifier)) return undefined;
  const result = applySegments(importer, specifier);
  if (result === undefined) return undefined;
  if (root.length > 0 && !result.startsWith(`${root}/`)) return undefined;
  try {
    return normalizeLogicalPath(result);
  } catch (_error) {
    return undefined;
  }
};

const packageSpecifier = (specifier: string): PackageSpecifier | undefined => {
  const pieces = specifier.split('/');
  if (specifier.startsWith('@')) {
    if (pieces.length < 3) return undefined;
    return {
      packageName: `${pieces[0]}/${pieces[1]}`,
      subpath: `./${pieces.slice(2).join('/')}`,
    };
  }
  if (pieces.length < 2) return undefined;
  return { packageName: pieces[0], subpath: `./${pieces.slice(1).join('/')}` };
};

const resolveRelativeImport = (
  from: NodeRef,
  importer: PackageIndex,
  record: WorkspaceParsedImport,
): NodeRef | WorkspaceDiagnostic => {
  const path = relativeTargetPath(from.path, record.specifier, importer.view.root);
  const module = path === undefined ? undefined : importer.modulesByPath.get(path);
  if (path === undefined || module === undefined)
    return errorDiagnostic(
      'workspace.import.relative_missing',
      `Relative import does not resolve to a declared module: ${record.specifier}.`,
      record.source,
    );
  return { kind: 'module', packageName: importer.view.name, name: module.subpath, path };
};

const resolvePackageImport = (
  importer: PackageIndex,
  record: WorkspaceParsedImport,
  indexes: ReadonlyMap<string, PackageIndex>,
): NodeRef | WorkspaceDiagnostic => {
  const parsed = packageSpecifier(record.specifier);
  if (parsed === undefined)
    return errorDiagnostic(
      'workspace.import.package_specifier',
      `Package import must name an exposed module subpath: ${record.specifier}.`,
      record.source,
    );
  if (!importer.view.manifest.dependencies.some((item) => item.name === parsed.packageName)) {
    return errorDiagnostic(
      'workspace.import.undeclared_dependency',
      `Package ${importer.view.name} does not declare dependency ${parsed.packageName}.`,
      record.source,
    );
  }
  const target = indexes.get(parsed.packageName);
  if (target === undefined)
    return errorDiagnostic(
      'workspace.import.package_missing',
      `Package dependency is not present in the closed workspace: ${parsed.packageName}.`,
      record.source,
    );
  const module = target.modulesBySubpath.get(parsed.subpath);
  if (module === undefined)
    return errorDiagnostic(
      'workspace.import.module_missing',
      `Package module is not exported: ${record.specifier}.`,
      record.source,
    );
  return {
    kind: 'module',
    packageName: parsed.packageName,
    name: module.subpath,
    path: module.path,
  };
};

export const resolveImport = (
  from: NodeRef,
  importer: PackageIndex,
  record: WorkspaceParsedImport,
  indexes: ReadonlyMap<string, PackageIndex>,
): NodeRef | WorkspaceDiagnostic =>
  record.specifier.startsWith('./') || record.specifier.startsWith('../')
    ? resolveRelativeImport(from, importer, record)
    : resolvePackageImport(importer, record, indexes);
