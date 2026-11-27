// Project-owned build policy. Keep IDs stable when moving source files.
const groups = [
  {
    name: 'models',
    root: 'assets/models',
    format: 'glb',
    entries: [
      { name: 'red_fox', path: 'red_fox.ashfox' },
      { name: 'wall_lantern', path: 'wall_lantern.ashfox' },
    ],
    modules: [],
    dependencies: [{ name: 'fox_fur' }],
  },
  {
    name: 'fox_fur',
    root: 'assets/module/fox',
    format: 'glb',
    entries: [],
    modules: [{ subpath: './fur', path: 'fox_fur.ashfox' }],
  },
  {
    name: 'items',
    root: 'assets/sprites',
    format: 'png',
    entries: [{ name: 'iron_sword', path: 'iron_sword.ashfox' }],
    modules: [],
  },
  {
    name: 'sounds',
    root: 'assets/sounds',
    format: 'wav',
    entries: [{ name: 'claw_hit', path: 'claw_hit.ashfox' }],
    modules: [],
  },
  {
    name: 'structures',
    root: 'assets/structures',
    format: 'glb',
    entries: [{ name: 'blacksmith', path: 'blacksmith.ashfox' }],
    modules: [],
  },
];

export default {
  format: 'ashfox-workspace',
  version: 2,
  name: 'game-assets',
  packages: groups.map((group) => ({
    name: group.name,
    root: group.root,
    manifest: {
      format: 'ashfox-package',
      version: 1,
      entries: group.entries,
      modules: group.modules,
      dependencies: group.dependencies ?? [],
    },
  })),
  include: ['assets/**/*.ashfox'],
  ignore: ['build/**'],
  build: { directory: 'build/assets/compiler' },
  exports: groups.flatMap((group) =>
    group.entries.map((entry) => ({
      name: `${group.name}_${entry.name}`,
      entry: { packageName: group.name, entryName: entry.name },
      format: group.format,
      directory: `build/assets/exports/${group.name}/${entry.name}`,
    })),
  ),
};
