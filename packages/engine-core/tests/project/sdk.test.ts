import assert from 'node:assert/strict';
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import ts from 'typescript';
import * as THREE from 'three';
import {
  SDK_GENERATORS,
  SDK_TARGETS,
  generateAllRuntimeSdks,
  generateRuntimeSdk,
  readDirectoryWorkspace,
  type SdkManifestInput,
} from '../../src';

const REPO_ROOT = path.resolve(__dirname, '../../../..');

const SAMPLE_MANIFEST: SdkManifestInput = {
  name: 'demo',
  assets: [
    {
      id: 'creature.goblin',
      kind: 'model',
      model: 'models/goblin.glb',
      hooks: 'models/goblin.hooks.json',
      clips: [{ name: 'flame_cleave', durationSeconds: 1.0 }],
      colliders: {
        profile: 'creature',
        aabb: { min: [-0.5, 0, -0.5], max: [0.5, 1.8, 0.5] },
        colliders: [
          { shape: 'capsule', axis: 'y', center: [0, 0.9, 0], radius: 0.45, height: 1.8 },
        ],
      },
    },
    {
      id: 'vfx.flame_arc',
      kind: 'vfx',
      model: 'vfx/flame_arc.glb',
      vfxSpec: 'vfx/flame_arc.vfx.json',
    },
    {
      id: 'sfx.fire_loop',
      kind: 'sound',
      codec: 'ogg',
      variants: [
        {
          id: 'base',
          file: 'audio/fire_loop.ogg',
          durationSeconds: 1.0,
          sampleRate: 48000,
          channels: 2,
          playback: { kind: 'loop', startFrame: 4800, endFrame: 48000 },
          loopStartSample: 4800,
          loopEndSample: 48000,
        },
      ],
    },
  ],
};

// 1. Strategy map, deterministic generation, and manifest IDs.
{
  assert.deepEqual(SDK_TARGETS, ['three', 'unity', 'godot']);
  assert.deepEqual(Object.keys(SDK_GENERATORS), ['three', 'unity', 'godot']);
  const first = generateAllRuntimeSdks(SAMPLE_MANIFEST);
  const second = generateAllRuntimeSdks(SAMPLE_MANIFEST);
  assert.deepEqual(first, second);
  assert.equal(first.three[0]?.fileName, 'ashfox-three.ts');
  assert.match(
    first.three[0]!.content,
    /ASHFOX_GENERATED_ASSET_IDS = \["creature\.goblin","vfx\.flame_arc","sfx\.fire_loop"\]/,
  );
  assert.deepEqual(
    first.unity.map((f) => f.fileName),
    ['AshfoxRuntime.cs', 'AshfoxAssetActor.cs'],
  );
  assert.deepEqual(
    first.godot.map((f) => f.fileName),
    ['ashfox_runtime.gd', 'ashfox_actor.gd'],
  );
}

// 2. Closed `.ashfoxworkspace` sdk field validation.
{
  const baseCfg = {
    format: 'ashfox-workspace',
    version: 2,
    name: 'sdk_ws',
    packages: [
      {
        name: 'models',
        root: 'assets/models',
        manifest: {
          format: 'ashfox-package',
          version: 1,
          entries: [{ name: 'box', path: 'box.ashfox' }],
          modules: [],
          dependencies: [],
        },
      },
    ],
    include: ['assets/**/*.ashfox'],
    ignore: [],
    build: { directory: 'dist/build' },
    exports: [],
  };
  assert.equal(readDirectoryWorkspace(JSON.stringify(baseCfg)).sdk, undefined);
  assert.deepEqual(readDirectoryWorkspace(JSON.stringify({ ...baseCfg, sdk: [] })).sdk, []);
  assert.deepEqual(
    readDirectoryWorkspace(JSON.stringify({ ...baseCfg, sdk: ['three', 'godot'] })).sdk,
    ['three', 'godot'],
  );
  assert.throws(() => readDirectoryWorkspace(JSON.stringify({ ...baseCfg, sdk: ['unreal'] })));
  assert.throws(() =>
    readDirectoryWorkspace(JSON.stringify({ ...baseCfg, sdk: ['three', 'three'] })),
  );
  assert.throws(() => readDirectoryWorkspace(JSON.stringify({ ...baseCfg, sdk: 'three' })));
}

// 3. Compile generated ashfox-three.ts with strict TypeScript (`tsc --noEmit`).
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ashfox-sdk-three-'));
const threeSource = generateRuntimeSdk('three', SAMPLE_MANIFEST)[0]!.content;
const threeFile = path.join(temp, 'ashfox-three.ts');
fs.writeFileSync(threeFile, threeSource, 'utf8');

