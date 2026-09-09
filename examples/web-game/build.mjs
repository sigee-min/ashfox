import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { cpSync, mkdirSync, rmSync } from 'node:fs';
const require = createRequire(import.meta.url);
const cli = process.env.ASHFOX_CLI ?? require.resolve('@ashfox/cli/dist/ashfox.cjs');
const built = JSON.parse(execFileSync(process.execPath, [cli, 'build', 'assets/.ashfoxworkspace'], { encoding: 'utf8' }));
if (!built.ok) throw new Error(JSON.stringify(built.diagnostics));
const pack = built.result.exports.find(e => e.id === 'voxel_game');
if (!pack) throw new Error('Missing voxel_game pack');
mkdirSync('public', { recursive: true });
// Mirror only the selected immutable runtime folder, never compiler receipts.
rmSync('public/game-assets', { recursive: true, force: true });
cpSync(`${pack.directory}/game-assets`, 'public/game-assets', { recursive: true, force: true });
process.stdout.write('Ready: public/game-assets/assets.json\n');
