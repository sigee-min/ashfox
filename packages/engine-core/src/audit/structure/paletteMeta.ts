import { describeBlockState, type BlockDescriptor } from '../../compiler/structure/blocks';

export interface PaletteStateMeta {
  readonly baseId: string;
  readonly descriptor: BlockDescriptor;
  readonly isDoor: boolean;
  readonly isStair: boolean;
  readonly isSlab: boolean;
  readonly isLadder: boolean;
  readonly isPassable: boolean;
  readonly canStandOn: boolean;
  readonly isRoofCover: boolean;
  readonly isWallBarrier: boolean;
  readonly isOpening: boolean;
}

const PASSABLE_HINTS = ['carpet', 'torch', 'banner', 'sign', 'button', 'lever', 'pressure_plate'];

const isPassableBlock = (
  baseId: string,
  desc: BlockDescriptor,
  isDoor: boolean,
  isLadder: boolean,
): boolean => {
  if (
    isDoor ||
    isLadder ||
    desc.shape === 'carpet' ||
    desc.shape === 'torch' ||
    desc.shape === 'pot'
  )
    return true;
  return PASSABLE_HINTS.some((hint) => baseId.includes(hint));
};

const isRoofCapable = (baseId: string, desc: BlockDescriptor): boolean => {
  if (desc.solidOpaque || desc.shape === 'stair' || desc.shape === 'slab') return true;
  if (desc.shape === 'trapdoor' || desc.shape === 'door') return true;
  if (baseId.includes('leaves')) return true;
  return baseId.includes('glass') && !baseId.includes('pane');
};

const isBarrierBlock = (
  index: number,
  desc: BlockDescriptor,
  isPassable: boolean,
  isDoor: boolean,
): boolean => {
  if (index <= 0) return false;
  if (isDoor || desc.shape === 'pane' || desc.shape === 'wall' || desc.shape === 'fence')
    return true;
  return !isPassable;
};

/** Pre-decodes every palette entry once so voxel passes stay O(1) per cell. */
export const buildPaletteMeta = (states: readonly string[]): readonly PaletteStateMeta[] =>
  states.map((state, index) => {
    const descriptor = describeBlockState(state);
    if (index === 0) {
      return {
        baseId: state,
        descriptor,
        isDoor: false,
        isStair: false,
        isSlab: false,
        isLadder: false,
        isPassable: true,
        canStandOn: false,
        isRoofCover: false,
        isWallBarrier: false,
        isOpening: false,
      };
    }
    const bracket = state.indexOf('[');
    const baseId = bracket === -1 ? state : state.slice(0, bracket);
    const isDoor = descriptor.shape === 'door' || baseId.includes('_door');
    const isStair = descriptor.shape === 'stair';
    const isSlab = descriptor.shape === 'slab';
    const isLadder = descriptor.shape === 'ladder';
    const isPassable = isPassableBlock(baseId, descriptor, isDoor, isLadder);
    const canStandOn =
      !descriptor.furniture && (descriptor.solidOpaque || isStair || isSlab || isLadder);
    const isRoofCover = isRoofCapable(baseId, descriptor);
    const isWallBarrier = isBarrierBlock(index, descriptor, isPassable, isDoor);
    const isOpening = isDoor || descriptor.shape === 'pane' || baseId.includes('glass');
    return {
      baseId,
      descriptor,
      isDoor,
      isStair,
      isSlab,
      isLadder,
      isPassable,
      canStandOn,
      isRoofCover,
      isWallBarrier,
      isOpening,
    };
  });
