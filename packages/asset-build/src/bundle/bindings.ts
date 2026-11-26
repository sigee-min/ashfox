import {
  emptyHooksDocument,
  generateBindingsFromDocument,
  parseHooksSource,
  type DirectoryFile,
  type GeneratedBindingFile,
  type HookBindingTarget,
  type HookSchemaDecl,
  type HooksDocument,
} from '@ashfox/engine-core';

/** Generate deterministic multi-engine hook bindings from all schemas declared in workspace sources. */
export const generateWorkspaceHookBindings = (
  files: readonly DirectoryFile[],
  targets: readonly HookBindingTarget[],
): readonly GeneratedBindingFile[] => {
  if (targets.length === 0) return [];
  const schemaMap = new Map<string, HookSchemaDecl>();
  for (const file of files) {
    const parsed = parseHooksSource(file.source, file.path, { allowHostStatements: true });
    for (const schema of parsed.unit.schemas) {
      if (!schemaMap.has(schema.id)) schemaMap.set(schema.id, schema);
    }
  }
  const merged: HooksDocument = {
    ...emptyHooksDocument('ashfox_hooks'),
    schemas: [...schemaMap.values()],
  };
  return targets.map((target) => generateBindingsFromDocument(merged, target));
};
