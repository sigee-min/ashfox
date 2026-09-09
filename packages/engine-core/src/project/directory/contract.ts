import type { DirectoryPack } from './pack';
import type { WorkspacePackage, WorkspaceEntrySelector } from '../workspace';
export type DirectoryExport = Readonly<{
  name: string; entry: WorkspaceEntrySelector; directory: string;
}> & (
  Readonly<{ format: 'png' | 'wav' }> |
  Readonly<{ format: 'glb'; encoding?: 'portable' | 'optimized' }> |
  Readonly<{ format: 'java_block' | 'geckolib5' | 'bedrock'; namespace: string; modelPath: string }>
);
/** Root configuration only. Sources are sibling files; products are never input. */
export interface DirectoryWorkspace {
  readonly format: 'ashfox-workspace'; readonly version: 2;
  readonly name: string;
  readonly packages: readonly WorkspacePackage[];
  readonly include: readonly string[]; readonly ignore: readonly string[];
  readonly build: { readonly directory: string };
  readonly exports: readonly DirectoryExport[];
  readonly packs?: readonly DirectoryPack[];
}
export interface DirectoryFile { readonly path: string; readonly source: string }
