import type {
  AssetDeclaration,
  AssetDiagnostic,
  AssetGeometryStatement,
} from '../../../project/program/asset/contract';
import type {
  WorkspaceCompilationClosure,
  WorkspaceCompilationFile,
} from '../../../project/workspace/closure';
import type { AssetSymbolId, TypedAssetHir } from './contract';
import { collectDeclRefs, collectFileAliasRefs } from './hygieneWalk';

const diagnostic = (
  path: string,
  declSpan: AssetDiagnostic['span'],
  code: string,
  message: string,
): AssetDiagnostic => Object.freeze({ severity: 'error', path, span: declSpan, code, message });

const importAliasMap = (closure: WorkspaceCompilationClosure): Map<string, Map<string, string>> => {
  const result = new Map<string, Map<string, string>>();
  for (const edge of closure.imports) {
    const aliases = result.get(edge.importer.key) ?? new Map<string, string>();
    aliases.set(edge.alias, edge.target.key);
    result.set(edge.importer.key, aliases);
  }
  return result;
};

const addHirSymbolDeps = (
  symbolKey: string,
  hir: TypedAssetHir,
  enqueue: (sym: AssetSymbolId | undefined) => void,
): void => {
  const asset = hir.assets[symbolKey];
  if (asset) {
    enqueue(asset.skeleton);
    asset.motions.forEach(enqueue);
    for (const u of asset.uses) {
      enqueue(u.component);
      Object.values(u.portBindings).forEach(enqueue);
    }
    return;
  }
  const rig = hir.rigs[symbolKey];
  if (rig) Object.values(rig.sockets).forEach((s) => enqueue(s.contract));
  const comp = hir.components[symbolKey];
  if (comp) comp.ports.forEach((p) => enqueue(p.type));
  enqueue(
    hir.skeletons[symbolKey]?.rig ??
      hir.motions[symbolKey]?.rig ??
      hir.surfaces[symbolKey]?.contract,
  );
};

const enqueueDesignDeps = (
  file: WorkspaceCompilationFile,
  decl: AssetDeclaration,
  importsByFile: ReadonlyMap<string, ReadonlyMap<string, string>>,
  symByModuleDecl: ReadonlyMap<string, string>,
  queue: string[],
  seen: Set<string>,
): void => {
  const fileImports = importsByFile.get(file.identity.key) ?? new Map<string, string>();
  const localDecls = new Set(file.unit.declarations.map((d) => d.id));
  const refs = collectDeclRefs(decl, fileImports, localDecls);
  for (const localName of refs.decls) {
    const key = symByModuleDecl.get(`${file.identity.key}\u0000${localName}`);
    if (key && !seen.has(key)) {
      seen.add(key);
      queue.push(key);
    }
  }
  for (const remote of refs.remoteDecls) {
    const key = symByModuleDecl.get(remote);
    if (key && !seen.has(key)) {
      seen.add(key);
      queue.push(key);
    }
  }
};

const collectReachableSymbols = (
  closure: WorkspaceCompilationClosure,
  hir: TypedAssetHir,
  importsByFile: ReadonlyMap<string, ReadonlyMap<string, string>>,
): ReadonlySet<string> => {
  const declByKey = new Map<string, { file: WorkspaceCompilationFile; decl: AssetDeclaration }>();
  const symByModuleDecl = new Map<string, string>();
  const seen = new Set<string>();
  const queue: string[] = [];
  for (const file of closure.files) {
    for (const decl of file.unit.declarations) {
      const symKey = [file.identity.key, decl.kind, decl.id].join('\u0000');
      declByKey.set(symKey, { file, decl });
      symByModuleDecl.set(`${file.identity.key}\u0000${decl.id}`, symKey);
      if (decl.kind === 'design' && decl.checks.length > 0) {
        seen.add(symKey);
        queue.push(symKey);
      }
    }
  }
  for (const key of Object.keys(hir.assets)) {
    seen.add(key);
    queue.push(key);
  }
  const enqueueSym = (sym: AssetSymbolId | undefined): void => {
    if (sym && !seen.has(sym.key)) {
      seen.add(sym.key);
      queue.push(sym.key);
    }
  };
  while (queue.length > 0) {
    const key = queue.pop()!;
    addHirSymbolDeps(key, hir, enqueueSym);
    const owner = declByKey.get(key);
    if (owner)
      enqueueDesignDeps(owner.file, owner.decl, importsByFile, symByModuleDecl, queue, seen);
  }
  return seen;
};

const checkUnusedImports = (
  closure: WorkspaceCompilationClosure,
  importsByFile: ReadonlyMap<string, ReadonlyMap<string, string>>,
  out: AssetDiagnostic[],
): void => {
  for (const file of closure.files) {
    const fileImports = importsByFile.get(file.identity.key) ?? new Map<string, string>();
    const used = collectFileAliasRefs(file, fileImports);
    for (const imp of file.unit.imports) {
      if (used.has(imp.alias)) continue;
      out.push(
        diagnostic(
          file.identity.path,
          imp.span,
          'asset.unused-import',
          `Import alias "${imp.alias}" ("${imp.path}") is unused; remove it or reference an exported declaration.`,
        ),
      );
    }
  }
};

