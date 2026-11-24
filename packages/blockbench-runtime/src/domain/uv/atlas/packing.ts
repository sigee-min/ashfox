import type { DomainResult } from '../../result';
import type { UvAtlasMessages } from './contract';
import type { Group } from './groups';
import { packUvAtlas } from '@ashfox/engine-core';
import { atlasFailure } from './result';

export type Placement = {
  group: Group;
  x: number;
  y: number;
};

export const packGroups = (
  groups: Group[],
  width: number,
  height: number,
  padding: number,
  messages: UvAtlasMessages,
): DomainResult<Placement[]> => {
  const oversized = groups.find((group) => group.width > width || group.height > height);
  if (oversized) {
    return overflow(width, height, oversized.width, oversized.height, messages);
  }
  const placements = packUvAtlas(
    groups.map((group) => ({
      key: group.key,
      width: group.width,
      height: group.height,
      value: group,
    })),
    width,
    height,
    padding,
  );
  if (!placements) {
    const last = [...groups].sort((left, right) => left.key.localeCompare(right.key)).at(-1);
    return overflow(width, height, last?.width ?? 0, last?.height ?? 0, messages);
  }
  return {
    ok: true,
    data: placements.map(({ value, x, y }) => ({
      group: value,
      x,
      y,
    })),
  };
};

const overflow = (
  width: number,
  height: number,
  rectWidth: number,
  rectHeight: number,
  messages: UvAtlasMessages,
): DomainResult<never> =>
  atlasFailure('invalid_state', messages.overflow, {
    reason: 'atlas_overflow',
    resolution: { width, height },
    rect: { width: rectWidth, height: rectHeight },
  });
