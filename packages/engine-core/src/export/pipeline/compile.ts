import type { AssetProject } from '../../project/asset';
import {
  adaptProjectForExport,
  type ExportAdaptedDocument,
  type ExportAdapterInput,
} from '../adapter';
import { exportMinecraftBedrock } from '../targets/bedrock/exporter';
import { exportGeckoLib5 } from '../targets/geckolib5/exporter';
import {
  exportGltf,
  exportGltfResolved,
  type GltfResolvedExportOptions,
} from '../targets/gltf/exporter';
import { exportMinecraftJavaBlock } from '../targets/javaBlock/exporter';
import type { ExportBundle } from '../contract';
import { verifyExportBundleLineage } from './bundle';
import { assertExportBundleMatchesPreset, exportPresetForProfile } from '../compatibility/target';
import { snapshotAssetProject, type AssetProjectSnapshot } from './projectSnapshot';

const bundleProjects = new WeakMap<object, AssetProject>();
const bundleDocumentDigests = new WeakMap<object, string>();
const bundleBuildDigests = new WeakMap<object, string>();

const sealBundleProject = (
  bundle: ExportBundle,
  project: AssetProject,
  snapshot: AssetProjectSnapshot,
): ExportBundle => {
  bundleProjects.set(bundle, project);
  bundleDocumentDigests.set(bundle, snapshot.documentDigest);
  bundleBuildDigests.set(bundle, snapshot.buildDigest);
  return bundle;
};

export function compileProjectBundle(
  project: AssetProject,
  adapter: ExportAdapterInput,
): ExportBundle {
  if (arguments.length !== 2)
    throw new TypeError('compileProjectBundle expects an AssetProject and closed adapter input.');
  const snapshot = snapshotAssetProject(project);
  const adapted = adaptProjectForExport(snapshot.document, adapter);
  const requestedPreset = exportPresetForProfile(adapted.formatProfile);
  const bundle = compileAdaptedProjectBundle(adapted, snapshot.build);
  assertExportBundleMatchesPreset(requestedPreset, bundle);
  return sealBundleProject(bundle, project, snapshot);
}

const compileAdaptedProjectBundle = (
  document: ExportAdaptedDocument,
  build: AssetProjectSnapshot['build'],
): ExportBundle => {
  switch (document.formatProfile.id) {
    case 'minecraft.java_block':
      return exportMinecraftJavaBlock(document, build);
    case 'minecraft.bedrock':
      return exportMinecraftBedrock(document, build);
    case 'minecraft.java.geckolib5':
      return exportGeckoLib5(document, build);
    case 'gltf.2':
      return exportGltf(document, build);
    default:
      throw new Error(
        `Unsupported export target "${String((document.formatProfile as { id?: string }).id)}".`,
      );
  }
};

export async function compileProjectBundleResolved(
  project: AssetProject,
  adapter: ExportAdapterInput,
  options: GltfResolvedExportOptions,
): Promise<ExportBundle> {
  if (arguments.length !== 3)
    throw new TypeError(
      'compileProjectBundleResolved expects an AssetProject, adapter input, and options.',
    );
  const snapshot = snapshotAssetProject(project);
  const adapted = adaptProjectForExport(snapshot.document, adapter);
  const requestedPreset = exportPresetForProfile(adapted.formatProfile);
  const pending =
    adapted.formatProfile.id === 'gltf.2'
      ? exportGltfResolved(adapted, snapshot.build, options)
      : compileAdaptedProjectBundle(adapted, snapshot.build);
  const bundle = await pending;
  assertExportBundleMatchesPreset(requestedPreset, bundle);
  return sealBundleProject(bundle, project, snapshot);
}

/** Verifies exact project identity plus current document/build authorities. */
export const verifyExportBundleForProject = (
  bundle: ExportBundle,
  project: AssetProject,
): boolean => {
  try {
    if (!verifyExportBundleLineage(bundle) || bundleProjects.get(bundle) !== project) return false;
    const snapshot = snapshotAssetProject(project);
    return (
      bundleDocumentDigests.get(bundle) === snapshot.documentDigest &&
      bundleBuildDigests.get(bundle) === snapshot.buildDigest &&
      bundle.lineage.packageName === project.build.packageName &&
      bundle.lineage.entryName === project.build.entryName &&
      bundle.lineage.entryPath === project.build.path &&
      bundle.lineage.workspaceHash === project.build.workspaceHash &&
      bundle.lineage.closureHash === project.build.closureHash &&
      bundle.lineage.buildKey === project.build.buildKey &&
      bundle.lineage.compilerFingerprint === project.build.compilerFingerprint &&
      bundle.lineage.productHash === project.build.productHash
    );
  } catch {
    return false;
  }
};
