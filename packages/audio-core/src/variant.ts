/** Domain-separated variant seeds; zero repair must not collapse adjacent seeds. */
export const soundVariantSeed = (soundSeed: number, variant: { readonly id: string; readonly seed: number }): number => {
  let state = 2166136261;
  for (const character of `sound:${soundSeed}/variant:${variant.id}/seed:${variant.seed}`) {
    state = Math.imul(state ^ character.charCodeAt(0), 16777619) >>> 0;
  }
  state ^= state >>> 16;
  state = Math.imul(state, 0x85ebca6b) >>> 0;
  state ^= state >>> 13;
  return (state >>> 0) || 1;
};
