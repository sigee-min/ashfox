import { deepFreeze } from '../../../immutable';
import type { AssetDiagnostic } from '../../../project/program/asset/contract';
import type { SourceSpan } from '../../../project/source/contract';
import {
  errorDiagnostic,
  sortWorkspaceDiagnostics,
  type SourceRef,
  type WorkspaceDiagnostic,
} from '../../../project/workspace/diagnostic';
import type { WorkspaceEntryCompilation } from '../../../project/workspace/graph';

export type CompileAssetWorkspaceFailure = Readonly<{
  readonly ok: false;
  readonly diagnostics: readonly WorkspaceDiagnostic[];
}>;

export interface RootLocation {
  readonly packageName: string;
  readonly path: string;
  readonly span: SourceSpan;
}

const sourceRef = (packageName: string, path: string, span: SourceSpan): SourceRef =>
  Object.freeze({
    packageName,
    path,
    start: Object.freeze({ ...span.start }),
    end: Object.freeze({ ...span.end }),
  });

/** Freeze and stably sort workspace diagnostics into a fail-closed result. */
export const failWithDiagnostics = (
  diagnostics: readonly WorkspaceDiagnostic[],
): CompileAssetWorkspaceFailure =>
  deepFreeze({
    ok: false as const,
    diagnostics: sortWorkspaceDiagnostics(diagnostics),
  });

const packageForPath = (
  files: readonly Readonly<{
    readonly identity: Readonly<{
      readonly packageName: string;
      readonly path: string;
    }>;
  }>[],
  path: string,
  fallback: string,
): string => files.find((file) => file.identity.path === path)?.identity.packageName ?? fallback;

/** Map asset-stage diagnostics to workspace diagnostics with resolved package identities. */
export const mapWorkspaceDiagnostics = (
  diagnostics: readonly AssetDiagnostic[],
  files: readonly Readonly<{
    readonly identity: Readonly<{
      readonly packageName: string;
      readonly path: string;
    }>;
  }>[],
  fallbackPackage: string,
): readonly WorkspaceDiagnostic[] =>
  diagnostics.map((item) =>
    Object.freeze({
      severity: 'error' as const,
      code: item.code,
      message: item.message,
      ...(item.hint !== undefined ? { hint: item.hint } : {}),
      source: sourceRef(packageForPath(files, item.path, fallbackPackage), item.path, item.span),
    }),
  );

/** Construct one error diagnostic anchored at the compiled entry root location. */
export const rootDiagnostic = (
  location: RootLocation,
  code: string,
  message: string,
): WorkspaceDiagnostic =>
  errorDiagnostic(code, message, sourceRef(location.packageName, location.path, location.span));

/** Extract the root file location of a resolved compilation closure. */
export const rootLocationOf = (closure: WorkspaceEntryCompilation['closure']): RootLocation => ({
  packageName: closure.root.identity.packageName,
  path: closure.root.identity.path,
  span: closure.root.unit.span,
});

/** Construct the fallback diagnostic when canonical geometry lowering returns null. */
export const geometryFailureDiagnostic = (location: RootLocation): AssetDiagnostic =>
  Object.freeze({
    severity: 'error',
    path: location.path,
    span: location.span,
    code: 'asset.canonical-geometry',
    message: 'Canonical geometry lowering failed closed.',
  });