const compileGeneratedThree = (): void => {
  const compilerOptions: ts.CompilerOptions = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    strict: true,
    noImplicitAny: true,
    strictNullChecks: true,
    noUnusedLocals: true,
    noUnusedParameters: true,
    noEmit: true,
    skipLibCheck: true,
    esModuleInterop: true,
    lib: ['lib.es2022.d.ts', 'lib.dom.d.ts'],
    baseUrl: REPO_ROOT,
    paths: {
      three: ['node_modules/@types/three/index.d.ts'],
      'three/examples/jsm/loaders/GLTFLoader.js': [
        'node_modules/@types/three/examples/jsm/loaders/GLTFLoader.d.ts',
      ],
      'three/examples/jsm/libs/meshopt_decoder.module.js': [
        'node_modules/@types/three/examples/jsm/libs/meshopt_decoder.module.d.ts',
      ],
      'meshoptimizer/decoder': ['node_modules/meshoptimizer/meshopt_decoder.d.ts'],
    },
  };
  const program = ts.createProgram([threeFile], compilerOptions);
  const diagnostics = ts.getPreEmitDiagnostics(program);
  assert.equal(
    diagnostics.length,
    0,
    diagnostics.map((d) => ts.flattenDiagnosticMessageText(d.messageText, '\n')).join('\n'),
  );
};

