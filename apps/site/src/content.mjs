export const landingContent = {
  eyebrow: 'AI-native low-poly workbench',
  titleLines: ['Imagine a creature.', 'Bring it to life.'],
  summary:
    'Low-poly characters, made with your AI agent. Textured, animated, and ready for your game.',
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
      'Fetch and follow https://ashfox.io/workbench/agent-manifest.json using a direct HTTP request such as curl.'
  },
  formats: [
    ['Java block', 'Static blocks for Minecraft Java resource packs.'],
    ['GeckoLib 5', 'Animated models for Minecraft Java mods.'],
    ['Bedrock', 'Models, textures, and animation for Bedrock packs.'],
    ['GLB', 'One 3D file for game engines and viewers.'],
    ['glTF', 'Scene JSON with separate textures and binary data.']
  ]
};