const checkUnusedDeclarations = (
  closure: WorkspaceCompilationClosure,
  reachable: ReadonlySet<string>,
  out: AssetDiagnostic[],
): void => {
  for (const file of closure.files) {
    const isRoot = file.identity.key === closure.root.identity.key;
    for (const decl of file.unit.declarations) {
      const symKey = [file.identity.key, decl.kind, decl.id].join('\u0000');
      if (reachable.has(symKey)) continue;
      if (isRoot && decl.kind !== 'asset') {
        out.push(
          diagnostic(
            file.identity.path,
            decl.span,
            'asset.unused-declaration',
            `Declaration "${decl.id}" in asset entry "${file.identity.path}" is unused; remove it or move reusable declarations into a module.`,
          ),
        );
      } else if (!isRoot && !decl.exported) {
        out.push(
          diagnostic(
            file.identity.path,
            decl.span,
            'asset.unused-declaration',
            `Private declaration "${decl.id}" in module "${file.identity.path}" is unused; remove it or export it for reuse.`,
          ),
        );
      }
    }
  }
};

const countGeometryPrimitives = (stmts: readonly AssetGeometryStatement[]): number => {
  let count = 0;
  for (const stmt of stmts) {
    if (stmt.kind !== 'geometry-block') continue;
    if (stmt.keyword === 'cube' || stmt.keyword === 'plane') count += 1;
    count += countGeometryPrimitives(stmt.statements);
  }
  return count;
};

const countConcerns = (decls: readonly AssetDeclaration[]) => {
  let hasRig = false;
  let hasSurface = false;
  let hasComponent = false;
  let primitives = 0;
  for (const decl of decls) {
    if (
      decl.kind === 'rig-contract' ||
      decl.kind === 'skeleton' ||
      decl.kind === 'motion' ||
      decl.kind === 'socket-contract'
    )
      hasRig = true;
    else if (decl.kind === 'surface' || decl.kind === 'surface-contract') hasSurface = true;
    else if (decl.kind === 'component') {
      hasComponent = true;
      primitives += countGeometryPrimitives(decl.geometry.statements);
    }
  }
  const inlineConcerns = (hasRig ? 1 : 0) + (hasSurface ? 1 : 0) + (hasComponent ? 1 : 0);
  return { hasRig, hasSurface, hasComponent, inlineConcerns, primitives };
};

const checkModularity = (
  closure: WorkspaceCompilationClosure,
  hir: TypedAssetHir,
  out: AssetDiagnostic[],
): void => {
  const rootAsset = Object.values(hir.assets)[0];
  const profile = rootAsset?.settings.profile ?? null;
  for (const file of closure.files) {
    const info = countConcerns(file.unit.declarations);
    if (file.identity.key === closure.root.identity.key) {
      const nonEmptyLines = file.source.split(/\r?\n/u).filter((l) => l.trim().length > 0).length;
      const bloated = nonEmptyLines > 220 && info.inlineConcerns >= 2;
      const crowdedCreature =
        profile === 'creature' && info.hasSurface && info.hasComponent && info.primitives >= 20;
      if (bloated || crowdedCreature) {
        out.push(
          diagnostic(
            file.identity.path,
            file.unit.span,
            'asset.monolithic-entry',
            `Asset entry "${file.identity.path}" mixes multiple concerns inline (${nonEmptyLines} non-empty lines, ${info.primitives} primitives). Extract reusable rig, surface, and component declarations into module files and import them.`,
          ),
        );
      }
      continue;
    }
    const hasConcreteSurface = file.unit.declarations.some((d) => d.kind === 'surface');
    if (info.hasRig && hasConcreteSurface && info.hasComponent) {
      out.push(
        diagnostic(
          file.identity.path,
          file.unit.span,
          'asset.mixed-module-concerns',
          `Module "${file.identity.path}" mixes rig/motion, concrete surface, and geometry component declarations. Split them into focused reusable modules.`,
        ),
      );
    }
  }
};

/** Enforce compile-time codebase hygiene: no dead imports/declarations and clean module separation. */
export const checkAssetHygiene = (
  closure: WorkspaceCompilationClosure,
  hir: TypedAssetHir,
): readonly AssetDiagnostic[] => {
  const out: AssetDiagnostic[] = [];
  const importsByFile = importAliasMap(closure);
  const reachable = collectReachableSymbols(closure, hir, importsByFile);
  checkUnusedImports(closure, importsByFile, out);
  checkUnusedDeclarations(closure, reachable, out);
  checkModularity(closure, hir, out);
  return out;
};
