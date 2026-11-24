import {
  hasExactContractKeys,
  isClosedContractRecord,
  isDenseContractArray,
  isNonEmptyContractText,
} from '@ashfox/internal-contracts';

import {
  ASHFOX_PACKAGE_FORMAT,
  ASHFOX_WORKSPACE_FORMAT,
  ASHFOX_WORKSPACE_VERSION,
  type AssetEntry,
  type ModuleDeclaration,
  type PackageDependency,
  type PackageManifest,
  type Sha256Digest,
  type WorkspaceManifest,
  type WorkspacePackage,
} from './contract';
import {
  errorDiagnostic,
  errorMessage,
  syntheticSourceRef,
  type WorkspaceReadResult,
} from './diagnostic';
import { assertWellFormedSourceText, normalizePackageRoot, normalizeRelativePath } from './path';

export type SchemaRecordValue = Readonly<Record<string, unknown>>;
const contractRef = syntheticSourceRef('ashfox.workspace.json');

export const schemaFail = <T>(code: string, message: string): WorkspaceReadResult<T> => ({
  ok: false,
  diagnostics: [errorDiagnostic(code, message, contractRef)],
});

export const exactSchemaRecord = (
  value: unknown,
  keys: readonly string[],
): value is SchemaRecordValue =>
  isClosedContractRecord(value) && hasExactContractKeys(value, new Set(keys));

export const readSchemaText = (value: unknown, field: string): WorkspaceReadResult<string> => {
  if (!isNonEmptyContractText(value)) {
    return schemaFail(
      'workspace.contract.text',
      `${field} must be non-empty text without surrounding whitespace.`,
    );
  }
  try {
    return { ok: true, value: assertWellFormedSourceText(value) };
  } catch (error) {
    return schemaFail(
      'workspace.contract.utf8',
      errorMessage(error, `${field} is not valid UTF-8 text.`),
    );
  }
};

const readIdentifier = (value: unknown, field: string): WorkspaceReadResult<string> => {
  const valueText = readSchemaText(value, field);
  if (!valueText.ok) return valueText;
  if (!/^[A-Za-z_][A-Za-z0-9_]*$/u.test(valueText.value)) {
    return schemaFail('workspace.contract.identifier', `${field} must be an ASCII identifier.`);
  }
  return valueText;
};

export const readPackageName = (value: unknown, field: string): WorkspaceReadResult<string> => {
  const valueText = readSchemaText(value, field);
  if (!valueText.ok) return valueText;
  const valid = /^@[a-z0-9][a-z0-9._-]*\/[a-z0-9][a-z0-9._-]*$|^[a-z0-9][a-z0-9._-]*$/u.test(
    valueText.value,
  );
  if (!valid) {
    return schemaFail(
      'workspace.contract.package_name',
      `${field} must be a normalized lowercase package name.`,
    );
  }
  return valueText;
};

const relativeSourcePath = (value: unknown, field: string): WorkspaceReadResult<string> => {
  const valueText = readSchemaText(value, field);
  if (!valueText.ok) return valueText;
  try {
    const path = normalizeRelativePath(valueText.value);
    if (!path.endsWith('.ashfox')) {
      return schemaFail(
        'workspace.contract.source_extension',
        `${field} must refer to an .ashfox source file.`,
      );
    }
    return { ok: true, value: path };
  } catch (error) {
    return schemaFail(
      'workspace.contract.path',
      errorMessage(error, `${field} is not a normalized path.`),
    );
  }
};

export const readRootPath = (value: unknown, field: string): WorkspaceReadResult<string> => {
  if (value === '') return { ok: true, value: '' };
  const valueText = readSchemaText(value, field);
  if (!valueText.ok) return valueText;
  try {
    return { ok: true, value: normalizePackageRoot(valueText.value) };
  } catch (error) {
    return schemaFail(
      'workspace.contract.path',
      errorMessage(error, `${field} is not a normalized path.`),
    );
  }
};

const subpath = (value: unknown, field: string): WorkspaceReadResult<string> => {
  const valueText = readSchemaText(value, field);
  if (!valueText.ok) return valueText;
  if (!valueText.value.startsWith('./')) {
    return schemaFail(
      'workspace.contract.subpath',
      `${field} must begin with ./ and remain package-local.`,
    );
  }
  try {
    return { ok: true, value: `./${normalizeRelativePath(valueText.value.slice(2))}` };
  } catch (error) {
    return schemaFail(
      'workspace.contract.subpath',
      errorMessage(error, `${field} is not a subpath.`),
    );
  }
};

