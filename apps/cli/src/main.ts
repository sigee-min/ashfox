import { AUDIO_POLICY } from '@ashfox/audio-core';
import { runOnboarding, cliVersion, isOnboardingCommand } from './onboarding/cli';
import { runObservation } from './observe/cli';
import { prepare } from './observe/prepare';
import { observationCapabilities } from './observe/session';
import { isMainThread, parentPort, workerData } from 'node:worker_threads';
import { runWorker } from './worker';
import * as fs from 'node:fs';
import * as crypto from 'node:crypto';
import * as os from 'node:os';
import {
  readSnapshot, checkSnapshot, compileNodeBundle, verifyCurrent, BuildFailure,
  publishBundle, withOutputLocks, type Snapshot, type CompiledBundle
} from '@ashfox/asset-build';

process.stdout.on('error', error => { if ('code' in error && error.code === 'EPIPE') { controller.abort(); process.exitCode = 130; } });
const controller = new AbortController();
const cancel = (): void => controller.abort();
if (isMainThread) { process.on('SIGINT', cancel); process.on('SIGTERM', cancel); }
const args = process.argv.slice(2), command = args[0] ?? 'help';
const result = (ok: boolean, value: unknown, diagnostics: readonly unknown[] = []): void => {
  process.stdout.write(JSON.stringify({ format: 'ashfox-cli-result', version: 1,
    command, ok, diagnostics, result: value }) + '\n');
};
const main = async (): Promise<void> => {
  if (runOnboarding(args)) return;
  if (['inspect','capture','replay','export','stdio'].includes(command)) { await runObservation(args,__filename,controller.signal); return; }
  if (args.filter(a => a === '--json').length > 1 || args.some(a => a.startsWith('--') && a !== '--json')) {
    throw new BuildFailure('cli.arguments', 'Only --json is supported; shared configuration belongs to .ashfoxworkspace or .ashfoxworkspace.mjs', 2);
  }
  const positional = args.slice(1).filter(a => a !== '--json');
  if (command === 'capabilities') {
    if (positional.length) throw new BuildFailure('cli.arguments', 'Unexpected argument', 2);
    result(true, { cliVersion, commands: ['init', 'doctor', 'check', 'build', 'verify', 'capabilities', 'inspect', 'capture', 'replay', 'export', 'stdio'], observation: observationCapabilities, workspace: { file: '.ashfoxworkspace', executableFile: '.ashfoxworkspace.mjs', version: 2, required: false },
      sound: { contract: AUDIO_POLICY, sources: ['noise', 'fm', 'vocal', 'chirp', 'resonator'], features: ['curves', 'sequences', 'variation', 'loops'], sampleRate: 48000, channels: 1, loopCodecs: ['wav'], output: 'fixed-gain', limits: { durationSeconds: 30, variants: 8, workspaceSources: 32, workspaceRawFrames: 11520000, eventFrames: 24000000, weightedFrames: 192000000 } },
      source: '.ashfox', outputs: ['glb', 'png', 'wav', 'java_block', 'geckolib5', 'bedrock'], legacyFallback: false,
      packs: { formats: ['minecraft_java', 'game_assets'], itemDefinitions: ['legacy', 'modern'], metadata: ['legacy', 'range'], audio: 'vorbis', encoder: 'FFmpeg via PATH or ASHFOX_FFMPEG_PATH', archive: 'zip' },
      usage: 'ashfox check|build <source|workspace>; ashfox verify <build-directory>; ashfox inspect|capture|replay|export <source|png> [options]; ashfox stdio' });
    return;
  }
  if (!['check', 'build', 'verify'].includes(command) || positional.length !== 1) {
    throw new BuildFailure('cli.arguments', 'Expected check|build .ashfox source or optional workspace, or verify build-directory', 2);
  }
  if (command === 'verify') { result(true, verifyCurrent(positional[0])); return; }
  const snapshot = readSnapshot(positional[0]);
  if (command === 'check') {
    result(true, await runWorker(__filename, snapshot, '', 'check', controller.signal));
    return;
  }
  const toolchain = JSON.stringify({ code: crypto.createHash('sha256').update(fs.readFileSync(__filename)).digest('hex'),
    node: process.version, v8: process.versions.v8, platform: os.platform(), arch: os.arch() });
  const published = await withOutputLocks(snapshot, async () => {
    const bundle = await runWorker(__filename, snapshot, toolchain, 'build', controller.signal);
    if (!('bundleHash' in bundle)) throw new BuildFailure('build.worker', 'Missing bundle', 3);
    if (controller.signal.aborted) throw new BuildFailure('build.cancelled', 'Build cancelled', 130);
    return publishBundle(snapshot, bundle);
  });
  result(true, published);
};
const executeWorker = async (): Promise<void> => {
  if (workerData.observe) {
    try { parentPort!.postMessage({ok:true,value:prepare(workerData.observe)}); }
    catch(error) { parentPort!.postMessage({ok:false,message:error instanceof Error?error.message:String(error),code:error instanceof BuildFailure?error.code:'observe.compile',exitCode:error instanceof BuildFailure?error.exitCode:1}); }
    return;
  }
  const input = workerData as { snapshot: Snapshot; toolchain: string; command: string };
  try {
    let value: CompiledBundle | { sourceHash: string; products: readonly unknown[] };
    if (input.command === 'check') {
      const checked = checkSnapshot(input.snapshot);
      value = { sourceHash: checked.sourceHash, products: checked.products.map(p => ({ kind: p.kind, entry: p.entry })) };
    } else value = await compileNodeBundle(input.snapshot, input.toolchain, controller.signal);
    parentPort!.postMessage({ ok: true, value });
  } catch (error) {
    parentPort!.postMessage({ ok: false, message: error instanceof Error ? error.message : String(error),
      code: error instanceof BuildFailure ? error.code : 'build.failure', exitCode: error instanceof BuildFailure ? error.exitCode : 3 });
  }
};
if (!isMainThread) { parentPort!.on('message', message => { if (message === 'cancel') controller.abort(); }); void executeWorker(); }
else void main().catch((error: unknown) => {
  const failure = error instanceof BuildFailure ? error : new BuildFailure('build.failure', error instanceof Error ? error.message : String(error), 3);
  if (isOnboardingCommand(command) && !args.includes('--json')) process.stderr.write(`ashfox: ${failure.message}\n`);
  else if (['inspect','capture','replay','export','stdio'].includes(command)) process.stderr.write(JSON.stringify({ok:false,error:{code:failure.code,message:failure.message}})+'\n');
  else result(false, null, [{ severity: 'error', code: failure.code, message: failure.message }]);
  process.exitCode = failure.exitCode;
}).finally(() => { process.off('SIGINT', cancel); process.off('SIGTERM', cancel); });
