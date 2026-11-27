import { compareText, encodeUtf8 } from '@ashfox/internal-contracts';
import {
  compileDirectoryWorkspace,
  type HookBindingTarget,
  type SdkTarget,
} from '@ashfox/engine-core';
import { compilePack, type PackEncoder } from '../packs/compile';
import { digest, json } from '../shared/digest';
import { safeRelative } from '../shared/path';
import { generateWorkspaceHookBindings } from './bindings';
import { generateBundleRuntimeSdk, normalizeSdkTargets } from './sdk';
import {
  BuildFailure,
  type Artifact,
  type AssetMetadata,
  type CatalogAsset,
  type CompiledBundle,
  type Snapshot,
} from './contract';
import type { OpenedProject, ProductByKind } from './delivery/contract';
import { openModelProject } from './delivery/model';
import { buildProductMetadata, deliverProductTarget } from './delivery/registry';

export const checkSnapshot = (snapshot: Snapshot) => {
  const compiled = compileDirectoryWorkspace(snapshot.configuration, snapshot.files);
  if (!compiled.ok) {
    const first = compiled.diagnostics[0];
    throw new BuildFailure(
      first?.code ?? 'workspace.compile',
      first?.message ?? JSON.stringify(compiled.diagnostics),
      1,
      compiled.diagnostics.map((d) => ({ severity: 'error' as const, ...d })),
      first?.hint,
    );
  }
  return compiled;
};

type CheckedWorkspace = ReturnType<typeof checkSnapshot>;
type CompiledProduct = CheckedWorkspace['products'][number];
type ExportTarget = CheckedWorkspace['config']['exports'][number];
type PackConfig = NonNullable<CheckedWorkspace['config']['packs']>[number];

const entryKey = (entry: { readonly packageName: string; readonly entryName: string }): string =>
  JSON.stringify([entry.packageName, entry.entryName]);

const openTargetProject = (
  product: ProductByKind['model'],
  buildKey: string,
  key: string,
  projects: Map<string, OpenedProject>,
  remaining: Map<string, number>,
): OpenedProject => {
  const cached = projects.get(key);
  if (cached) return cached;
  const opened = openModelProject(product, buildKey);
  if ((remaining.get(key) ?? 0) > 1) projects.set(key, opened);
  return opened;
};

const compileExportTarget = async (
  target: ExportTarget,
  compiled: CheckedWorkspace,
  products: Map<string, CompiledProduct>,
  projects: Map<string, OpenedProject>,
  remaining: Map<string, number>,
  artifacts: Artifact[],
): Promise<CatalogAsset> => {
  const key = entryKey(target.entry);
  const product = products.get(key);
  if (!product) throw new BuildFailure('export.entry', target.name);
  const delivered = await deliverProductTarget(target, product, {
    buildKey: compiled.buildKey,
    resolveModelProject: (modelProduct) =>
      openTargetProject(modelProduct, compiled.buildKey, key, projects, remaining),
  });
  const uses = remaining.get(key)! - 1;
  remaining.set(key, uses);
  if (uses === 0) projects.delete(key);
  const records = delivered.files
    .map((file) => {
      if (!safeRelative(file.path)) throw new BuildFailure('export.path', file.path);
      const relative = `assets/${target.name}/${file.path}`;
      artifacts.push({ path: relative, bytes: file.bytes });
      return { path: relative, sha256: digest(file.bytes), byteLength: file.bytes.length };
    })
    .sort((a, b) => compareText(a.path, b.path));
  return {
    id: target.name,
    kind: product.kind,
    directory: target.directory,
    files: records,
    metadata: buildProductMetadata(product, delivered.performance),
  };
};

const compilePackTarget = async (
  pack: PackConfig,
  assets: CatalogAsset[],
  artifacts: Artifact[],
  encoder?: PackEncoder,
): Promise<CatalogAsset> => {
  const files = await compilePack(pack, assets, artifacts, encoder);
  const records = files
    .map((file) => {
      const relative = `assets/${pack.name}/${file.path}`;
      artifacts.push({ path: relative, bytes: file.bytes });
      return { path: relative, sha256: digest(file.bytes), byteLength: file.bytes.length };
    })
    .sort((a, b) => compareText(a.path, b.path));
  const metadata: AssetMetadata =
    pack.format === 'minecraft_java'
      ? {
          minecraftVersion: pack.minecraftVersion,
          resourceRoot: 'resource-pack',
          archive: pack.archive ? `${pack.name}.zip` : null,
        }
      : {
          resourceRoot: 'game-assets',
          manifest: 'assets.json',
          archive: pack.archive ? `${pack.name}.zip` : null,
        };
  return { id: pack.name, kind: 'pack', directory: pack.directory, files: records, metadata };
};

