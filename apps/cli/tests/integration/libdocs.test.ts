'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const root = path.resolve(__dirname, '../../../..');
const cli = path.join(root, 'apps/cli/dist/ashfox.cjs');

const runCli = (args: string[], cwd = root) =>
  spawnSync(process.execPath, [cli, ...args], {
    cwd,
    encoding: 'utf8',
    timeout: 60000,
  });

const CANONICAL_TOPICS = [
  'agent',
  'grammar',
  'model',
  'rig',
  'surface',
  'animation',
  'vfx',
  'sprite',
  'sound',
  'structure',
  'hooks',
  'sdk',
] as const;

const testDocsCommand = (): void => {
  const textIndex = runCli(['docs']);
  assert.equal(textIndex.status, 0, textIndex.stderr);
  for (const topic of CANONICAL_TOPICS) {
    assert.ok(textIndex.stdout.includes(topic), `docs index missing topic ${topic}`);
  }

  const jsonIndex = runCli(['docs', '--json']);
  assert.equal(jsonIndex.status, 0, jsonIndex.stderr);
  const indexEnvelope = JSON.parse(jsonIndex.stdout) as {
    ok: boolean;
    command: string;
    result: { topics: readonly { topic: string; title: string; description: string }[] };
  };
  assert.equal(indexEnvelope.ok, true);
  assert.equal(indexEnvelope.command, 'docs');
  assert.deepEqual(
    indexEnvelope.result.topics.map((t) => t.topic),
    [...CANONICAL_TOPICS],
  );

  for (const topic of CANONICAL_TOPICS) {
    const textTopic = runCli(['docs', topic]);
    assert.equal(textTopic.status, 0, `docs ${topic} failed: ${textTopic.stderr}`);
    assert.ok(textTopic.stdout.trim().length > 100, `docs ${topic} unexpectedly short`);

    const jsonTopic = runCli(['docs', topic, '--json']);
    assert.equal(jsonTopic.status, 0, `docs ${topic} --json failed: ${jsonTopic.stderr}`);
    const parsed = JSON.parse(jsonTopic.stdout) as {
      ok: boolean;
      result: { topic: string; markdown: string };
    };
    assert.equal(parsed.ok, true);
    assert.equal(parsed.result.topic, topic);
    assert.equal(parsed.result.markdown.trim(), textTopic.stdout.trim());
  }

  const badTopic = runCli(['docs', 'grammr', '--json']);
  assert.equal(badTopic.status, 2);
  const badParsed = JSON.parse(badTopic.stdout) as {
    ok: boolean;
    diagnostics: readonly { code: string; message: string; hint?: string }[];
  };
  assert.equal(badParsed.ok, false);
  assert.equal(badParsed.diagnostics[0]?.code, 'docs.unknown-topic');
  assert.match(badParsed.diagnostics[0]?.message ?? '', /Did you mean "grammar"\?/);
  assert.equal(badParsed.diagnostics[0]?.hint, "Hint: run 'ashfox docs'");

  // Legacy alias must be rejected (no legacy aliases).
  const legacyMotion = runCli(['docs', 'motion']);
  assert.equal(legacyMotion.status, 2);
  assert.match(legacyMotion.stderr, /Hint: run 'ashfox docs'/);
};

