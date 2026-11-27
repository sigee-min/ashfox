import { isStdLibraryLogicalPath } from '../project/stdlib/resolve';
import { compareText } from '../stableOrder';
import type { HookDiagnostic, HookSourceSpan, HookSourceUnit } from './contract';
import {
  analyzeModularityFile,
  hookGuardDiag,
  normalizeWorkspacePath,
  type BlockRec,
  type FileFacts,
  type SchemaRec,
} from './modularityScan';

export { normalizeWorkspacePath };
export type BoilerplateBlockKind = string;

export interface ModularityFileInput {
  readonly path: string;
  readonly source: string;
  readonly parsedUnit?: HookSourceUnit;
}

export interface ModularityGuardOptions {
  readonly minBoilerplateTokens?: number;
  readonly duplicateSeverity?: 'error' | 'warning';
  readonly unusedSeverity?: 'error' | 'warning';
  readonly ignoreUnreferencedModuleExportsWhenNoEntries?: boolean;
}

export interface BoilerplateOccurrence {
  readonly file: string;
  readonly kind: BoilerplateBlockKind;
  readonly id: string;
  readonly line: number;
  readonly column: number;
  readonly span: HookSourceSpan;
}

export interface DuplicateBoilerplateGroup {
  readonly hash: string;
  readonly kind: BoilerplateBlockKind;
  readonly occurrences: readonly BoilerplateOccurrence[];
}

export interface ModularityGuardResult {
  readonly ok: boolean;
  readonly diagnostics: readonly HookDiagnostic[];
  readonly duplicateGroups: readonly DuplicateBoilerplateGroup[];
  readonly summary: Readonly<{
    readonly filesScanned: number;
    readonly errorCount: number;
    readonly warningCount: number;
    readonly duplicateGroupCount: number;
  }>;
}

const addOcc = (
  buckets: Map<string, { kind: string; items: BoilerplateOccurrence[] }>,
  file: string,
  b: BlockRec,
): void => {
  const entry = buckets.get(b.hash) ?? { kind: b.kind, items: [] };
  const s = b.span.start;
  entry.items.push({ file, kind: b.kind, id: b.id, line: s.line, column: s.column, span: b.span });
  buckets.set(b.hash, entry);
};

const inferStdDomain = (file: string, blockKind: string): string => {
  if (
    file.includes('/models/') ||
    /^(?:surface|component|bone|motion|rig|skeleton)$/u.test(blockKind)
  ) {
    return 'model';
  }
  if (file.includes('/sprites/') || /^(?:mask|material|stamp)$/u.test(blockKind)) return 'sprite';
  if (file.includes('/sounds/') || /^(?:voice|seq|sequence)$/u.test(blockKind)) return 'sound';
  if (file.includes('/structures/') || /^(?:prefab|floor|room|facade)$/u.test(blockKind)) {
    return 'structure';
  }
  if (file.includes('/vfx/') || /^(?:element|emitter|palette)$/u.test(blockKind)) return 'vfx';
  return 'core';
};

const collectDuplicates = (
  facts: readonly FileFacts[],
  minTokens: number,
  sev: 'error' | 'warning',
) => {
  const buckets = new Map<string, { kind: string; items: BoilerplateOccurrence[] }>();
  for (const f of facts) {
    for (const b of f.blocks) if (b.count >= minTokens) addOcc(buckets, f.file, b);
  }
  const diagnostics: HookDiagnostic[] = [];
  const groups: DuplicateBoilerplateGroup[] = [];
  for (const [hash, bucket] of [...buckets.entries()].sort((a, b) => compareText(a[0], b[0]))) {
    const distinct = new Set(bucket.items.map((item) => item.file));
    if (distinct.size < 2) continue;
    const ordered = [...bucket.items].sort(
      (a, b) => compareText(a.file, b.file) || a.line - b.line || a.column - b.column,
    );
    const userItems = ordered.filter((item) => !isStdLibraryLogicalPath(item.file));
    if (userItems.length === 0) continue;
    groups.push(Object.freeze({ hash, kind: bucket.kind, occurrences: Object.freeze(ordered) }));
    const peers = [...distinct].sort(compareText).join(', ');
    for (const o of userItems) {
      const domain = inferStdDomain(o.file, o.kind);
      const hint = `Run 'ashfox library std list ${domain}' to reuse an existing standard module.`;
      const msg = `Duplicate inline ${o.kind} block (${hash.slice(0, 15)}) across files (${peers}); extract into a shared module and import it. Hint: ashfox library std list ${domain}.`;
      diagnostics.push(
        hookGuardDiag(
          sev,
          'modular.duplicate-boilerplate',
          msg,
          `${o.file}#${o.kind}:${o.id}`,
          o.span,
          hint,
        ),
      );
    }
  }
  return { diagnostics, groups };
};