export const readOptionalDigest = (
  value: unknown,
  field: string,
  nullable = false,
): WorkspaceReadResult<Sha256Digest | null> => {
  if (nullable && value === null) return { ok: true, value: null };
  if (typeof value !== 'string' || !/^sha256:[0-9a-f]{64}$/u.test(value)) {
    return schemaFail(
      'workspace.contract.digest',
      `${field} must be a lowercase sha256 content address.`,
    );
  }
  return { ok: true, value: value as Sha256Digest };
};

export const readRequiredDigest = (
  value: unknown,
  field: string,
  missingMessage: string,
): WorkspaceReadResult<Sha256Digest> => {
  const parsed = readOptionalDigest(value, field);
  if (!parsed.ok) return parsed;
  return parsed.value === null
    ? schemaFail('workspace.contract.digest', missingMessage)
    : { ok: true, value: parsed.value };
};

export const readContractList = <T>(
  value: unknown,
  field: string,
  reader: (item: unknown) => WorkspaceReadResult<T>,
): WorkspaceReadResult<T[]> => {
  if (!isDenseContractArray(value)) {
    return schemaFail('workspace.contract.array', `${field} must be a dense array.`);
  }
  const items: T[] = [];
  for (const item of value) {
    const parsed = reader(item);
    if (!parsed.ok) return parsed;
    items.push(parsed.value);
  }
  return { ok: true, value: items };
};

export const readContractVersion = (value: unknown, field: string): WorkspaceReadResult<1> =>
  value === ASHFOX_WORKSPACE_VERSION
    ? { ok: true, value: 1 }
    : schemaFail('workspace.contract.version', `${field} must be version 1.`);

export const findDuplicateName = (
  values: readonly string[],
  folded = false,
): string | undefined => {
  const seen = new Set<string>();
  for (const value of values) {
    // Package identities are ASCII. Paths are checked by the authority reader.
    const key = folded ? value.replace(/[A-Z]/gu, (letter) => letter.toLowerCase()) : value;
    if (seen.has(key)) return value;
    seen.add(key);
  }
  return undefined;
};

const readEntry = (value: unknown): WorkspaceReadResult<AssetEntry> => {
  if (!exactSchemaRecord(value, ['name', 'path'])) {
    return schemaFail('workspace.contract.entry', 'Each entry must contain exactly name and path.');
  }
  const name = readIdentifier(value.name, 'entry.name');
  if (!name.ok) return name;
  const path = relativeSourcePath(value.path, 'entry.path');
  if (!path.ok) return path;
  return { ok: true, value: Object.freeze({ name: name.value, path: path.value }) };
};

const readModule = (value: unknown): WorkspaceReadResult<ModuleDeclaration> => {
  if (!exactSchemaRecord(value, ['subpath', 'path'])) {
    return schemaFail(
      'workspace.contract.module',
      'Each module must contain exactly subpath and path.',
    );
  }
  const exposed = subpath(value.subpath, 'module.subpath');
  if (!exposed.ok) return exposed;
  const path = relativeSourcePath(value.path, 'module.path');
  if (!path.ok) return path;
  return { ok: true, value: Object.freeze({ subpath: exposed.value, path: path.value }) };
};

const readDependency = (value: unknown): WorkspaceReadResult<PackageDependency> => {
  if (!exactSchemaRecord(value, ['name'])) {
    return schemaFail(
      'workspace.contract.dependency',
      'Each dependency must contain exactly name.',
    );
  }
  const name = readPackageName(value.name, 'dependency.name');
  if (!name.ok) return name;
  return { ok: true, value: Object.freeze({ name: name.value }) };
};

const checkPackageDuplicates = (
  entries: readonly AssetEntry[],
  modules: readonly ModuleDeclaration[],
  dependencies: readonly PackageDependency[],
): WorkspaceReadResult<never> | undefined => {
  const duplicateEntry = findDuplicateName(entries.map((entry) => entry.name));
  if (duplicateEntry !== undefined) {
    return schemaFail(
      'workspace.contract.duplicate_entry',
      `Duplicate entry name: ${duplicateEntry}.`,
    );
  }
  const duplicateModule = findDuplicateName(modules.map((module) => module.subpath));
  if (duplicateModule !== undefined) {
    return schemaFail(
      'workspace.contract.duplicate_module',
      `Duplicate module subpath: ${duplicateModule}.`,
    );
  }
  const duplicatePath = findDuplicateName([
    ...entries.map((entry) => entry.path),
    ...modules.map((module) => module.path),
  ]);
  if (duplicatePath !== undefined) {
    return schemaFail(
      'workspace.contract.duplicate_source',
      `A source path is declared more than once: ${duplicatePath}.`,
    );
  }
  const duplicateDependency = findDuplicateName(
    dependencies.map((item) => item.name),
    true,
  );
  if (duplicateDependency !== undefined) {
    return schemaFail(
      'workspace.contract.duplicate_dependency',
      `Duplicate package dependency: ${duplicateDependency}.`,
    );
  }
  return undefined;
};

