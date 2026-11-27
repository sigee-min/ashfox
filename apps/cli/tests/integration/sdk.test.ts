import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

const REPO_ROOT = path.resolve(__dirname, '../../../..');
const CLI = path.join(REPO_ROOT, 'apps/cli/dist/ashfox.cjs');

const runCli = (...args: string[]) =>
  spawnSync(process.execPath, [CLI, ...args], {
    encoding: 'utf8',
    timeout: 120000,
    maxBuffer: 32 * 1024 * 1024,
  });

const makeWorkspaceConfig = (sdk?: readonly string[]): string =>
  JSON.stringify(
    {
      format: 'ashfox-workspace',
      version: 2,
      name: 'sdk_cli_test',
      packages: [
        {
          name: 'models',
          root: 'assets/models',
          manifest: {
            format: 'ashfox-package',
            version: 1,
            entries: [{ name: 'wall_lantern', path: 'wall_lantern.ashfox' }],
            modules: [],
            dependencies: [],
          },
        },
        {
          name: 'sounds',
          root: 'assets/sounds',
          manifest: {
            format: 'ashfox-package',
            version: 1,
            entries: [{ name: 'fire_loop', path: 'fire_loop.ashfox' }],
            modules: [],
            dependencies: [],
          },
        },
      ],
      include: ['assets/**/*.ashfox'],
      ignore: [],
      build: { directory: 'dist/build' },
      exports: [
        {
          name: 'wall_lantern',
          entry: { packageName: 'models', entryName: 'wall_lantern' },
          format: 'glb',
          directory: 'dist/models',
        },
        {
          name: 'fire_loop',
          entry: { packageName: 'sounds', entryName: 'fire_loop' },
          format: 'wav',
          directory: 'dist/sounds',
        },
      ],
      ...(sdk ? { sdk } : {}),
    },
    null,
    2,
  );

const main = (): void => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-sdk-cli-'));
  try {
    const wsDir = path.join(temp, 'ws');
    fs.mkdirSync(path.join(wsDir, 'assets/models'), { recursive: true });
    fs.mkdirSync(path.join(wsDir, 'assets/sounds'), { recursive: true });
    fs.copyFileSync(
      path.join(REPO_ROOT, 'showcase/assets/models/wall_lantern.ashfox'),
      path.join(wsDir, 'assets/models/wall_lantern.ashfox'),
    );
    fs.copyFileSync(
      path.join(REPO_ROOT, 'showcase/assets/sounds/fire_loop.ashfox'),
      path.join(wsDir, 'assets/sounds/fire_loop.ashfox'),
    );
    const wsPath = path.join(wsDir, '.ashfoxworkspace');
    fs.writeFileSync(wsPath, makeWorkspaceConfig());

    // 1. CLI --sdk three,unity,godot emits all 5 files deterministically into <buildDir>/sdk/.
    const buildA = runCli('build', wsPath, '--sdk', 'three,unity,godot', '--json');
    assert.equal(buildA.status, 0, buildA.stdout + buildA.stderr);
    const parsedA = JSON.parse(buildA.stdout) as { ok: boolean; result: { sdk: string[] } };
    assert.equal(parsedA.ok, true);
    const sdkDir = path.join(wsDir, 'dist/build/sdk');
    const filesA = fs.readdirSync(sdkDir).sort();
    assert.deepEqual(filesA, [
      'AshfoxAssetActor.cs',
      'AshfoxRuntime.cs',
      'ashfox-three.ts',
      'ashfox_actor.gd',
      'ashfox_runtime.gd',
    ]);
    const threeTextA = fs.readFileSync(path.join(sdkDir, 'ashfox-three.ts'), 'utf8');
    assert.match(threeTextA, /createAshfoxRuntime/);
    assert.match(threeTextA, /wall_lantern/);

    // 2. Reversed CLI order (--sdk godot,three) yields byte-identical output.
    const buildB = runCli('build', wsPath, '--sdk', 'godot,three', '--json');
    assert.equal(buildB.status, 0, buildB.stdout + buildB.stderr);
    assert.equal(fs.readFileSync(path.join(sdkDir, 'ashfox-three.ts'), 'utf8'), threeTextA);

    // 3. `ashfox check <buildDir>` succeeds alongside generated sdk/ files.
    const checkBuild = runCli('check', path.join(wsDir, 'dist/build'), '--json');
    assert.equal(checkBuild.status, 0, checkBuild.stdout + checkBuild.stderr);

    // 4. `.ashfoxworkspace` `sdk` array field triggers SDK generation without --sdk flag.
    const wsCfgDir = path.join(temp, 'ws_cfg');
    fs.cpSync(wsDir, wsCfgDir, { recursive: true, filter: (p) => !p.includes('dist') });
    const wsCfgPath = path.join(wsCfgDir, '.ashfoxworkspace');
    fs.writeFileSync(wsCfgPath, makeWorkspaceConfig(['three', 'godot']));
    const buildCfg = runCli('build', wsCfgPath, '--json');
    assert.equal(buildCfg.status, 0, buildCfg.stdout + buildCfg.stderr);
    assert.deepEqual(fs.readdirSync(path.join(wsCfgDir, 'dist/build/sdk')).sort(), [
      'ashfox-three.ts',
      'ashfox_actor.gd',
      'ashfox_runtime.gd',
    ]);

    // 5. Invalid --sdk target fails with exit code 2.
    const badSdk = runCli('build', wsPath, '--sdk', 'unreal', '--json');
    assert.equal(badSdk.status, 2);

    // 6. `ashfox docs sdk` & `ashfox doctor --json` expose SDK topic and targets.
    const docRes = runCli('docs', 'sdk', '--json');
    assert.equal(docRes.status, 0, docRes.stderr);
    const docParsed = JSON.parse(docRes.stdout) as { ok: boolean; result: { markdown: string } };
    assert.equal(docParsed.ok, true);
    assert.match(docParsed.result.markdown, /createAshfoxRuntime/);

    const doctorRes = runCli('doctor', '--json');
    assert.equal(doctorRes.status, 0, doctorRes.stderr);
    const doctorParsed = JSON.parse(doctorRes.stdout) as {
      result: { sdk: { targets: string[] }; usage: string };
    };
    assert.deepEqual(doctorParsed.result.sdk.targets, ['three', 'unity', 'godot']);
    assert.match(doctorParsed.result.usage, /--sdk three\|unity\|godot/);

    console.log('ashfox runtime SDK CLI integration tests ok');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
};

main();
