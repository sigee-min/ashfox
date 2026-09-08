export const landingContent = {
  eyebrow: 'AI-native low-poly workbench',
  titleLines: ['Describe it.', 'Ship it game-ready.'],
  summary:
    'Create Minecraft-style models, textures, and animation with your AI agent. Refine them in the browser, then export for your game.',
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
        summary: 'A fantasy guardian with six animations.'
      },
      {
        packageName: 'creatures',
        entryName: 'fox',
        index: '02',
        label: 'Red fox',
        summary: 'Ember fur, a bright chest, and a gentle idle.'
      },
      {
        packageName: 'creatures',
        entryName: 'goblin',
        index: '03',
        label: 'Goblin raider',
        summary: 'A scarred raider with iron armor, shield, and blade.'
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

export const sectionOrder = [
  'overview',
  'guides'
];

export const sectionLabels = {
  overview: 'Start here',
  guides: 'Guides'
};

export const documentationOrder = [
  '/docs/',
  '/docs/guides/ai-agent-quick-start/',
  '/docs/guides/authoring-and-review/',
  '/docs/guides/save-and-export/',
  '/docs/guides/choose-a-format/',
  '/docs/guides/troubleshooting/'
];
