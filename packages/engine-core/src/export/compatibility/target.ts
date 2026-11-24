import type { ExportBundle, ExportTargetId } from '../contract';
import type { ExportFormatProfile } from '../adapter/contract';
import type { ExportPreset } from './contract';
import { registeredExportCompatibilityEntries, type ExportCompatibilityEntry } from './registry';

export interface CurrentExportTargetDescriptor {
  readonly preset: ExportPreset;
  readonly target: Readonly<{
    readonly id: ExportTargetId;
    readonly version: string;
  }>;
  readonly namespaceRequired: boolean;
}

export class ExportTargetContractError extends TypeError {
  readonly code = 'export.target_contract_invalid' as const;

  constructor(
    readonly path: string,
    message: string,
  ) {
    super(`${path}: ${message}`);
    this.name = 'ExportTargetContractError';
  }
}

const targetVersionForEntry = (entry: ExportCompatibilityEntry): string =>
  entry.profile.id === 'gltf.2' ? entry.profile.version : entry.profile.minecraftVersion;

const descriptorForEntry = (entry: ExportCompatibilityEntry): CurrentExportTargetDescriptor =>
  Object.freeze({
    preset: entry.target,
    target: Object.freeze({
      id: entry.profile.id,
      version: targetVersionForEntry(entry),
    }),
    namespaceRequired: entry.profile.id !== 'gltf.2',
  });

const targetDescriptors = Object.freeze(
  Object.fromEntries(
    registeredExportCompatibilityEntries().map((entry) => [
      entry.target,
      descriptorForEntry(entry),
    ]),
  ),
) as Readonly<Record<ExportPreset, CurrentExportTargetDescriptor>>;

export function exportTargetDescriptorForPreset(
  preset: ExportPreset,
): CurrentExportTargetDescriptor {
  if (arguments.length !== 1)
    throw new TypeError('exportTargetDescriptorForPreset expects exactly one preset.');
  if (!Object.prototype.hasOwnProperty.call(targetDescriptors, preset)) {
    throw new ExportTargetContractError(
      'exportAdapter.target',
      `Unknown export target "${String(preset)}".`,
    );
  }
  return targetDescriptors[preset];
}

export function exportPresetForProfile(profile: ExportFormatProfile): ExportPreset {
  if (arguments.length !== 1)
    throw new TypeError('exportPresetForProfile expects exactly one profile.');
  if (profile.id === 'gltf.2') return profile.container;
  if (profile.id === 'minecraft.bedrock') return 'bedrock';
  if (profile.id === 'minecraft.java.geckolib5') return 'geckolib5';
  return 'java_block';
}

type BundlePresetResult = Readonly<{
  preset: ExportPreset | null;
  path: string;
}>;

const jsonPrimaryPreset = (
  bundle: ExportBundle,
  role: 'model' | 'geometry',
  rootPath: string,
  suffix: string,
  preset: ExportPreset,
): BundlePresetResult => {
  if (bundle.rootPath !== rootPath)
    return {
      preset: null,
      path: 'exportBundle.rootPath',
    };
  const primary = bundle.files
    .map((file, index) => ({ file, index }))
    .filter(({ file }) => file.role === role);
  if (primary.length !== 1)
    return {
      preset: null,
      path: 'exportBundle.files',
    };
  const { file, index } = primary[0]!;
  return file.kind === 'json' &&
    file.contentType === 'application/json' &&
    file.path.endsWith(suffix)
    ? { preset, path: '' }
    : { preset: null, path: `exportBundle.files[${index}]` };
};

const gltfBundlePreset = (bundle: ExportBundle): BundlePresetResult => {
  if (bundle.rootPath !== 'gltf')
    return {
      preset: null,
      path: 'exportBundle.rootPath',
    };
  const models = bundle.files
    .map((file, index) => ({ file, index }))
    .filter(({ file }) => file.role === 'model');
  if (models.length !== 1)
    return {
      preset: null,
      path: 'exportBundle.files',
    };
  const { file, index } = models[0]!;
  if (
    file.kind === 'binary' &&
    file.contentType === 'model/gltf-binary' &&
    file.path.endsWith('.glb')
  )
    return { preset: 'glb', path: '' };
  if (file.kind === 'json' && file.contentType === 'model/gltf+json' && file.path.endsWith('.gltf'))
    return { preset: 'gltf', path: '' };
  return { preset: null, path: `exportBundle.files[${index}]` };
};

const bundlePreset = (bundle: ExportBundle): BundlePresetResult => {
  if (bundle.target.id === 'gltf.2') return gltfBundlePreset(bundle);
  if (bundle.target.id === 'minecraft.bedrock') {
    return jsonPrimaryPreset(
      bundle,
      'geometry',
      'bedrock-resource-pack-assets',
      '.geo.json',
      'bedrock',
    );
  }
  if (bundle.target.id === 'minecraft.java.geckolib5') {
    return jsonPrimaryPreset(bundle, 'geometry', 'src/main/resources', '.geo.json', 'geckolib5');
  }
  if (bundle.target.id === 'minecraft.java_block') {
    return jsonPrimaryPreset(bundle, 'model', 'resource-pack', '.json', 'java_block');
  }
  return { preset: null, path: 'exportBundle.target.id' };
};

export function exportPresetForBundle(bundle: ExportBundle): ExportPreset | null {
  if (arguments.length !== 1)
    throw new TypeError('exportPresetForBundle expects exactly one bundle.');
  const result = bundlePreset(bundle);
  if (result.preset === null) return null;
  const descriptor = exportTargetDescriptorForPreset(result.preset);
  return bundle.target.id === descriptor.target.id &&
    bundle.target.version === descriptor.target.version
    ? result.preset
    : null;
}

export function assertExportBundleMatchesPreset(
  requested: ExportPreset,
  bundle: ExportBundle,
): void {
  if (arguments.length !== 2)
    throw new TypeError('assertExportBundleMatchesPreset expects a preset and bundle.');
  const result = bundlePreset(bundle);
  if (result.preset === null)
    throw new ExportTargetContractError(
      result.path,
      'Export files do not identify one current delivery preset.',
    );
  const descriptor = exportTargetDescriptorForPreset(result.preset);
  if (bundle.target.id !== descriptor.target.id)
    throw new ExportTargetContractError(
      'exportBundle.target.id',
      'Emitted target ID does not match its preset.',
    );
  if (bundle.target.version !== descriptor.target.version) {
    throw new ExportTargetContractError(
      'exportBundle.target.version',
      'Emitted target version is not current.',
    );
  }
  if (result.preset !== requested)
    throw new ExportTargetContractError(
      result.path || 'exportBundle.files',
      `Requested ${requested} but emitted ${result.preset}.`,
    );
}
