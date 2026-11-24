import type { ExportAdaptedDocument } from '../adapter';
import { sealCanonicalBoneFrame } from '../../model';
import type { ExportFormatProfile, MinecraftBedrockExportProfile } from '../adapter/contract';
import { ProjectExportError } from '../contract';
import { snapshotExportData } from './dataSnapshot';

type ProfileId = ExportFormatProfile['id'];

const PROFILE_FIELDS: Readonly<
  Record<
    ProfileId,
    Readonly<{
      required: readonly string[];
      optional: readonly string[];
    }>
  >
> = Object.freeze({
  'minecraft.java_block': Object.freeze({
    required: Object.freeze([
      'id',
      'minecraftVersion',
      'resourcePackFormat',
      'modelKind',
      'namespace',
      'modelPath',
    ]),
    optional: Object.freeze(['parent', 'ambientOcclusion', 'guiLight']),
  }),
  'minecraft.bedrock': Object.freeze({
    required: Object.freeze([
      'id',
      'minecraftVersion',
      'geometryFormatVersion',
      'animationFormatVersion',
      'geometryKind',
      'namespace',
      'modelPath',
      'animationPath',
      'geometryIdentifier',
    ]),
    optional: Object.freeze(['visibleBounds']),
  }),
  'minecraft.java.geckolib5': Object.freeze({
    required: Object.freeze([
      'id',
      'minecraftVersion',
      'geometryFormatVersion',
      'animationFormatVersion',
      'assetKind',
      'namespace',
      'modelPath',
      'animationPath',
      'geometryIdentifier',
    ]),
    optional: Object.freeze(['visibleBounds']),
  }),
  'gltf.2': Object.freeze({
    required: Object.freeze(['id', 'version', 'container', 'imageStorage', 'modelPath']),
    optional: Object.freeze(['copyright']),
  }),
});

const snapshotError = (errorMessage: string, path: string, message: string): never => {
  throw new ProjectExportError(errorMessage, [
    {
      code: 'format.unsupported_data',
      severity: 'error',
      path,
      message,
    },
  ]);
};

const ownDataFields = (
  value: unknown,
  path: string,
  errorMessage: string,
): ReadonlyMap<string, unknown> => {
  if (
    typeof value !== 'object' ||
    value === null ||
    Array.isArray(value) ||
    Object.getPrototypeOf(value) !== Object.prototype
  ) {
    return snapshotError(errorMessage, path, 'Export profile data must be one plain object.');
  }
  const result = new Map<string, unknown>();
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string')
      return snapshotError(errorMessage, path, 'Export profile data must not contain symbol keys.');
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !Object.prototype.hasOwnProperty.call(descriptor, 'value')
    ) {
      return snapshotError(
        errorMessage,
        `${path}.${key}`,
        'Export profile fields must be own enumerable data properties.',
      );
    }
    result.set(key, descriptor.value);
  }
  return result;
};

const exactFields = (
  fields: ReadonlyMap<string, unknown>,
  required: readonly string[],
  optional: readonly string[],
  path: string,
  errorMessage: string,
): void => {
  const allowed = new Set([...required, ...optional]);
  if (
    [...fields.keys()].some((key) => !allowed.has(key)) ||
    required.some((key) => !fields.has(key))
  ) {
    return snapshotError(
      errorMessage,
      path,
      'Export profile fields do not match the current target contract.',
    );
  }
};

