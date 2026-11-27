import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import {
  decodeVorbis,
  readGameAssetManifest,
  readSnapshot,
  readVorbisComments,
} from '@ashfox/asset-build';

const root = path.resolve(__dirname, '../../../..');
const cli = path.join(root, 'apps/cli/dist/ashfox.cjs');

const runCli = (args: string[]) =>
  spawnSync(process.execPath, [cli, ...args], {
    encoding: 'utf8',
    timeout: 120000,
  });

const testCliHints = (temp: string): void => {
  const badSprite = path.join(temp, 'bad.ashfox');
  fs.writeFileSync(
    badSprite,
    'ashfox 1\nsprite bad {\n  canvs = (16, 16);\n  rect r { from = (0px, 0px); to = (16px, 16px); color = #ffffff; }\n}\n',
  );
  const textRun = runCli(['check', badSprite]);
  assert.notEqual(textRun.status, 0);
  assert.match(textRun.stderr, /Did you mean "canvas"\?/);
  assert.match(textRun.stderr, /Hint: run 'ashfox docs sprite'/);

  const jsonRun = runCli(['check', badSprite, '--json']);
  assert.notEqual(jsonRun.status, 0);
  const parsed = JSON.parse(jsonRun.stdout) as {
    ok: boolean;
    diagnostics: readonly { code: string; message: string; hint?: string }[];
  };
  assert.equal(parsed.ok, false);
  assert.ok(parsed.diagnostics.length > 0);
  assert.equal(parsed.diagnostics[0]!.hint, "Hint: run 'ashfox docs sprite'");
};

const testGaplessOggLoop = async (temp: string): Promise<void> => {
  const loopDir = path.join(temp, 'ogg-loop');
  fs.mkdirSync(loopDir, { recursive: true });
  const soundPath = path.join(loopDir, 'fire_loop.ashfox');
  fs.copyFileSync(path.join(root, 'showcase/assets/sounds/fire_loop.ashfox'), soundPath);
  const baseConfig = readSnapshot(soundPath).config;
  const configPath = path.join(loopDir, '.ashfoxworkspace');
  fs.writeFileSync(
    configPath,
    JSON.stringify({
      ...baseConfig,
      packs: [
        {
          name: 'game',
          format: 'game_assets',
          directory: 'dist/game',
          archive: false,
          audio: 'ogg',
          unitsPerMeter: 16,
          pixelsPerUnit: 16,
          spriteFilter: 'nearest',
          assets: [{ id: 'sfx.fire', source: 'fire_loop', path: 'sounds/fire' }],
        },
      ],
    }),
  );

  const built = runCli(['build', configPath, '--json']);
  assert.equal(built.status, 0, built.stdout + built.stderr);
  const envelope = JSON.parse(built.stdout) as { result: { bundlePath: string } };
  const manifestPath = path.join(envelope.result.bundlePath, 'assets/game/game-assets/assets.json');
  const manifest = readGameAssetManifest(JSON.parse(fs.readFileSync(manifestPath, 'utf8')));
  const sound = manifest.assets[0];
  assert.ok(sound && sound.kind === 'sound');
  assert.equal(sound.codec, 'ogg');
  for (const variant of sound.variants) {
    assert.equal(variant.sampleRate, 48000);
    assert.equal(variant.playback.kind, 'loop');
    assert.equal(variant.loopStartSample, 0);
    assert.equal(variant.loopEndSample, 111360);
    const oggBytes = fs.readFileSync(
      path.join(envelope.result.bundlePath, 'assets/game/game-assets', variant.file),
    );
    const comments = readVorbisComments(oggBytes);
    assert.equal(comments.LOOPSTART, '0');
    assert.equal(comments.LOOPLENGTH, '111360');
    const decoded = await decodeVorbis(oggBytes);
    assert.equal(decoded.channels, variant.channels);
    assert.ok(decoded.samples.length > 0);
  }
};

