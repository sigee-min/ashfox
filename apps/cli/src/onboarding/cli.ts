import * as fs from 'node:fs';
import * as path from 'node:path';
import { spawnSync } from 'node:child_process';
import { AUDIO_POLICY } from '@ashfox/audio-core';
import { BuildFailure } from '@ashfox/asset-build';
import { renderCapabilities } from '../observe/operations';
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
  doctor                  Check runtime readiness and machine-readable contract
  check <input>            Validate sources/builds, inspect structure, and run quality audit
  render <source|png>      Render PNG images, turnaround sheets, or animated GIFs (--gif)
  build <source|workspace> Build configured outputs and verify quality gates
  export <source>          Export GLB, glTF, Minecraft ZIP, PNG, or WAV directly

--output <file> saves media; existing files are refused.
--version prints the installed product version. doctor/init accept --json.
Full options: https://ashfox.io/docs/guides/cli/
`;
export const formatCliResult = (
  command: string,
  ok: boolean,
  result: unknown,
  diagnostics: readonly unknown[] = [],
): string =>
  JSON.stringify({
    format: 'ashfox-cli-result',
    version: 1,
    command,
    ok,
    diagnostics,
    result,
  }) + '\n';

const emit = (command: string, value: unknown, json: boolean, human: string): void => {
  process.stdout.write(json ? formatCliResult(command, true, value) : human);
};
const init = (folder: string, json: boolean): void => {
  const target = path.resolve(folder);
  const parent = path.dirname(target);
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory()) {
    throw new BuildFailure('init.parent', 'The parent folder must already exist.', 2);
  }
  // Exclusive directory creation refuses existing folders and symlinks, even empty ones.
  try {
    fs.mkdirSync(target);
  } catch (error) {
    throw new BuildFailure(
      'init.destination',
      `Choose a new folder; nothing was changed. ${error instanceof Error ? error.message : String(error)}`,
      2,
    );
  }
  try {
    for (const [name, source] of Object.entries(ASHFOX_STARTER)) {
      fs.mkdirSync(path.dirname(path.join(target, name)), { recursive: true });
      fs.writeFileSync(path.join(target, name), source, { flag: 'wx' });
    }
  } catch (error) {
    fs.rmSync(target, { recursive: true, force: true });
    throw error;
  }
  emit(
    'init',
    { directory: target, files: Object.keys(ASHFOX_STARTER), version: cliVersion },
    json,
    `Created asset project in ${folder}\nSources: asset/ · Generated output: build/\nBuild: ashfox build ${folder}/.ashfoxworkspace.mjs --json\nIntegration: node ${folder}/assets.mjs\n`,
  );
};
const doctor = (json: boolean): void => {
  const chrome = findChrome();
  const browser = chrome
    ? spawnSync(chrome, ['--version'], { timeout: 5000, encoding: 'utf8' })
    : undefined;
  const capture = browser?.status === 0;
  emit(
    'doctor',
    {
      version: cliVersion,
      cliVersion,
      node: process.version,
      platform: process.platform,
      arch: process.arch,
      commands: ['init', 'doctor', 'check', 'render', 'build', 'export'],
      exports: { glb: true, png: true, wav: true, ogg: true },
      capture: { available: capture, executable: chrome ?? null },
      ogg: { available: true, builtin: true },
      render: renderCapabilities,
      workspace: {
        file: '.ashfoxworkspace',
        executableFile: '.ashfoxworkspace.mjs',
        version: 2,
        required: false,
      },
      sound: {
        contract: AUDIO_POLICY,
        sources: ['noise', 'fm', 'vocal', 'chirp', 'resonator'],
        features: ['curves', 'sequences', 'variation', 'loops'],
        sampleRate: 48000,
        channels: 1,
        loopCodecs: ['wav'],
        output: 'fixed-gain',
        limits: {
          durationSeconds: 30,
          variants: 8,
          workspaceSources: 32,
          workspaceRawFrames: 11520000,
          eventFrames: 24000000,
          weightedFrames: 192000000,
        },
      },
      source: '.ashfox',
      outputs: ['glb', 'png', 'wav', 'java_block', 'geckolib5', 'bedrock'],
      packs: {
        formats: ['minecraft_java', 'game_assets'],
        itemDefinitions: ['legacy', 'modern'],
        metadata: ['legacy', 'range'],
        audio: 'vorbis',
        encoder: 'Built-in WebAssembly Ogg Vorbis (libvorbis)',
        archive: 'zip',
      },
      usage:
        'ashfox init <dir>; ashfox doctor; ashfox check <input> [options]; ashfox render <source|png> [options]; ashfox build <source|workspace>; ashfox export <source> [options]',
    },
    json,
    `Ashfox ${cliVersion} · Node ${process.version}\nGLB / PNG / WAV / OGG: ready (built-in)\nRender (Chrome): ${capture ? 'ready' : 'optional — install Chrome or set ASHFOX_CHROME_PATH'}\n`,
  );
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
  if (
    rest.filter((arg) => arg === '--json').length > 1 ||
    rest.some((arg) => arg.startsWith('--') && arg !== '--json')
  ) {
    throw new BuildFailure('cli.arguments', 'Only --json is supported for this command.', 2);
  }
  const positional = rest.filter((arg) => arg !== '--json');
  if (positional.length !== (command === 'init' ? 1 : 0))
    throw new BuildFailure(
      'cli.arguments',
      command === 'init'
        ? 'Usage: ashfox init <new-folder> [--json]'
        : 'Usage: ashfox doctor [--json]',
      2,
    );
  if (command === 'init') init(positional[0], rest.includes('--json'));
  else doctor(rest.includes('--json'));
  return true;
};