const isSchemaUsed = (owner: FileFacts, s: SchemaRec, facts: readonly FileFacts[]): boolean => {
  if (owner.localRefs.has(s.name)) return true;
  const qual = s.ns ? `${s.ns}.${s.name}` : s.name;
  return (
    owner.qualRefs.has(qual) ||
    facts.some(
      (c) =>
        c.qualRefs.has(qual) ||
        c.imports.some((i) => i.resolved === owner.file && c.qualRefs.has(`${i.alias}.${s.name}`)),
    )
  );
};

const fileHygiene = (
  f: FileFacts,
  facts: readonly FileFacts[],
  sev: 'error' | 'warning',
  checkUnused: boolean,
): readonly HookDiagnostic[] => {
  const out: HookDiagnostic[] = [];
  const isStdLib = isStdLibraryLogicalPath(f.file);
  for (const s of f.schemas) {
    if (s.inline) {
      const m = `Inline schema "${s.name}" is forbidden in ${f.unitKind} file "${f.file}"; move it to a module with "export schema" and import it.`;
      out.push(
        hookGuardDiag(
          'error',
          'hooks.inline-schema-forbidden',
          m,
          `${f.file}#schema:${s.name}`,
          s.span,
        ),
      );
    } else if (checkUnused && !isStdLib && !isSchemaUsed(f, s, facts)) {
      const q = s.ns ? `${s.ns}.${s.name}` : s.name;
      out.push(
        hookGuardDiag(
          sev,
          'modular.unused-schema',
          `Unused schema "${q}" declared in "${f.file}".`,
          `${f.file}#schema:${q}`,
          s.span,
        ),
      );
    }
  }
  for (const i of f.imports) {
    if (!f.usedAliases.has(i.alias)) {
      out.push(
        hookGuardDiag(
          sev,
          'modular.unused-import',
          `Unused import "${i.path}" (alias "${i.alias}") in "${f.file}".`,
          `${f.file}#import:${i.alias}`,
          i.span,
        ),
      );
    }
  }
  return out;
};

const cmpDiag = (a: HookDiagnostic, b: HookDiagnostic): number =>
  compareText(a.file, b.file) ||
  a.line - b.line ||
  a.column - b.column ||
  compareText(a.code, b.code);

export const checkWorkspaceModularity = (
  files: readonly ModularityFileInput[],
  options?: ModularityGuardOptions,
): ModularityGuardResult => {
  const known = new Set(files.map((f) => normalizeWorkspacePath(f.path)));
  const facts = files.map((file) => analyzeModularityFile(file, known));
  const dup = collectDuplicates(
    facts,
    options?.minBoilerplateTokens ?? 10,
    options?.duplicateSeverity ?? 'error',
  );
  const checkSchemas =
    !(options?.ignoreUnreferencedModuleExportsWhenNoEntries ?? false) ||
    facts.some((f) => f.unitKind !== 'module');
  const hygiene = facts.flatMap((f) =>
    fileHygiene(f, facts, options?.unusedSeverity ?? 'warning', checkSchemas),
  );
  const diagnostics = Object.freeze([...dup.diagnostics, ...hygiene].sort(cmpDiag));
  const errorCount = diagnostics.filter((d) => d.severity === 'error').length;
  return Object.freeze({
    ok: errorCount === 0,
    diagnostics,
    duplicateGroups: Object.freeze(dup.groups),
    summary: Object.freeze({
      filesScanned: facts.length,
      errorCount,
      warningCount: diagnostics.length - errorCount,
      duplicateGroupCount: dup.groups.length,
    }),
  });
};