// 4. Execute generated ashfox-three.ts against a mock Three.js scene!
const runThreeRuntimeExecutionTest = async (): Promise<void> => {
  const transpiled = ts.transpileModule(threeSource, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.CommonJS,
      esModuleInterop: true,
    },
  });
  const jsFile = path.join(temp, 'ashfox-three.cjs');
  fs.writeFileSync(jsFile, transpiled.outputText, 'utf8');
  const repoRequire = createRequire(path.join(REPO_ROOT, 'package.json'));
  const mod = { exports: {} as Record<string, unknown> };
  const fn = new Function(
    'exports',
    'require',
    'module',
    '__filename',
    '__dirname',
    transpiled.outputText,
  );
  fn(mod.exports, repoRequire, mod, jsFile, temp);
  const sdkMod = mod.exports as {
    createAshfoxRuntime: (opts: Record<string, unknown>) => {
      spawn: (
        id: string,
        opts?: Record<string, unknown>,
      ) => Promise<{
        id: string;
        root: THREE.Object3D;
        lod?: THREE.LOD;
        colliders?: { profile: string };
        getAnchor: (name: string) => THREE.Object3D | undefined;
        play: (clip: string) => THREE.AnimationAction | null;
        onCue: (
          name: string,
          cb: (cue: {
            name: string;
            worldPosition: number[];
            data: Record<string, unknown>;
          }) => void,
        ) => () => void;
      }>;
      update: (dt: number) => void;
      dispose: () => void;
    };
  };

  const goblinGroup = new THREE.Group();
  goblinGroup.name = 'goblin';
  goblinGroup.userData = { ashfox: { lod: { distances: [0, 12, 30] } } };
  const lod0 = new THREE.Mesh(
    new THREE.BoxGeometry(1, 1, 1),
    new THREE.MeshBasicMaterial({
      userData: { ashfoxBlendMode: 'additive', KHR_materials_unlit: {} },
    }),
  );
  lod0.name = 'goblin_LOD0';
  const lod1 = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  lod1.name = 'goblin_LOD1';
  const anchorTip = new THREE.Object3D();
  anchorTip.name = 'anchor_weapon_tip';
  anchorTip.position.set(1, 2, 3);
  goblinGroup.add(lod0, lod1, anchorTip);

  const clip = new THREE.AnimationClip('flame_cleave', 1.0, []);
  clip.userData = {
    ashfoxLoop: 'once',
    ashfoxCues: [
      {
        kind: 'event',
        time: 0.1,
        name: 'melee_hitbox',
        anchor: 'weapon_tip',
        payload: { damage: 45 },
      },
      { kind: 'vfx', time: 0.2, name: 'vfx.flame_arc', anchor: 'weapon_tip' },
      { kind: 'sound', time: 0.3, name: 'sfx.fire_loop', anchor: 'weapon_tip' },
    ],
  };

  const vfxGroup = new THREE.Group();
  const vfxClip = new THREE.AnimationClip('flame_arc', 0.4, []);

  const mockLoader = {
    setMeshoptDecoder: () => mockLoader,
    loadAsync: async (url: string) => {
      if (url.includes('flame_arc')) return { scene: vfxGroup, animations: [vfxClip] };
      return { scene: goblinGroup, animations: [clip] };
    },
  };

  const cues: Array<{ name: string; worldPosition: number[]; data: Record<string, unknown> }> = [];
  const vfxEvents: Array<{ id: string; anchor?: string }> = [];
  const soundEvents: Array<{ id: string; loop: boolean; loopStart: number; loopEnd: number }> = [];

  const mockFetch = async (url: string) => {
    if (url.endsWith('goblin.hooks.json')) {
      return new Response(
        JSON.stringify({
          schemaVersion: 1,
          assetId: 'goblin',
          anchors: [
            {
              id: 'back_slot',
              schema: 'std.slot',
              position: [16, 32, 0],
              normal: [0, 1, 0],
              rotation: [0, 0, 0],
              props: {},
            },
          ],
          colliders: SAMPLE_MANIFEST.assets[0]!.colliders,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    return new Response(null, { status: 404 });
  };

  const scene = new THREE.Scene();
  const runtime = sdkMod.createAshfoxRuntime({
    scene,
    manifest: SAMPLE_MANIFEST,
    loader: mockLoader,
    fetchFn: mockFetch,
    onVfxSpawn: (ev: { id: string; anchor?: string }) => vfxEvents.push(ev),
    onSoundPlay: (ev: { id: string; loop: boolean; loopStart: number; loopEnd: number }) =>
      soundEvents.push(ev),
  });

  const actor = await runtime.spawn('creature.goblin', { position: [4, 0, -2] });
  assert.ok(actor.lod instanceof THREE.LOD);
  assert.equal(actor.lod.levels.length, 2);
  assert.equal((lod0.material as THREE.MeshBasicMaterial).blending, THREE.AdditiveBlending);
  assert.equal(actor.getAnchor('weapon_tip'), anchorTip);
  assert.ok(actor.getAnchor('back_slot'));
  assert.equal(actor.colliders?.profile, 'creature');

  actor.onCue('melee_hitbox', (cue) => cues.push(cue));
  assert.ok(actor.play('flame_cleave'));

  runtime.update(0.15);
  assert.equal(cues.length, 1);
  assert.deepEqual(cues[0]!.worldPosition, [5, 2, 1]);
  assert.equal(cues[0]!.data.damage, 45);

  runtime.update(0.1);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(vfxEvents.length, 1);
  assert.equal(vfxEvents[0]!.id, 'vfx.flame_arc');
  assert.equal(vfxEvents[0]!.anchor, 'anchor_weapon_tip');

  runtime.update(0.1);
  await new Promise((r) => setTimeout(r, 10));
  assert.equal(soundEvents.length, 1);
  assert.equal(soundEvents[0]!.loop, true);
  assert.equal(soundEvents[0]!.loopStart, 0.1);
  assert.equal(soundEvents[0]!.loopEnd, 1.0);

  runtime.dispose();
};

// 5. Unity C# & Godot 4 GDScript syntax sanity.
{
  const unity = generateRuntimeSdk('unity', SAMPLE_MANIFEST);
  const csRuntime = unity.find((f) => f.fileName === 'AshfoxRuntime.cs')!.content;
  const csActor = unity.find((f) => f.fileName === 'AshfoxAssetActor.cs')!.content;
  for (const src of [csRuntime, csActor]) {
    const opens = (src.match(/\{/g) ?? []).length;
    const closes = (src.match(/\}/g) ?? []).length;
    assert.equal(opens, closes);
  }
  assert.match(csActor, /CapsuleCollider/);
  assert.match(csActor, /OnAshfoxEventCue/);

  const godot = generateRuntimeSdk('godot', SAMPLE_MANIFEST);
  const gdRuntime = godot.find((f) => f.fileName === 'ashfox_runtime.gd')!.content;
  const gdActor = godot.find((f) => f.fileName === 'ashfox_actor.gd')!.content;
  assert.match(gdRuntime, /class_name AshfoxRuntime/);
  assert.match(gdRuntime, /LOOPSTART/);
  assert.match(gdRuntime, /LOOPLENGTH/);
  assert.match(gdActor, /signal cue_triggered/);
  assert.match(gdActor, /Marker3D/);
  assert.match(gdActor, /CollisionShape3D/);
  const scanSection = gdActor.slice(gdActor.indexOf('func _scan_anchor_nodes'));
  const scanBody = scanSection.slice(0, scanSection.indexOf('\nfunc '));
  assert.doesNotMatch(scanBody, /add_child|_marker/);
  assert.match(scanBody, /anchors\[node\.name\.substr\(7\)\] = node/);
}

compileGeneratedThree();
const p = runThreeRuntimeExecutionTest().finally(() =>
  fs.rmSync(temp, { recursive: true, force: true }),
);
(
  globalThis as { __ashfoxEngineTestPromises?: Promise<unknown>[] }
).__ashfoxEngineTestPromises?.push(p);
