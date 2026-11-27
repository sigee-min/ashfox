import { isVirtualLibrarySpecifier, virtualLibraryLogicalPath } from '../project/stdlib/resolve';
import { compareText } from '../stableOrder';
import type { SceneNode } from '../model/scene';
import {
  HOOKS_DOCUMENT_SCHEMA_VERSION,
  type HookBoneTransform,
  type HookDiagnostic,
  type HooksDocument,
  type HookSourceUnit,
  type HookTransformContext,
} from './contract';
import { normalizeWorkspacePath } from './modularityGuard';
import { parseHooksSource } from './parse';
import { propagateHooksTransforms } from './transform';
import { validateHooksUnit } from './validate';

export interface WorkspaceHookFile {
  readonly path: string;
  readonly source: string;
}

export interface CompiledWorkspaceHooksResult {
  readonly ok: boolean;
  readonly unit: HookSourceUnit;
  readonly document: HooksDocument;
  readonly referencedPaths: readonly string[];
  readonly usedAliasesByFile: ReadonlyMap<string, ReadonlySet<string>>;
  readonly diagnostics: readonly HookDiagnostic[];
}

const resolveRelativeHookPath = (ownerPath: string, specifier: string): string => {
  const dir = ownerPath.includes('/') ? ownerPath.slice(0, ownerPath.lastIndexOf('/')) : '';
  return normalizeWorkspacePath(dir ? `${dir}/${specifier}` : specifier);
};

const resolveHookImportTarget = (
  ownerPath: string,
  specifier: string,
  moduleAliases?: ReadonlyMap<string, string>,
): string => {
  if (isVirtualLibrarySpecifier(specifier)) return virtualLibraryLogicalPath(specifier);
  if (!specifier.startsWith('.') && moduleAliases?.has(specifier)) {
    return normalizeWorkspacePath(moduleAliases.get(specifier)!);
  }
  return resolveRelativeHookPath(ownerPath, specifier);
};

/** Build a canonical empty `HooksDocument` for an asset without declared hooks or schemas. */
export const emptyHooksDocument = (assetId: string): HooksDocument =>
  Object.freeze({
    schemaVersion: HOOKS_DOCUMENT_SCHEMA_VERSION,
    assetId,
    schemas: Object.freeze([]),
    anchors: Object.freeze([]),
    volumes: Object.freeze([]),
    cues: Object.freeze([]),
    meta: Object.freeze([]),
    zones: Object.freeze([]),
  });

/** Returns true when a compiled hooks document contains any emitted hook items, schemas, or colliders. */
export const hasHooksContent = (doc: HooksDocument | undefined): boolean =>
  Boolean(
    doc &&
    (doc.schemas.length > 0 ||
      doc.anchors.length > 0 ||
      doc.volumes.length > 0 ||
      doc.cues.length > 0 ||
      doc.meta.length > 0 ||
      doc.zones.length > 0 ||
      doc.damageState !== undefined ||
      (doc.colliders && doc.colliders.colliders.length > 0)),
  );

/** Collect import aliases referenced by schema prefixes or `asset` field values in a unit. */
export const collectUsedHookAliases = (unit: HookSourceUnit): ReadonlySet<string> => {
  const aliases = new Set(unit.imports.map((imp) => imp.alias));
  const used = new Set<string>();
  const recordQual = (raw?: string): void => {
    if (!raw || !raw.includes('.')) return;
    const prefix = raw.slice(0, raw.indexOf('.'));
    if (aliases.has(prefix)) used.add(prefix);
  };
  for (const decl of [
    ...unit.anchors,
    ...unit.volumes,
    ...unit.cues,
    ...unit.meta,
    ...unit.zones,
  ]) {
    recordQual(decl.schema);
    for (const prop of decl.props) {
      if (prop.value.kind === 'ref') {
        const val = prop.value.value;
        if (aliases.has(val)) used.add(val);
        recordQual(val);
      }
    }
  }
  return used;
};

const collectUnitClosure = (
  filePath: string,
  filesByPath: ReadonlyMap<string, WorkspaceHookFile>,
  unitsByPath: Map<string, HookSourceUnit>,
  parseDiags: HookDiagnostic[],
  visiting: Set<string>,
  moduleAliases?: ReadonlyMap<string, string>,
): void => {
  if (unitsByPath.has(filePath) || visiting.has(filePath)) return;
  const file = filesByPath.get(filePath);
  if (!file) return;
  visiting.add(filePath);
  const parsed = parseHooksSource(file.source, filePath, { allowHostStatements: true });
  parseDiags.push(...parsed.diagnostics);
  unitsByPath.set(filePath, parsed.unit);
  for (const imp of parsed.unit.imports) {
    collectUnitClosure(
      resolveHookImportTarget(filePath, imp.path, moduleAliases),
      filesByPath,
      unitsByPath,
      parseDiags,
      visiting,
      moduleAliases,
    );
  }
  visiting.delete(filePath);
};

