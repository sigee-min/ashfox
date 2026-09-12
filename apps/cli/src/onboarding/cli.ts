import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { BuildFailure } from '@ashfox/asset-build';
import { findChrome } from './browser';

declare const ASHFOX_VERSION: string;
declare const ASHFOX_STARTER: Readonly<Record<string, string>>;
export const cliVersion = ASHFOX_VERSION;
export const isOnboardingCommand = (command: string): boolean =>
  ['help', '--help', '--version', 'doctor', 'init'].includes(command);
const help = `Ashfox ${ASHFOX_VERSION} — game assets from code

Start in your project folder:
  ashfox init my-game
  ashfox build my-game/.ashfoxworkspace.mjs --json

Commands:
  init <new-folder>        Create a grouped asset project offline
  doctor                  Check the CLI and optional Chrome/FFmpeg tools
  inspect <source|png>     Inspect an asset
  export <source>          Export GLB, PNG or WAV to stdout
  capture <source|png>     Capture a chosen view to stdout (requires Chrome)
  replay <source>         Render an animated GIF
  stdio                   Start a JSON-lines session
  check <source|workspace> Validate sources
  build <source|workspace> Build configured outputs
  verify <build-folder>    Verify a build
  capabilities            Print the complete machine-readable contract

--output <file> saves media; existing files are refused.
--version prints the installed product version. doctor/init accept --json.
Full options: https://ashfox.io/docs/guides/cli/
`;
const emit = (command: string, value: unknown, json: boolean, human: string): void => {
  process.stdout.write(json ? JSON.stringify({ format: 'ashfox-cli-result', version: 1, command,
    ok: true, diagnostics: [], result: value }) + '\n' : human);
};
const init = (folder: string, json: boolean): void => {
  const target = path.resolve(folder);
  const parent = path.dirname(target);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw new BuildFailure('init.parent', 'The parent folder must already exist.', 2);
  }
  // Exclusive directory creation refuses existing folders and symlinks, even empty ones.
  try { fs.mkdirSync(target); }
  catch (error) { throw new BuildFailure('init.destination', `Choose a new folder; nothing was changed. ${error instanceof Error ? error.message : String(error)}`, 2); }
  try {
    for (const [name, source] of Object.entries(ASHFOX_STARTER)) {
      fs.mkdirSync(path.dirname(path.join(target, name)), { recursive: true });
      fs.writeFileSync(path.join(target, name), source, { flag: 'wx' });
    }
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    throw error;
  }
  emit('init', { directory: target, files: Object.keys(ASHFOX_STARTER), version: cliVersion }, json,
      `Created asset project in ${folder}\nSources: asset/ · Generated output: build/\nBuild: ashfox build ${folder}/.ashfoxworkspace.mjs --json\nIntegration: node ${folder}/assets.mjs\n`);
};
const doctor = (json: boolean): void => {
  const chrome = findChrome();
  const browser = chrome ? spawnSync(chrome, ['--version'], { timeout: 5000, encoding: 'utf8' }) : undefined;
  const encoder = process.env.ASHFOX_FFMPEG_PATH || 'ffmpeg';
  const ffmpeg = spawnSync(encoder, ['-hide_banner', '-encoders'], { timeout: 5000, encoding: 'utf8', maxBuffer: 1024 * 1024 });
  const capture = browser?.status === 0;
  const ogg = ffmpeg.status === 0 && /\blibvorbis\b/.test(ffmpeg.stdout);
  emit('doctor', { version: cliVersion, node: process.version, platform: process.platform, arch: process.arch,
    exports: { glb: true, png: true, wav: true }, capture: { available: capture, executable: chrome ?? null },
    ogg: { available: ogg, executable: encoder } }, json,
    `Ashfox ${cliVersion} · Node ${process.version}\nGLB / PNG / WAV: ready\nCapture: ${capture ? 'ready' : 'optional — install Chrome or set ASHFOX_CHROME_PATH'}\nOGG: ${ogg ? 'ready' : 'optional — install FFmpeg with libvorbis or set ASHFOX_FFMPEG_PATH'}\n`);
};
export const runOnboarding = (args: readonly string[]): boolean => {
  const command = args[0] ?? 'help';
  if (!isOnboardingCommand(command)) return false;
  if (['help', '--help', '--version'].includes(command)) {
    if (args.length > 1) throw new BuildFailure('cli.arguments', 'Unexpected argument', 2);
    process.stdout.write(command === '--version' ? cliVersion + '\n' : help);
    return true;
  }
  const rest = args.slice(1);
  if (rest.filter(arg => arg === '--json').length > 1 || rest.some(arg => arg.startsWith('--') && arg !== '--json')) {
    throw new BuildFailure('cli.arguments', 'Only --json is supported for this command.', 2);
  }
  const positional = rest.filter(arg => arg !== '--json');
  if (positional.length !== (command === 'init' ? 1 : 0)) throw new BuildFailure('cli.arguments', command === 'init' ? 'Usage: ashfox init <new-folder> [--json]' : 'Usage: ashfox doctor [--json]', 2);
  if (command === 'init') init(positional[0], rest.includes('--json')); else doctor(rest.includes('--json'));
  return true;
};
