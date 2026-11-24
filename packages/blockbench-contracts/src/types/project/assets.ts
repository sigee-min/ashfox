import { isFiniteJsonValue } from '@ashfox/internal-contracts';

import {
  TRACKED_ANIMATION_CHANNELS,
  TRACKED_ANIMATION_INTERPOLATIONS,
  TRACKED_ANIMATION_TRIGGER_TYPES,
  type TrackedAnimation,
  type TrackedTexture,
} from './index';
import { TEXTURE_FRAME_ORDER_TYPES, TEXTURE_PBR_CHANNELS } from '../texture';
import {
  hasShape,
  isArrayOf,
  isBoolean,
  isClosedContractRecord,
  isEnumValue,
  isFiniteNumber,
  isNonNegativeInteger,
  isString,
  isStringArray,
  isVec3,
  optional,
} from './shared';

export const isTrackedTextureContract = (value: unknown): value is TrackedTexture =>
  isClosedContractRecord(value) &&
  hasShape(
    value,
    ['name'],
    [
      'id',
      'path',
      'width',
      'height',
      'contentHash',
      'namespace',
      'folder',
      'particle',
      'visible',
      'renderMode',
      'renderSides',
      'pbrChannel',
      'group',
      'frameTime',
      'frameOrderType',
      'frameOrder',
      'frameInterpolate',
      'internal',
      'keepSize',
    ],
  ) &&
  isString(value.name) &&
  [
    'id',
    'path',
    'contentHash',
    'namespace',
    'folder',
    'renderMode',
    'renderSides',
    'group',
    'frameOrder',
  ].every((key) => optional(value, key, isString)) &&
  optional(value, 'width', isNonNegativeInteger) &&
  optional(value, 'height', isNonNegativeInteger) &&
  ['particle', 'visible', 'frameInterpolate', 'internal', 'keepSize'].every((key) =>
    optional(value, key, isBoolean),
  ) &&
  optional(value, 'pbrChannel', (entry): entry is NonNullable<TrackedTexture['pbrChannel']> =>
    isEnumValue(TEXTURE_PBR_CHANNELS, entry),
  ) &&
  optional(value, 'frameTime', isFiniteNumber) &&
  optional(
    value,
    'frameOrderType',
    (entry): entry is NonNullable<TrackedTexture['frameOrderType']> =>
      isEnumValue(TEXTURE_FRAME_ORDER_TYPES, entry),
  );

const isAnimationChannelKey = (
  value: unknown,
): value is NonNullable<TrackedAnimation['channels']>[number]['keys'][number] =>
  isClosedContractRecord(value) &&
  hasShape(value, ['time', 'value'], ['interp']) &&
  isFiniteNumber(value.time) &&
  isVec3(value.value) &&
  optional(
    value,
    'interp',
    (
      entry,
    ): entry is NonNullable<
      NonNullable<TrackedAnimation['channels']>[number]['keys'][number]['interp']
    > => isEnumValue(TRACKED_ANIMATION_INTERPOLATIONS, entry),
  );

const isAnimationChannel = (
  value: unknown,
): value is NonNullable<TrackedAnimation['channels']>[number] =>
  isClosedContractRecord(value) &&
  hasShape(value, ['bone', 'channel', 'keys']) &&
  isString(value.bone) &&
  isEnumValue(TRACKED_ANIMATION_CHANNELS, value.channel) &&
  isArrayOf(value.keys, isAnimationChannelKey);

const isTriggerValue = (
  value: unknown,
): value is string | readonly string[] | Readonly<Record<string, unknown>> =>
  typeof value === 'string' ||
  isStringArray(value) ||
  (isClosedContractRecord(value) && isFiniteJsonValue(value));

const isAnimationTriggerKey = (
  value: unknown,
): value is NonNullable<TrackedAnimation['triggers']>[number]['keys'][number] =>
  isClosedContractRecord(value) &&
  hasShape(value, ['time', 'value']) &&
  isFiniteNumber(value.time) &&
  isTriggerValue(value.value);

const isAnimationTrigger = (
  value: unknown,
): value is NonNullable<TrackedAnimation['triggers']>[number] =>
  isClosedContractRecord(value) &&
  hasShape(value, ['type', 'keys']) &&
  isEnumValue(TRACKED_ANIMATION_TRIGGER_TYPES, value.type) &&
  isArrayOf(value.keys, isAnimationTriggerKey);

export const isTrackedAnimationContract = (value: unknown): value is TrackedAnimation =>
  isClosedContractRecord(value) &&
  hasShape(value, ['name', 'length', 'loop'], ['id', 'fps', 'channels', 'triggers']) &&
  isString(value.name) &&
  isFiniteNumber(value.length) &&
  isBoolean(value.loop) &&
  optional(value, 'id', isString) &&
  optional(value, 'fps', isFiniteNumber) &&
  optional(value, 'channels', (entry) => isArrayOf(entry, isAnimationChannel)) &&
  optional(value, 'triggers', (entry) => isArrayOf(entry, isAnimationTrigger));
