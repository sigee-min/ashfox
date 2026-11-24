import type { CommandEffects, InvalidatedArea } from '../types';

type EffectState = 'created' | 'changed' | 'removed';

const effectStates = (effects: CommandEffects): Map<string, EffectState> => {
  const states = new Map<string, EffectState>();
  effects.createdEntityIds.forEach((id) => states.set(id, 'created'));
  effects.changedEntityIds.forEach((id) => {
    if (!states.has(id)) states.set(id, 'changed');
  });
  effects.removedEntityIds.forEach((id) => {
    const current = states.get(id);
    if (current === 'created') {
      states.delete(id);
    } else {
      states.set(id, 'removed');
    }
  });
  return states;
};

const mergeEntityEffects = (
  current: CommandEffects,
  next: CommandEffects,
): Pick<CommandEffects, 'createdEntityIds' | 'changedEntityIds' | 'removedEntityIds'> => {
  const states = effectStates(current);
  for (const id of next.createdEntityIds) {
    const previous = states.get(id);
    states.set(id, previous === undefined || previous === 'created' ? 'created' : 'changed');
  }
  for (const id of next.changedEntityIds) {
    if (!states.has(id)) states.set(id, 'changed');
  }
  for (const id of next.removedEntityIds) {
    if (states.get(id) === 'created') {
      states.delete(id);
    } else {
      states.set(id, 'removed');
    }
  }
  const ids = [...states.keys()].sort();
  return {
    createdEntityIds: ids.filter((id) => states.get(id) === 'created'),
    changedEntityIds: ids.filter((id) => states.get(id) === 'changed'),
    removedEntityIds: ids.filter((id) => states.get(id) === 'removed'),
  };
};

export const mergeCommandEffects = (
  current: CommandEffects,
  next: CommandEffects,
): CommandEffects => ({
  ...mergeEntityEffects(current, next),
  invalidated: [...new Set<InvalidatedArea>([...current.invalidated, ...next.invalidated])],
});

export const emptyCommandEffects = (): CommandEffects => ({
  createdEntityIds: [],
  changedEntityIds: [],
  removedEntityIds: [],
  invalidated: [],
});
