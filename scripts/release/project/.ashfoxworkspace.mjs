// Project-owned build policy. Keep IDs stable when moving source files.
const groups = [
  { name: 'creatures', root: 'assets/models/fox', format: 'glb',
    entries: [{ name: 'fox', path: 'fox.ashfox' }],
    modules: ['body', 'surface', 'rig'] },
  { name: 'items', root: 'assets/sprites', format: 'png',
    entries: [{ name: 'iron_sword', path: 'sword.ashfox' }], modules: [] },
  { name: 'sounds', root: 'assets/sounds', format: 'wav',
    entries: [{ name: 'claw_hit', path: 'claw_hit.ashfox' }], modules: [] },
  { name: 'structures', root: 'assets/structures', format: 'glb',
    entries: [{ name: 'watchtower', path: 'watchtower.ashfox' }], modules: [] },
  { name: 'props', root: 'assets/models/props', format: 'glb',
    entries: [], modules: ['wall_lantern', 'rune_pillar'] },
  { name: 'shared', root: 'assets/module', format: 'png',
    entries: [], modules: ['shared', 'furnishings'] },
];

export default {
  format: 'ashfox-workspace', version: 2, name: 'game-assets',
  packages: groups.map(group => ({
    name: group.name, root: group.root,
    manifest: { format: 'ashfox-package', version: 1, entries: group.entries,
      modules: group.modules.map(name => ({ subpath: `./${name}`, path: `${name}.ashfox` })),
      dependencies: [] },
  })),
  include: ['assets/**/*.ashfox'], ignore: ['build/**'],
  build: { directory: 'build/assets/compiler' },
  exports: groups.flatMap(group => group.entries.map(entry => ({
    name: `${group.name}_${entry.name}`,
    entry: { packageName: group.name, entryName: entry.name },
    format: group.format,
    directory: `build/assets/exports/${group.name}/${entry.name}`,
  }))),
};
