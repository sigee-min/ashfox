import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../docs');
const registry = JSON.parse(fs.readFileSync(path.join(root, 'locales.json')));
const sources = JSON.parse(fs.readFileSync(path.join(root, 'public.json'))).flatMap(section => section.pages.map(page => page.source));
const digest = source => createHash('sha256').update(fs.readFileSync(path.join(root, source))).digest('hex');
const [command = '--check', code, source] = process.argv.slice(2);
if (!['--check', '--acknowledge'].includes(command)) throw new Error('Use --check or --acknowledge <locale> <source.md>');
if (command === '--acknowledge') {
  if (!registry.locales.some(locale => locale.code === code && code !== registry.default) || !sources.includes(source)) {
    throw new Error('Select a registered translation locale and public source');
  }
  const directory = path.join(root, 'translations', code);
  if (!fs.statSync(path.join(directory, source)).isFile()) throw new Error('Write the translated document first');
  const file = path.join(directory, 'revisions.json');
  const revisions = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {};
  revisions[source] = digest(source);
  fs.writeFileSync(file, JSON.stringify(Object.fromEntries(Object.entries(revisions).sort()), null, 2) + '\n');
}
for (const locale of registry.locales.filter(locale => locale.code !== registry.default)) {
  const directory = path.join(root, 'translations', locale.code);
  const file = path.join(directory, 'revisions.json');
  const revisions = fs.existsSync(file) ? JSON.parse(fs.readFileSync(file)) : {};
  const walk = dir => fs.existsSync(dir) ? fs.readdirSync(dir, {withFileTypes:true}).flatMap(entry =>
    entry.isDirectory() ? walk(path.join(dir, entry.name)) : entry.name.endsWith('.md') ? [path.relative(directory, path.join(dir, entry.name)).split(path.sep).join('/')] : []) : [];
  for (const source of new Set([...Object.keys(revisions), ...walk(directory)])) {
    if (!sources.includes(source) || !/^[a-f0-9]{64}$/.test(revisions[source] ?? '') || !fs.existsSync(path.join(directory, source))) {
      throw new Error(`Unregistered/missing translation or revision: ${locale.code}/${source}`);
    }
  }
  const stale = sources.filter(source => revisions[source] && revisions[source] !== digest(source));
  console.log(`${locale.code}: ${Object.keys(revisions).length}/${sources.length} translated, ${stale.length} stale, ${sources.length - Object.keys(revisions).length} English fallbacks`);
  for (const source of stale) console.log(`UPDATE ${locale.code}/${source}`);
}
