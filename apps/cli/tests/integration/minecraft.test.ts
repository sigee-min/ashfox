'use strict';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { spawnSync } from 'node:child_process';
const root = path.resolve(__dirname, '../../../..');
const temp = fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()), 'ashfox-minecraft-'));
const run = (command: string, input: string) => {
  const child = spawnSync(
    process.execPath,
    [path.join(__dirname, '../../dist/ashfox.cjs'), command, input, '--json'],
    { encoding: 'utf8', timeout: 120000 },
  );
  if (child.error) throw child.error;
  assert.equal(child.signal, null, child.stderr);
  return JSON.parse(String(child.stdout));
};
const success = (result: ReturnType<typeof run>) => {
  assert.equal(result.ok, true, JSON.stringify(result));
  return result.result;
};
const copyShowcase = (destination: string) =>
  fs.cpSync(path.join(root, 'showcase'), destination, {
    recursive: true,
    filter: (file) =>
      !file.split(path.sep).some((part) => part === 'dist' || part === '.ashfox-cache'),
  });
const read = (file: string) => JSON.parse(String(fs.readFileSync(file, 'utf8')));
const write = (file: string, value: unknown) =>
  fs.writeFileSync(file, JSON.stringify(value, null, 2));
try {
  const block = path.join(temp, 'block');
  copyShowcase(block);
  const config = path.join(block, '.ashfoxworkspace');
  const blockCfg = read(config);
  blockCfg.exports = [
    {
      name: 'marker',
      entry: { packageName: 'models', entryName: 'rune_bricks' },
      format: 'java_block',
      namespace: 'demo',
      modelPath: 'props/marker',
      directory: 'dist/marker',
    },
  ];
  blockCfg.packs = [];
  write(config, blockCfg);
  const first = success(run('build', config));
  const output = first.exports[0].directory;
  assert.ok(read(path.join(output, 'pack.mcmeta')).pack);
  const blockstate = read(path.join(output, 'assets/demo/blockstates/props/marker.json'));
  assert.equal(blockstate.variants[''].model, 'demo:block/props/marker');
  const model = read(path.join(output, 'assets/demo/models/block/props/marker.json'));
  assert.ok(model.elements.length);
  for (const resource of Object.values(model.textures)) {
    assert.ok(typeof resource === 'string');
    const resolved = resource.startsWith('#') ? model.textures[resource.slice(1)] : resource;
    const [namespace, location] = resolved.split(':');
    const png = fs.readFileSync(
      path.join(output, 'assets', namespace, 'textures', location + '.png'),
    );
    assert.equal(png.subarray(1, 4).toString(), 'PNG');
    assert.ok(png.readUInt32BE(16) > 0);
  }
  assert.equal(success(run('check', path.join(block, 'dist/build'))).bundleHash, first.bundleHash);
  const cold = path.join(temp, 'cold');
  copyShowcase(cold);
  write(path.join(cold, '.ashfoxworkspace'), blockCfg);
  assert.equal(
    success(run('build', path.join(cold, '.ashfoxworkspace'))).bundleHash,
    first.bundleHash,
  );
  const original = read(config),
    current = path.join(block, 'dist/build/current.json'),
    pointer = fs.readFileSync(current);
  for (const change of [
    (e: { namespace?: string }) => {
      delete e.namespace;
    },
    (e: { namespace?: string }) => {
      e.namespace = '../bad';
    },
    (e: { modelPath: string }) => {
      e.modelPath = '../bad';
    },
    (e: { extra: boolean }) => {
      e.extra = true;
    },
  ]) {
    const invalid = structuredClone(original);
    change(invalid.exports[0]);
    write(config, invalid);
    assert.equal(run('build', config).ok, false);
    assert.deepEqual(fs.readFileSync(current), pointer);
  }
  write(config, original);
  // Animated native models must retain clips in actor targets, and fail for Java blocks.
  const actors = path.join(temp, 'actors');
  copyShowcase(actors);
  const bedrockActorPath = path.join(actors, 'assets/models/bedrock_actor.ashfox');
  fs.writeFileSync(
    bedrockActorPath,
    `ashfox 1
model bedrock_actor {
  rig contract ActorRig {
    joint root { parent = none; role = root; channels = rotation; }
    joint body { parent = root; role = torso; channels = rotation; }
    joint head { parent = body; role = head; channels = rotation; }
    joint arm_l { parent = body; role = arm; channels = rotation; }
    joint arm_r { parent = body; role = arm; channels = rotation; }
  }
  skeleton ActorSkel implements ActorRig {
    bind root { parent_origin = (0u, 0u, 0u); }
    bind body { parent_origin = (0u, 8u, 0u); }
    bind head { parent_origin = (0u, 18u, 0u); }
    bind arm_l { parent_origin = (-5u, 16u, 0u); }
    bind arm_r { parent_origin = (5u, 16u, 0u); }
  }
  surface contract ActorSkin {
    chart base box { coverage = opaque; }
    chart torso box { coverage = opaque; }
    chart head box { coverage = opaque; }
    chart arm box { coverage = opaque; }
    material = opaque;
  }
  surface skin: ActorSkin {
    material = opaque;
    texture atlas {
      density = 2;
      background = bg; background_alpha = 255;
      palette {
        bg = #141820;
        stone = (#48515e, #667282, #8996a8);
        body = (#3d526b, #5a7799, #7ea1c9);
        gold = (#8c621c, #c9922c, #f0c254);
      }
      chart base box { fill = stone; roughness = 0.80; grain = soft; pattern border { paint = gold; width = 1px; edges = all; } pattern ao { strength = 0.35; radius = 0.6u; } }
      chart torso box { fill = body; roughness = 0.72; grain = soft; pattern gradient { to = stone; axis = y; space = local; soft = 0.25; } pattern ao { strength = 0.35; radius = 0.6u; } }
      chart head box { fill = gold; roughness = 0.32; metallic = 0.85; grain = none; pattern border { paint = stone; width = 1px; edges = all; } }
      chart arm box { fill = body; roughness = 0.72; grain = soft; pattern gradient { to = gold; axis = y; space = local; soft = 0.25; } }
      grain soft { seed = 91; }
      tone painterly;
    }
  }
  component Actor {
    requires rig skeleton: ActorRig;
    requires surface coat: ActorSkin;
    bind bone root to skeleton.root;
    bind bone body to skeleton.body;
    bind bone head to skeleton.head;
    bind bone arm_l to skeleton.arm_l;
    bind bone arm_r to skeleton.arm_r;
    geometry {
      bone root {
        cube plinth { origin = (-5u, 0u, -5u); size = (10u, 8u, 10u); surface = coat.base; }
        bone body {
          cube chest { origin = (-4u, 8u, -3u); size = (8u, 10u, 6u); surface = coat.torso; }
          bone head { cube skull { origin = (-3u, 18u, -3u); size = (6u, 6u, 6u); surface = coat.head; } }
          bone arm_l { cube limb_l { origin = (-7u, 10u, -1.5u); size = (3u, 8u, 3u); surface = coat.arm; } }
          bone arm_r { cube limb_r { origin = (4u, 10u, -1.5u); size = (3u, 8u, 3u); surface = coat.arm; } }
        }
      }
    }
  }
  motion idle for ActorRig {
    duration = 2s; fps = 24; loop = loop; rest_relative = true;
    track head.rotation { key 0s = (0deg, 0deg, 0deg) linear; key 1s = (0deg, 8deg, 0deg) linear; key 2s = (0deg, 0deg, 0deg) linear; }
  }
  settings { density = 16; forward = north; profile = prop; }
  skeleton = ActorSkel;
  motions = [idle];
  use Actor as actor { skeleton = ActorRig; coat = skin; }
}
`,
  );
  const actorConfig = path.join(actors, '.ashfoxworkspace'),
    workspace = read(actorConfig);
  workspace.packages
    .find((p: { name: string }) => p.name === 'models')
    .manifest.entries.push({
      name: 'bedrock_actor',
      path: 'bedrock_actor.ashfox',
    });
  workspace.exports = ['geckolib5', 'bedrock'].map((format) => ({
    name: format,
    format,
    namespace: 'demo',
    modelPath: 'creatures/bedrock_actor',
    directory: 'dist/' + format,
    entry: { packageName: 'models', entryName: 'bedrock_actor' },
  }));
  workspace.packs = [];
  write(actorConfig, workspace);
  const built = success(run('build', actorConfig));
  for (const target of built.exports) {
    const catalog = read(built.catalogPath).assets.find((a: { id: string }) => a.id === target.id);
    assert.ok(catalog.metadata.clips.length);
    const geometry = catalog.files.find((f: { path: string }) => f.path.endsWith('.geo.json'));
    const animation = catalog.files.find((f: { path: string }) =>
      f.path.endsWith('.animation.json'),
    );
    assert.ok(read(path.join(built.bundlePath, geometry.path))['minecraft:geometry'].length);
    assert.ok(Object.keys(read(path.join(built.bundlePath, animation.path)).animations).length);
    assert.ok(catalog.files.some((f: { path: string }) => f.path.endsWith('.png')));
  }
  success(run('check', path.join(actors, 'dist/build')));
  const actorPointer = fs.readFileSync(path.join(actors, 'dist/build/current.json'));
  workspace.exports[0].format = 'java_block';
  workspace.exports[0].entry = { packageName: 'models', entryName: 'griffin_boss' };
  write(actorConfig, workspace);
  assert.equal(run('build', actorConfig).ok, false);
  assert.deepEqual(fs.readFileSync(path.join(actors, 'dist/build/current.json')), actorPointer);
  workspace.exports[0].entry = { packageName: 'sprites', entryName: 'iron_sword' };
  write(actorConfig, workspace);
  assert.equal(run('check', actorConfig).ok, false);
  console.log(
    'Minecraft CLI: static Java pack, PNG references, animated GeckoLib/Bedrock, cold reproducibility and atomic rejection ok',
  );
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
