export interface DocsTopicEntry {
  readonly topic: string;
  readonly title: string;
  readonly description: string;
  readonly source: string;
}

declare const ASHFOX_DOCS: Readonly<Record<string, string>> | undefined;

export const DOCS_TOPICS: readonly DocsTopicEntry[] = Object.freeze([
  {
    topic: 'agent',
    title: 'Agent Quick Guide',
    description: 'End-to-end coding agent setup, CLI loop, and delivery workflow',
    source: 'agent.md',
  },
  {
    topic: 'grammar',
    title: 'DSL Overview',
    description: 'Unified ashfox 1 source units, value types, and domain syntax summary',
    source: 'language/README.md',
  },
  {
    topic: 'model',
    title: 'Model Syntax',
    description:
      '3D geometry primitives (cube, plane, taper, wedge, cylinder), expressions, and assembly',
    source: 'language/model.md',
  },
  {
    topic: 'rig',
    title: 'Rigs, Components, and Sockets',
    description:
      'Rig contracts, skeleton parent_origin bindings, component ports, and socket frames',
    source: 'language/components.md',
  },
  {
    topic: 'surface',
    title: 'Surfaces, Textures, and PBR',
    description: 'Surface contracts, OKLCH ramps, charts, stamps, AO, and PBR roughness/metallic',
    source: 'language/textures.md',
  },
  {
    topic: 'animation',
    title: 'Animation and Motion',
    description:
      'Motions, curves, procedural waves, IK foot locking, secondary physics, combat, and cues',
    source: 'guides/animation.md',
  },
  {
    topic: 'vfx',
    title: 'VFX Syntax',
    description:
      'Geometric VFX primitives, procedural textures, dissolve strips, and voxel_burst emitters',
    source: 'language/vfx.md',
  },
  {
    topic: 'sprite',
    title: 'Sprite Syntax',
    description:
      '2D item/tile/icon/decal sprites, OKLCH ramps, shapes, patterns, and selective outlines',
    source: 'language/sprites.md',
  },
  {
    topic: 'sound',
    title: 'Sound Syntax',
    description:
      'True-stereo procedural audio synthesis, voices, sequences, gapless loops, and mastering',
    source: 'language/sounds.md',
  },
  {
    topic: 'structure',
    title: 'Structure Syntax',
    description:
      'Buildings, furnished interiors, radiosity GI, roofs, Minecraft .nbt, and GLB export',
    source: 'language/structures.md',
  },
  {
    topic: 'hooks',
    title: 'Hooks and Schemas',
    description: 'Typed schema, anchor, volume, cue, meta, zone, .hooks.json, and engine bindings',
    source: 'language/hooks.md',
  },
]);

export const DOCS_TOPIC_IDS: readonly string[] = Object.freeze(
  DOCS_TOPICS.map((entry) => entry.topic),
);

export const findDocsTopic = (topic: string): DocsTopicEntry | undefined =>
  DOCS_TOPICS.find((entry) => entry.topic === topic);

export const readDocsMarkdown = (topic: string): string | null => {
  if (typeof ASHFOX_DOCS !== 'object' || ASHFOX_DOCS === null) return null;
  const content = ASHFOX_DOCS[topic];
  return typeof content === 'string' ? content : null;
};
