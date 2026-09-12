// Project-owned build policy. Keep IDs stable when moving source files.
const groups = [
  { name: 'creatures', root: 'asset/creatures/fox', format: 'glb',
    entries: [{ name: 'fox', path: 'fox.ashfox' }],
    modules: ['body', 'surface', 'rig'] },
  { name: 'items', root: 'asset/items', format: 'png',
    entries: [{ name: 'iron_sword', path: 'sword.ashfox' }], modules: ['shared'] },
  { name: 'sounds', root: 'asset/sounds', format: 'wav',
    entries: [{ name: 'claw_hit', path: 'claw_hit.ashfox' }], modules: [] },
];

export default {
  format: 'ashfox-workspace', version: 2, name: 'game-assets',
  packages: groups.map(group => ({
    name: group.name, root: group.root,
    manifest: { format: 'ashfox-package', version: 1, entries: group.entries,
      modules: group.modules.map(name => ({ subpath: `./${name}`, path: `${name}.ashfox` })),
      dependencies: [] },
  })),
  include: ['asset/**/*.ashfox'], ignore: ['build/**'],
  build: { directory: 'build/assets/compiler' },
  exports: groups.flatMap(group => group.entries.map(entry => ({
    name: `${group.name}_${entry.name}`,
    entry: { packageName: group.name, entryName: entry.name },
    format: group.format,
    directory: `build/assets/exports/${group.name}/${entry.name}`,
  }))),
};