const snapshotOffset = (
  value: unknown,
  errorMessage: string,
): readonly [number, number, number] => {
  if (!Array.isArray(value) || Object.getPrototypeOf(value) !== Array.prototype)
    return snapshotError(
      errorMessage,
      'formatProfile.visibleBounds.offset',
      'Visible bounds offset must be one plain dense three-number array.',
    );
  const keys = Reflect.ownKeys(value);
  if (
    keys.length !== 4 ||
    keys.some((key) => typeof key !== 'string') ||
    !['0', '1', '2', 'length'].every((key) => keys.includes(key))
  ) {
    return snapshotError(
      errorMessage,
      'formatProfile.visibleBounds.offset',
      'Visible bounds offset must be one plain dense three-number array.',
    );
  }
  const length = Object.getOwnPropertyDescriptor(value, 'length');
  if (length === undefined || !('value' in length) || length.value !== 3) {
    return snapshotError(
      errorMessage,
      'formatProfile.visibleBounds.offset',
      'Visible bounds offset must contain exactly three numbers.',
    );
  }
  const result = [0, 1, 2].map((index) => {
    const path = `formatProfile.visibleBounds.offset.${index}`;
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (
      descriptor === undefined ||
      !descriptor.enumerable ||
      !('value' in descriptor) ||
      typeof descriptor.value !== 'number' ||
      !Number.isFinite(descriptor.value)
    )
      return snapshotError(
        errorMessage,
        path,
        'Visible bounds offsets must be finite data numbers.',
      );
    return descriptor.value;
  });
  return Object.freeze([result[0]!, result[1]!, result[2]!]);
};

const snapshotVisibleBounds = (
  value: unknown,
  errorMessage: string,
): NonNullable<MinecraftBedrockExportProfile['visibleBounds']> => {
  const fields = ownDataFields(value, 'formatProfile.visibleBounds', errorMessage);
  exactFields(
    fields,
    ['width', 'height', 'offset'],
    [],
    'formatProfile.visibleBounds',
    errorMessage,
  );
  const width = fields.get('width');
  const height = fields.get('height');
  if (
    typeof width !== 'number' ||
    !Number.isFinite(width) ||
    typeof height !== 'number' ||
    !Number.isFinite(height)
  ) {
    return snapshotError(
      errorMessage,
      'formatProfile.visibleBounds',
      'Visible bounds width and height must be finite data numbers.',
    );
  }
  return Object.freeze({
    width,
    height,
    offset: snapshotOffset(fields.get('offset'), errorMessage),
  });
};

const snapshotProfile = (value: unknown, errorMessage: string): ExportFormatProfile => {
  const fields = ownDataFields(value, 'formatProfile', errorMessage);
  const id = fields.get('id');
  if (typeof id !== 'string' || !Object.prototype.hasOwnProperty.call(PROFILE_FIELDS, id)) {
    return snapshotError(
      errorMessage,
      'formatProfile.id',
      'Export profile id has no current target authority.',
    );
  }
  const profileId = id as ProfileId;
  const contract = PROFILE_FIELDS[profileId];
  exactFields(fields, contract.required, contract.optional, 'formatProfile', errorMessage);
  const entries = [...contract.required, ...contract.optional]
    .filter((key) => fields.has(key))
    .map(
      (key) =>
        [
          key,
          key === 'visibleBounds'
            ? snapshotVisibleBounds(fields.get(key), errorMessage)
            : fields.get(key),
        ] as const,
    );
  return Object.freeze(Object.fromEntries(entries)) as ExportFormatProfile;
};

/** Reads every caller-owned field exactly once into one deeply immutable
 * canonical export snapshot. Exporters never retain aliases into the caller's
 * mutable project while an asynchronous texture resolver is pending. */
export const snapshotExportTargetDocument = (
  document: ExportAdaptedDocument,
  errorMessage: string,
): ExportAdaptedDocument => {
  const descriptor = Object.getOwnPropertyDescriptor(document, 'formatProfile');
  if (
    descriptor === undefined ||
    !descriptor.enumerable ||
    !Object.prototype.hasOwnProperty.call(descriptor, 'value')
  ) {
    return snapshotError(
      errorMessage,
      'formatProfile',
      'Export document formatProfile must be an own enumerable data property.',
    );
  }
  const descriptors = Object.getOwnPropertyDescriptors(document);
  descriptors.formatProfile = {
    configurable: false,
    enumerable: true,
    writable: false,
    value: snapshotProfile(descriptor.value, errorMessage),
  };
  const profileSnapshot = Object.freeze(
    Object.create(Object.getPrototypeOf(document), descriptors) as ExportAdaptedDocument,
  );
  const snapshot = snapshotExportData(profileSnapshot, 'document', errorMessage);
  for (const node of Object.values(snapshot.scene.nodes)) {
    if (node.kind === 'bone') sealCanonicalBoneFrame(node);
  }
  return snapshot;
};
