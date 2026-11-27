import type { VirtualModuleDescription } from '@ashfox/engine-core';

export interface LibraryModuleSummary {
  readonly module: string;
  readonly specifier: string;
  readonly domain: string;
  readonly category: string;
  readonly unitId: string;
  readonly exports: readonly string[];
  readonly params: readonly string[];
}

export interface LibraryNamespaceSummary {
  readonly namespace: string;
  readonly moduleCount: number;
  readonly domains: readonly string[];
}

export const toModuleSummary = (desc: VirtualModuleDescription): LibraryModuleSummary => ({
  module: desc.id,
  specifier: desc.specifier,
  domain: desc.domain,
  category: desc.category,
  unitId: desc.unitId,
  exports: desc.exports.map((e) => e.name),
  params: desc.params.map((p) => p.name),
});

export const formatNamespacesText = (namespaces: readonly LibraryNamespaceSummary[]): string => {
  const lines = [
    'Ashfox Standard Libraries:',
    '',
    ...namespaces.map(
      (ns) =>
        `  ${ns.namespace.padEnd(8)} ${String(ns.moduleCount).padStart(3)} modules  (${ns.domains.join(', ')})`,
    ),
    '',
    'Run: ashfox library std list [prefix] [--json]',
    '',
  ];
  return lines.join('\n');
};

export const formatModuleListText = (
  namespace: string,
  modules: readonly LibraryModuleSummary[],
): string => {
  if (modules.length === 0) {
    return `No modules found in namespace "${namespace}".\n`;
  }
  const width = Math.max(...modules.map((m) => m.module.length), 16);
  const lines = [
    `Ashfox Library "${namespace}" (${modules.length} modules):`,
    '',
    ...modules.map((m) => {
      const meta = m.exports.length > 0 ? `exports: ${m.exports.join(', ')}` : 'module';
      return `  ${m.module.padEnd(width + 2)}${meta}`;
    }),
    '',
    `Run: ashfox library ${namespace} show <module> | eject <module>`,
    '',
  ];
  return lines.join('\n');
};
