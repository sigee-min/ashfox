export const landingContent = {
  eyebrow: 'Code-authored game assets',
  titleLines: ['Imagine a creature.', 'Bring it to life.'],
  summary:
    'Models, pixel items, and sound effects from source. Build assets for voxel games and Minecraft.',
  showcase: {
    eyebrow: 'Made with ashfox',
    provenance:
      'Build replays reconstructed from the finished models.',
    entries: [
      {
        packageName: 'workbench',
        entryName: 'griffin',
        index: '01',
        label: 'Griffin guardian',
        summary: 'Ivory feathers. Golden fur. A guardian with a presence of its own.'
      },
      {
        packageName: 'creatures',
        entryName: 'fox',
        index: '02',
        label: 'Red fox',
        summary: 'A curious companion. Ember fur, a playful tail, and a world to explore.'
      },
      {
        packageName: 'creatures',
        entryName: 'goblin',
        index: '03',
        label: 'Goblin raider',
        summary: 'Small stature. Big attitude. Armored and ready to make trouble.'
      }
    ]
  },
  quickStart: {
    instruction:
      'Read https://ashfox.io/docs/guides/agent-workflow/ and use native .ashfox sources and the Ashfox CLI for this project.'
  },
  formats: [
    ['Java block', 'Static blocks for Minecraft Java resource packs.'],
    ['GeckoLib 5', 'Animated models for Minecraft Java mods.'],
    ['Bedrock', 'Models, textures, and animation for Bedrock packs.'],
    ['GLB', 'One 3D file for game engines and viewers.'],
    ['PNG + audio', 'Pixel items and WAV/OGG effects in configurable game bundles.']
  ]
};
