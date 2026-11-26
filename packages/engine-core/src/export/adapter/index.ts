import { compareText } from '../../stableOrder';
import type { AssetId, CubeNode, PlaneNode, ProjectDocument, TextureAsset } from '../../model';
import { cubeGeometryCorners } from '../../model';
import { effectivelyVisibleSceneNodeIds } from '../../sceneVisibility';
import { resourceToken } from '../../resourceToken';
import type { ExportFormatProfile, MinecraftTextureBinding } from './contract';
import { type ExportPreset } from '../compatibility';
import { exportProfileForAdapter } from '../compatibility/profiles';
import { readExportAdapterInput, type ExportAdapterInput } from './input';

export { ExportAdapterInputError, readExportAdapterInput, type ExportAdapterInput } from './input';

/**
 * Ephemeral delivery configuration.  It is deliberately not part of the
 * persisted project: changing a delivery target cannot alter compiler-owned
 * geometry, texture layout, authoring evidence, or animation state.
 */
export interface ResolvedExportAdapter {
  target: ExportPreset;
  profile: ExportFormatProfile;
}

export interface ExportTextureAsset extends TextureAsset {
  minecraft?: MinecraftTextureBinding;
}

/** Target-shaped transient view consumed only by delivery adapters. */
export interface ExportAdaptedDocument extends Omit<ProjectDocument, 'textures'> {
  formatProfile: ExportFormatProfile;
  textures: Readonly<Record<AssetId, ExportTextureAsset>>;
  /** Delivery-only transforms applied after canonical compilation. */
  deliveryAdaptation?: {
    readonly sceneTranslation?: readonly [number, number, number];
  };
}

type DeliveryShapedProject = ProjectDocument & {
  formatProfile?: unknown;
  deliveryAdaptation?: unknown;
  textures: Readonly<Record<AssetId, ExportTextureAsset>>;
};

const canonicalTextureAssets = (
  textures: Readonly<Record<AssetId, ExportTextureAsset>>,
): Record<AssetId, TextureAsset> =>
  Object.fromEntries(
    Object.entries(textures).map(([id, texture]) => {
      const { minecraft: _minecraft, ...canonicalTexture } = texture;
      return [id, canonicalTexture];
    }),
  );

/**
 * Strips delivery-only fields even if a caller accidentally supplies a prior
 * adapter view. This makes each target selection a fresh projection from
 * canonical project authority, never a conversion from another target.
 */
const canonicalProjectFromDeliveryShape = (document: DeliveryShapedProject): ProjectDocument => {
  const {
    formatProfile: _formatProfile,
    deliveryAdaptation: _deliveryAdaptation,
    textures,
    ...canonicalFields
  } = document;
  const canonical = {
    ...canonicalFields,
    textures: canonicalTextureAssets(textures),
  } as ProjectDocument;
  const translation =
    typeof _deliveryAdaptation === 'object' &&
    _deliveryAdaptation !== null &&
    'sceneTranslation' in _deliveryAdaptation &&
    Array.isArray(_deliveryAdaptation.sceneTranslation) &&
    _deliveryAdaptation.sceneTranslation.length === 3 &&
    _deliveryAdaptation.sceneTranslation.every(
      (value: unknown) => typeof value === 'number' && Number.isFinite(value),
    )
      ? (_deliveryAdaptation.sceneTranslation as [number, number, number])
      : null;
  return translation
    ? {
        ...canonical,
        scene: translatedScene(
          canonical.scene,
          translation.map((value) => -value) as [number, number, number],
        ),
      }
    : canonical;
};

const primitiveBounds = (
  node: CubeNode | PlaneNode,
): readonly [readonly number[], readonly number[]] => {
  if (node.kind === 'cube') {
    const corners = cubeGeometryCorners(node);
    return [
      [0, 1, 2].map((axis) => Math.min(...corners.map((corner) => corner[axis]!)) - node.inflate),
      [0, 1, 2].map((axis) => Math.max(...corners.map((corner) => corner[axis]!)) + node.inflate),
    ];
  }
  return [
    node.transform.position,
    [
      node.transform.position[0] + node.size[0],
      node.transform.position[1] + node.size[1],
      node.transform.position[2],
    ],
  ];
};

const javaBlockSceneTranslation = (
  document: ProjectDocument,
): readonly [number, number, number] | null => {
  const visible = effectivelyVisibleSceneNodeIds(document);
  const primitives = Object.values(document.scene.nodes).filter(
    (node): node is CubeNode | PlaneNode =>
      (node.kind === 'cube' || node.kind === 'plane') && visible.has(node.id),
  );
  if (primitives.length === 0) return null;
  const minimum = [Infinity, Infinity, Infinity];
  const maximum = [-Infinity, -Infinity, -Infinity];
  for (const primitive of primitives) {
    const [from, to] = primitiveBounds(primitive);
    for (let axis = 0; axis < 3; axis += 1) {
      minimum[axis] = Math.min(minimum[axis]!, from[axis]!);
      maximum[axis] = Math.max(maximum[axis]!, to[axis]!);
    }
  }
  if (minimum.some((value, axis) => maximum[axis]! - value > 48)) {
    return null;
  }
  return [0, 1, 2].map((axis) => 8 - (minimum[axis]! + maximum[axis]!) / 2) as [
    number,
    number,
    number,
  ];
};