const buildImportedUnitsForEntry = (
  entryUnit: HookSourceUnit,
  entryPath: string,
  unitsByPath: ReadonlyMap<string, HookSourceUnit>,
  moduleAliases?: ReadonlyMap<string, string>,
): Readonly<Record<string, HookSourceUnit>> => {
  const imported: Record<string, HookSourceUnit> = {};
  for (const [ownerPath, ownerUnit] of unitsByPath) {
    for (const imp of ownerUnit.imports) {
      const targetPath = resolveHookImportTarget(ownerPath, imp.path, moduleAliases);
      const targetUnit = unitsByPath.get(targetPath);
      if (targetUnit) imported[imp.path] = targetUnit;
    }
  }
  for (const imp of entryUnit.imports) {
    const targetPath = resolveHookImportTarget(entryPath, imp.path, moduleAliases);
    const targetUnit = unitsByPath.get(targetPath);
    if (targetUnit) imported[imp.path] = targetUnit;
  }
  return imported;
};

const boneWorldOrigin = (node: SceneNode): [number, number, number] => [
  node.transform.pivot[0] + node.transform.position[0],
  node.transform.pivot[1] + node.transform.position[1],
  node.transform.pivot[2] + node.transform.position[2],
];

/** Build a `HookTransformContext` with bone hierarchy transforms from compiled scene nodes. */
export const buildHooksBoneContext = (
  nodes: Readonly<Record<string, SceneNode>>,
): HookTransformContext => {
  const bones: Record<string, HookBoneTransform> = {};
  for (const node of Object.values(nodes)) {
    if (node.kind !== 'bone') continue;
    const origin = boneWorldOrigin(node);
    const parent = node.parentId ? nodes[node.parentId] : undefined;
    const parentOrigin = parent?.kind === 'bone' ? boneWorldOrigin(parent) : [0, 0, 0];
    bones[node.id] = {
      id: node.id,
      ...(node.parentId ? { parentId: node.parentId } : {}),
      translation: [
        origin[0] - parentOrigin[0]!,
        origin[1] - parentOrigin[1]!,
        origin[2] - parentOrigin[2]!,
      ],
      rotation: node.transform.rotation,
      scale: node.transform.scale,
    };
  }
  return { bones };
};

const parentIdsFromContext = (context?: HookTransformContext) =>
  context
    ? {
        ...(context.bones ? { bones: Object.keys(context.bones) } : {}),
        ...(context.rooms ? { rooms: Object.keys(context.rooms) } : {}),
        ...(context.floors ? { floors: Object.keys(context.floors) } : {}),
      }
    : undefined;

/**
 * Parse, validate against imported schema modules, and transform hooks for a workspace asset file.
 */
export const compileHooksForWorkspaceFile = (
  entryPath: string,
  filesByPath: ReadonlyMap<string, WorkspaceHookFile>,
  context?: HookTransformContext,
  moduleAliases?: ReadonlyMap<string, string>,
): CompiledWorkspaceHooksResult => {
  const normalizedEntry = normalizeWorkspacePath(entryPath);
  const unitsByPath = new Map<string, HookSourceUnit>();
  const parseDiags: HookDiagnostic[] = [];
  collectUnitClosure(
    normalizedEntry,
    filesByPath,
    unitsByPath,
    parseDiags,
    new Set(),
    moduleAliases,
  );
  const unit =
    unitsByPath.get(normalizedEntry) ??
    parseHooksSource('', normalizedEntry, { allowHostStatements: true }).unit;
  const importedUnits = buildImportedUnitsForEntry(
    unit,
    normalizedEntry,
    unitsByPath,
    moduleAliases,
  );
  const validated = validateHooksUnit(unit, {
    importedUnits,
    validParentIds: parentIdsFromContext(context),
  });
  const document = context
    ? propagateHooksTransforms(validated.document, context)
    : validated.document;
  const usedAliasesByFile = new Map<string, ReadonlySet<string>>();
  for (const [filePath, loaded] of unitsByPath) {
    usedAliasesByFile.set(filePath, collectUsedHookAliases(loaded));
  }
  const diagnostics = [...parseDiags, ...validated.diagnostics];
  return Object.freeze({
    ok: diagnostics.length === 0,
    unit,
    document,
    referencedPaths: Object.freeze([...unitsByPath.keys()].sort(compareText)),
    usedAliasesByFile,
    diagnostics: Object.freeze(diagnostics),
  });
};