const buildBundleReceipt = (
  compiled: CheckedWorkspace,
  effectiveToolchain: string,
  catalogBytes: Uint8Array,
  artifacts: Artifact[],
) => ({
  format: 'ashfox-build-receipt' as const,
  version: 1 as const,
  sourceHash: compiled.sourceHash,
  requestKey: digest(json({ buildKey: compiled.buildKey, toolchain: effectiveToolchain })),
  toolchain: effectiveToolchain,
  catalogHash: digest(catalogBytes),
  files: artifacts.map((file) => ({
    path: file.path,
    sha256: digest(file.bytes),
    byteLength: file.bytes.length,
  })),
});

const buildBundleExtras = (
  snapshot: Snapshot,
  catalog: CompiledBundle['catalog'],
  artifacts: readonly Artifact[],
  bindingsTargets?: readonly HookBindingTarget[],
  sdkTargets?: readonly SdkTarget[],
) => {
  const bindings =
    bindingsTargets && bindingsTargets.length > 0
      ? generateWorkspaceHookBindings(snapshot.files, bindingsTargets)
      : undefined;
  const effectiveSdk = normalizeSdkTargets([...(snapshot.config.sdk ?? []), ...(sdkTargets ?? [])]);
  const sdk =
    effectiveSdk.length > 0
      ? generateBundleRuntimeSdk(snapshot.config.name, catalog, artifacts, effectiveSdk)
      : undefined;
  return {
    ...(bindings && bindings.length > 0 ? { bindings } : {}),
    ...(sdk && sdk.length > 0 ? { sdk } : {}),
  };
};

export const compileBundle = async (
  snapshot: Snapshot,
  toolchain: string,
  encoder?: PackEncoder,
  checked = checkSnapshot(snapshot),
  bindingsTargets?: readonly HookBindingTarget[],
  sdkTargets?: readonly SdkTarget[],
): Promise<CompiledBundle> => {
  const compiled = checked;
  const artifacts: Artifact[] = [];
  const assets: CatalogAsset[] = [];
  const products = new Map(compiled.products.map((product) => [entryKey(product.entry), product]));
  const remaining = new Map<string, number>();
  for (const target of compiled.config.exports) {
    const key = entryKey(target.entry);
    remaining.set(key, (remaining.get(key) ?? 0) + 1);
  }
  const projects = new Map<string, OpenedProject>();
  for (const target of [...compiled.config.exports].sort((a, b) => compareText(a.name, b.name))) {
    assets.push(
      await compileExportTarget(target, compiled, products, projects, remaining, artifacts),
    );
  }
  for (const pack of [...(compiled.config.packs ?? [])].sort((a, b) =>
    compareText(a.name, b.name),
  )) {
    assets.push(await compilePackTarget(pack, assets, artifacts, encoder));
  }
  const effectiveToolchain = encoder
    ? json({ compiler: toolchain, vorbis: encoder.fingerprint })
    : toolchain;
  const catalog = { format: 'ashfox-catalog' as const, version: 1 as const, assets };
  const catalogBytes = encodeUtf8(json(catalog));
  artifacts.push({ path: 'catalog.json', bytes: catalogBytes });
  artifacts.sort((a, b) => compareText(a.path, b.path));
  if (new Set(artifacts.map((file) => file.path.toLowerCase())).size !== artifacts.length) {
    throw new BuildFailure('export.collision', 'Duplicate output path');
  }
  const receipt = buildBundleReceipt(compiled, effectiveToolchain, catalogBytes, artifacts);
  return {
    receipt,
    catalog,
    artifacts,
    bundleHash: digest('ashfox-bundle:1\n' + json(receipt)),
    ...buildBundleExtras(snapshot, catalog, artifacts, bindingsTargets, sdkTargets),
  };
};