const translatedScene = (
  scene: ProjectDocument['scene'],
  translation: readonly [number, number, number],
): ProjectDocument['scene'] => ({
  ...scene,
  nodes: Object.fromEntries(
    Object.entries(scene.nodes).map(([id, node]) => {
      if (node.kind !== 'cube' && node.kind !== 'plane') return [id, node];
      return [
        id,
        {
          ...node,
          transform: {
            ...node.transform,
            position: node.transform.position.map((value, axis) => value + translation[axis]!) as [
              number,
              number,
              number,
            ],
          },
        },
      ];
    }),
  ),
});

/** Removes ephemeral delivery data before canonical validation or persistence. */
export const canonicalProjectFromExportAdapter = (
  document: ExportAdaptedDocument,
): ProjectDocument => canonicalProjectFromDeliveryShape(document);

const isMinecraftProfile = (
  profile: ExportFormatProfile,
): profile is Extract<
  ExportFormatProfile,
  {
    id: 'minecraft.java_block' | 'minecraft.bedrock' | 'minecraft.java.geckolib5';
  }
> =>
  profile.id === 'minecraft.java_block' ||
  profile.id === 'minecraft.bedrock' ||
  profile.id === 'minecraft.java.geckolib5';

const profileKind = (
  profile: Extract<
    ExportFormatProfile,
    {
      id: 'minecraft.java_block' | 'minecraft.bedrock' | 'minecraft.java.geckolib5';
    }
  >,
): 'block' | 'item' | 'entity' =>
  profile.id === 'minecraft.java_block'
    ? profile.modelKind
    : profile.id === 'minecraft.bedrock'
      ? profile.geometryKind
      : profile.assetKind;

export function resolveExportAdapter(
  document: ProjectDocument,
  input: ExportAdapterInput,
): ResolvedExportAdapter {
  if (arguments.length !== 2)
    throw new TypeError('resolveExportAdapter expects a document and closed adapter input.');
  void document;
  const snapshot = readExportAdapterInput(input);
  const profile = exportProfileForAdapter(snapshot);
  if (!profile) {
    throw new TypeError('exportAdapter.target: Unsupported current target.');
  }
  return { target: snapshot.target, profile };
}

const adapterTextures = (
  document: ProjectDocument,
  profile: ExportFormatProfile,
): ExportAdaptedDocument['textures'] => {
  if (!isMinecraftProfile(profile)) return document.textures;
  return Object.fromEntries(
    Object.entries(document.textures)
      .sort(([left], [right]) => compareText(left, right))
      .map(([id, texture], index) => [
        id,
        {
          ...texture,
          minecraft: createMinecraftTextureBinding(
            {
              namespace: profile.namespace,
              kind: profileKind(profile),
              modelPath: profile.modelPath,
            },
            id,
            index,
          ),
        },
      ]),
  );
};

const createMinecraftTextureBinding = (
  location: {
    namespace: string;
    kind: 'block' | 'item' | 'entity';
    modelPath: string;
  },
  id: string,
  ordinal: number,
): MinecraftTextureBinding => {
  const token = resourceToken(id, 'texture');
  const suffix = ordinal === 0 ? '' : `_${token}`;
  return {
    key: ordinal === 0 ? 'base' : `${token}_${ordinal}`,
    resource: {
      namespace: location.namespace,
      path: `${location.kind}/${location.modelPath}${suffix}`,
    },
    extension: 'png',
    particle: ordinal === 0,
  };
};

/** Builds a non-persisted target view immediately before export. */
export function adaptProjectForExport(
  document: ProjectDocument,
  input: ExportAdapterInput,
): ExportAdaptedDocument {
  if (arguments.length !== 2)
    throw new TypeError('adaptProjectForExport expects a document and closed adapter input.');
  const canonical = canonicalProjectFromDeliveryShape(document as DeliveryShapedProject);
  const adapter = resolveExportAdapter(canonical, input);
  const sceneTranslation =
    adapter.profile.id === 'minecraft.java_block' ? javaBlockSceneTranslation(canonical) : null;
  return {
    ...canonical,
    formatProfile: adapter.profile,
    textures: adapterTextures(canonical, adapter.profile),
    ...(sceneTranslation
      ? {
          scene: translatedScene(canonical.scene, sceneTranslation),
          deliveryAdaptation: { sceneTranslation },
        }
      : {}),
  };
}