const testLibraryAndStandaloneStd = (temp: string): void => {
  const nsText = runCli(['library', 'list'], temp);
  assert.equal(nsText.status, 0, nsText.stderr);
  assert.match(nsText.stdout, /std/);

  const nsJson = runCli(['library', 'list', '--json'], temp);
  assert.equal(nsJson.status, 0, nsJson.stderr);
  const nsParsed = JSON.parse(nsJson.stdout) as {
    ok: boolean;
    result: {
      namespaces: readonly { namespace: string; moduleCount: number; domains: string[] }[];
    };
  };
  const stdNs = nsParsed.result.namespaces.find((n) => n.namespace === 'std');
  assert.ok(stdNs && stdNs.moduleCount > 0, 'std namespace must bundle standard library modules');

  const allText = runCli(['library', 'std', 'list'], temp);
  assert.equal(allText.status, 0, allText.stderr);
  assert.match(allText.stdout, /model\/rig\/biped/);

  const soundJson = runCli(['library', 'std', 'list', 'sound', '--json'], temp);
  assert.equal(soundJson.status, 0, soundJson.stderr);
  const soundParsed = JSON.parse(soundJson.stdout) as {
    ok: boolean;
    result: { modules: readonly { module: string; specifier: string }[] };
  };
  assert.ok(soundParsed.result.modules.length > 0);
  assert.ok(soundParsed.result.modules.every((m) => m.module.startsWith('sound/')));

  const foleyJson = runCli(['library', 'std', 'list', 'sound/foley', '--json'], temp);
  assert.equal(foleyJson.status, 0, foleyJson.stderr);
  const foleyParsed = JSON.parse(foleyJson.stdout) as {
    result: { modules: readonly { module: string }[] };
  };
  assert.ok(foleyParsed.result.modules.length > 0);
  assert.ok(foleyParsed.result.modules.every((m) => m.module.startsWith('sound/foley/')));

  const showText = runCli(['library', 'std', 'show', 'model/rig/biped'], temp);
  assert.equal(showText.status, 0, showText.stderr);
  assert.match(showText.stdout, /^ashfox 1/m);

  const showJson = runCli(['library', 'std', 'show', 'model/rig/biped', '--json'], temp);
  assert.equal(showJson.status, 0, showJson.stderr);
  const showParsed = JSON.parse(showJson.stdout) as {
    ok: boolean;
    result: { specifier: string; source: string };
  };
  assert.equal(showParsed.result.specifier, 'std/model/rig/biped');
  assert.equal(showParsed.result.source.trim(), showText.stdout.trim());

  const badNs = runCli(['library', 'stdd', 'list', '--json'], temp);
  assert.equal(badNs.status, 2);
  const badNsJson = JSON.parse(badNs.stdout) as {
    diagnostics: readonly { message: string; hint?: string }[];
  };
  assert.match(badNsJson.diagnostics[0]?.message ?? '', /Did you mean "std"\?/);
  assert.equal(badNsJson.diagnostics[0]?.hint, "Hint: run 'ashfox library std list'");

  const badMod = runCli(['library', 'std', 'show', 'model/rig/bped', '--json'], temp);
  assert.equal(badMod.status, 2);
  const badModJson = JSON.parse(badMod.stdout) as {
    diagnostics: readonly { message: string; hint?: string }[];
  };
  assert.match(badModJson.diagnostics[0]?.message ?? '', /Did you mean "model\/rig\/biped"\?/);
  assert.equal(badModJson.diagnostics[0]?.hint, "Hint: run 'ashfox library std list'");

  // Eject with fail-closed default and --force override.
  const ejectDir = path.join(temp, 'ejected');
  const firstEject = runCli(
    ['library', 'std', 'eject', 'vfx/melee/slash', '--to', ejectDir, '--json'],
    temp,
  );
  assert.equal(firstEject.status, 0, firstEject.stderr);
  const ejectedPath = path.join(ejectDir, 'slash.ashfox');
  assert.equal(fs.existsSync(ejectedPath), true);

  const secondEject = runCli(
    ['library', 'std', 'eject', 'vfx/melee/slash', '--to', ejectDir],
    temp,
  );
  assert.equal(secondEject.status, 2);
  assert.match(secondEject.stderr, /already exists/);

  const forcedEject = runCli(
    ['library', 'std', 'eject', 'vfx/melee/slash', '--to', ejectDir, '--force', '--json'],
    temp,
  );
  assert.equal(forcedEject.status, 0, forcedEject.stderr);
  const forcedParsed = JSON.parse(forcedEject.stdout) as { result: { overwritten: boolean } };
  assert.equal(forcedParsed.result.overwritten, true);

  // Standalone file importing "std/..." must check cleanly via CLI.
  const standaloneDir = path.join(temp, 'standalone-std');
  fs.mkdirSync(standaloneDir, { recursive: true });
  const standaloneFile = path.join(standaloneDir, 'slash_demo.ashfox');
  const standaloneSource = [
    'ashfox 1',
    'vfx slash_demo {',
    '  import "std/vfx/melee/slash" as slash_pal;',
    '  duration = 0.65s;',
    '  fps = 30;',
    '  loop = once;',
    '  palette = slash_pal.CrimsonSlash;',
    '  element arc : slash_arc {',
    '    at = 0.08s..0.38s;',
    '    blend = additive;',
    '    radius = 7u..18u;',
    '    arc = -85deg..105deg;',
    '    pitch = 16deg;',
    '    crossed = true;',
    '    texture slash_streak { posterize = 4; bristles = 60%; seed = 11; }',
    '    dissolve directional_wipe { frames = 9; edge_glow = core; }',
    '    scale = 0.72 -> 1.08 ease_out -> 1.18;',
    '    alpha = 0.4 -> 1.0 snap -> 0.0 ease_in;',
    '  }',
    '  emitter sparks : voxel_burst {',
    '    at = 0.10s..0.60s;',
    '    seed = 42;',
    '    count = 28;',
    '    shape = cone(55deg, 3u);',
    '    particle = shard;',
    '    speed = 18u..34u;',
    '    life = 0.25s..0.52s;',
    '    gravity = -28u;',
    '    drag = 1.4;',
    '    size_over_life = 1.2u -> 0.9u -> 0u;',
    '    color_over_life = core -> mid -> edge;',
    '    blend = additive;',
    '  }',
    '}',
    '',
  ].join('\n');
  fs.writeFileSync(standaloneFile, standaloneSource);
  const checkStd = runCli(['check', standaloneFile], standaloneDir);
  assert.equal(checkStd.status, 0, checkStd.stdout + checkStd.stderr);
  const checkedParsed = JSON.parse(checkStd.stdout) as { ok: boolean; result: { kind: string } };
  assert.equal(checkedParsed.ok, true);
  assert.equal(checkedParsed.result.kind, 'vfx');

  // Stdin standalone check importing "std/..." must also succeed.
  const stdinCheck = spawnSync(
    process.execPath,
    [cli, 'check', '--stdin', '--name', 'slash.ashfox'],
    {
      cwd: standaloneDir,
      input: standaloneSource,
      encoding: 'utf8',
      timeout: 60000,
    },
  );
  assert.equal(stdinCheck.status, 0, stdinCheck.stdout + stdinCheck.stderr);
};

const main = (): void => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-libdocs-'));
  try {
    testDocsCommand();
    testLibraryAndStandaloneStd(temp);
    process.stdout.write('libdocs: ashfox docs, library, and standalone std imports passed\n');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
};

main();