const waitForUrl = (child: ReturnType<typeof spawn>): Promise<string> =>
  new Promise((resolve, reject) => {
    let buffer = '';
    const timer = setTimeout(
      () => reject(new Error(`Timed out waiting for dev server: ${buffer}`)),
      30000,
    );
    child.stdout?.setEncoding('utf8');
    child.stdout?.on('data', (chunk: string) => {
      buffer += chunk;
      const match = /http:\/\/127\.0\.0\.1:\d+/.exec(buffer);
      if (match) {
        clearTimeout(timer);
        resolve(match[0]);
      }
    });
    child.once('exit', (code) => {
      clearTimeout(timer);
      reject(new Error(`ashfox dev exited early (${code}): ${buffer}`));
    });
  });

const testDevWatchAndInspect = async (temp: string): Promise<void> => {
  const devDir = path.join(temp, 'dev-watch');
  fs.mkdirSync(devDir, { recursive: true });
  const modelPath = path.join(devDir, 'wall_lantern.ashfox');
  fs.copyFileSync(path.join(root, 'showcase/assets/models/wall_lantern.ashfox'), modelPath);
  const child = spawn(process.execPath, [cli, 'dev', modelPath, '--port', '0', '--no-open'], {
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let aborted = false;
  try {
    const baseUrl = await waitForUrl(child);
    const htmlRes = await fetch(baseUrl);
    assert.equal(htmlRes.status, 200);
    assert.match(await htmlRes.text(), /Ashfox Dev/);

    const stateRes = await fetch(`${baseUrl}/api/state`);
    assert.equal(stateRes.status, 200);
    const state = (await stateRes.json()) as {
      ok: boolean;
      revision: number;
      kind: string;
      auditScore: number | null;
      inspectRefs: readonly { symbol: string; sourceRef: string }[];
    };
    assert.equal(state.ok, true);
    assert.equal(state.kind, 'model');
    assert.ok(typeof state.auditScore === 'number');
    assert.ok(state.inspectRefs.length > 0);

    const inspectRes = await fetch(`${baseUrl}/api/inspect`);
    assert.equal(inspectRes.status, 200);
    const inspectJson = (await inspectRes.json()) as {
      refs: readonly {
        symbol: string;
        sourceRef: string;
        position?: readonly number[];
        dims?: readonly number[];
      }[];
    };
    assert.ok(inspectJson.refs.some((r) => r.sourceRef.includes('wall_lantern.ashfox:')));
    assert.ok(inspectJson.refs.some((r) => Boolean(r.position && r.dims)));

    const sseAbort = new AbortController();
    const sseRes = await fetch(`${baseUrl}/events`, { signal: sseAbort.signal });
    assert.equal(sseRes.status, 200);
    const reader = sseRes.body!.getReader();
    const decoder = new TextDecoder();

    const first = await reader.read();
    assert.match(decoder.decode(first.value), /ready/);

    const original = fs.readFileSync(modelPath, 'utf8');
    fs.writeFileSync(modelPath, `${original}\n// live reload edit\n`);

    let updatedRevision = state.revision;
    for (let i = 0; i < 6; i++) {
      const next = await reader.read();
      const text = decoder.decode(next.value ?? new Uint8Array());
      if (text.includes('"kind":"update"')) {
        const afterRes = await fetch(`${baseUrl}/api/state`);
        const after = (await afterRes.json()) as { revision: number; auditDelta: number | null };
        updatedRevision = after.revision;
        assert.ok(typeof after.auditDelta === 'number');
        break;
      }
    }
    sseAbort.abort();
    assert.ok(updatedRevision > state.revision);

    aborted = true;
    const exitCode = await new Promise<number | null>((resolve) => {
      child.once('exit', resolve);
      child.kill('SIGTERM');
    });
    assert.ok(exitCode === 0 || exitCode === 130 || exitCode === null);
  } finally {
    if (!aborted && !child.killed) child.kill('SIGKILL');
  }
};

const main = async (): Promise<void> => {
  const temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ashfox-dxdev-'));
  try {
    testCliHints(temp);
    await testGaplessOggLoop(temp);
    await testDevWatchAndInspect(temp);
    process.stdout.write('dxdev: hints, gapless OGG loops, and live dev watch passed\n');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
};

void main();