/** Validates and freezes a single package manifest contract. */
export const readPackageManifest = (value: unknown): WorkspaceReadResult<PackageManifest> => {
  if (!exactSchemaRecord(value, ['format', 'version', 'entries', 'modules', 'dependencies'])) {
    return schemaFail(
      'workspace.contract.package_manifest',
      'Package manifests have a closed format/version/entries/modules/dependencies schema.',
    );
  }
  if (value.format !== ASHFOX_PACKAGE_FORMAT) {
    return schemaFail('workspace.contract.format', 'Package manifest format is invalid.');
  }
  const packageVersion = readContractVersion(value.version, 'package.version');
  if (!packageVersion.ok) return packageVersion;
  const entries = readContractList(value.entries, 'package.entries', readEntry);
  if (!entries.ok) return entries;
  const modules = readContractList(value.modules, 'package.modules', readModule);
  if (!modules.ok) return modules;
  const dependencies = readContractList(value.dependencies, 'package.dependencies', readDependency);
  if (!dependencies.ok) return dependencies;
  const dup = checkPackageDuplicates(entries.value, modules.value, dependencies.value);
  if (dup !== undefined) return dup;
  return {
    ok: true,
    value: Object.freeze({
      format: ASHFOX_PACKAGE_FORMAT,
      version: 1,
      entries: Object.freeze(entries.value.sort((a, b) => (a.name < b.name ? -1 : 1))),
      modules: Object.freeze(modules.value.sort((a, b) => (a.subpath < b.subpath ? -1 : 1))),
      dependencies: Object.freeze(dependencies.value.sort((a, b) => (a.name < b.name ? -1 : 1))),
    }),
  };
};

const readWorkspacePackage = (value: unknown): WorkspaceReadResult<WorkspacePackage> => {
  if (!exactSchemaRecord(value, ['name', 'root', 'manifest'])) {
    return schemaFail(
      'workspace.contract.package',
      'Each package must contain exactly name, root, and manifest.',
    );
  }
  const name = readPackageName(value.name, 'package.name');
  if (!name.ok) return name;
  const root = readRootPath(value.root, 'package.root');
  if (!root.ok) return root;
  const manifest = readPackageManifest(value.manifest);
  if (!manifest.ok) return manifest;
  return {
    ok: true,
    value: Object.freeze({ name: name.value, root: root.value, manifest: manifest.value }),
  };
};

/** Validates and freezes a workspace manifest contract. */
export const readWorkspaceManifest = (value: unknown): WorkspaceReadResult<WorkspaceManifest> => {
  if (!exactSchemaRecord(value, ['format', 'version', 'packages'])) {
    return schemaFail(
      'workspace.contract.manifest',
      'Workspace manifests have a closed format/version/packages schema.',
    );
  }
  if (value.format !== ASHFOX_WORKSPACE_FORMAT) {
    return schemaFail('workspace.contract.format', 'Workspace manifest format is invalid.');
  }
  const workspaceVersion = readContractVersion(value.version, 'workspace.version');
  if (!workspaceVersion.ok) return workspaceVersion;
  const packages = readContractList(value.packages, 'workspace.packages', readWorkspacePackage);
  if (!packages.ok) return packages;
  const duplicatePackage = findDuplicateName(
    packages.value.map((pkg) => pkg.name),
    true,
  );
  if (duplicatePackage !== undefined) {
    return schemaFail(
      'workspace.contract.duplicate_package',
      `Duplicate or case-colliding package name: ${duplicatePackage}.`,
    );
  }
  return {
    ok: true,
    value: Object.freeze({
      format: ASHFOX_WORKSPACE_FORMAT,
      version: 1,
      packages: Object.freeze(packages.value.sort((a, b) => (a.name < b.name ? -1 : 1))),
    }),
  };
};
