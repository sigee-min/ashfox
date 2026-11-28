import assert from 'node:assert/strict';
import {
  compileDirectoryWorkspace,
  compileProjectBundle,
  openAssetProject,
  readExportAdapterInput,
} from '../../src';
import {
  IDENTITY_QUAT,
  quatAngleDeg,
  quatFromEulerXyzDeg,
  slerpQuat,
} from '../../src/animation/quat';
import { bakeClip } from '../../src/animation/bake';
import type { Quat, Vec3 } from '../../src/animation/contract';
import { buildModelLod1Document } from '../../src/export/targets/gltf/modelLod';
import { optimizeGltfAnimationSamples } from '../../src/export/targets/gltf/samples';

const workspaceConfig = JSON.stringify({
  format: 'ashfox-workspace',
  version: 2,
  name: 'anim_pipe',
  packages: [
    {
      name: 'anim_pipe',
      root: 'assets/models',
      manifest: {
        format: 'ashfox-package',
        version: 1,
        dependencies: [],
        entries: [{ name: 'creature', path: 'creature.ashfox' }],
        modules: [],
      },
    },
  ],
  include: ['assets/**/*.ashfox'],
  ignore: [],
  build: { directory: 'dist/build' },
  exports: [],
});

const SOURCE = `ashfox 1
model creature {
  rig contract Rig {
    handedness = right;
    joint root { parent = none; role = root; channels = (position, rotation, scale); }
    joint pelvis { parent = root; role = pelvis; channels = (position, rotation, scale); }
    joint torso { parent = pelvis; role = body; channels = (rotation, scale); limits { pitch = -35deg..45deg; } }
    joint head { parent = torso; role = head; channels = rotation; }
    joint thigh_l { parent = pelvis; role = leg; channels = rotation; mirror = thigh_r; }
    joint shin_l { parent = thigh_l; role = leg; channels = rotation; mirror = shin_r; }
    joint thigh_r { parent = pelvis; role = leg; channels = rotation; mirror = thigh_l; }
    joint shin_r { parent = thigh_r; role = leg; channels = rotation; mirror = shin_l; }
    joint tail_1 { parent = pelvis; role = tail; channels = rotation; }
    joint tail_2 { parent = tail_1; role = tail; channels = rotation; }

    chain tail = [tail_1, tail_2];
    ik_limb left_leg { chain = [thigh_l, shin_l]; pole = (0, 0, -1); ground = 0u; }
    ik_limb right_leg { chain = [thigh_r, shin_r]; pole = (0, 0, -1); ground = 0u; mirror = left_leg; }
    anchor weapon_tip { joint = head; offset = (0u, 2u, -4u); }
  }

  skeleton Skel implements Rig {
    bind root { parent_origin = (0u, 0u, 0u); }
    bind pelvis { parent_origin = (0u, 8u, 0u); }
    bind torso { parent_origin = (0u, 4u, 0u); }
    bind head { parent_origin = (0u, 5u, 0u); }
    bind thigh_l { parent_origin = (-2u, 0u, 0u); }
    bind shin_l { parent_origin = (0u, -4u, 0u); }
    bind thigh_r { parent_origin = (2u, 0u, 0u); }
    bind shin_r { parent_origin = (0u, -4u, 0u); }
    bind tail_1 { parent_origin = (0u, 1u, 3u); }
    bind tail_2 { parent_origin = (0u, 0u, 4u); }
  }

  surface contract Skin {
    chart body box { coverage = opaque; }
    chart limb box { coverage = opaque; }
    material = opaque;
  }

  surface skin : Skin {
    material = opaque;
    texture atlas {
      atlas = (64px, 64px);
      density = 1;
      background = fur;
      background_alpha = 255;
      palette { fur = (#6e4219, #8b5a2b, #ab7644); }
      chart body box { fill = fur; grain = none; }
      chart limb box { fill = fur; grain = none; }
    }
  }

  component Body {
    requires rig rig_port : Rig;
    requires surface skin_port : Skin;
    bind bone root to rig_port.root;
    bind bone pelvis to rig_port.pelvis;
    bind bone torso to rig_port.torso;
    bind bone head to rig_port.head;
    bind bone thigh_l to rig_port.thigh_l;
    bind bone shin_l to rig_port.shin_l;
    bind bone thigh_r to rig_port.thigh_r;
    bind bone shin_r to rig_port.shin_r;
    bind bone tail_1 to rig_port.tail_1;
    bind bone tail_2 to rig_port.tail_2;
    geometry {
      bone root {
        bone pelvis {
          cube hip { origin = (-2u, 6u, -2u); size = (4u, 4u, 4u); surface = skin_port.body; }
          bone torso { cube chest { origin = (-2u, 10u, -2u); size = (4u, 4u, 4u); surface = skin_port.body; } }
          bone head { cube skull { origin = (-2u, 14u, -2u); size = (4u, 4u, 4u); surface = skin_port.body; } }
          bone thigh_l { cube ul { origin = (-3u, 4u, -1u); size = (2u, 4u, 2u); surface = skin_port.limb; } }
          bone shin_l { cube ll { origin = (-3u, 0u, -1u); size = (2u, 4u, 2u); surface = skin_port.limb; } }
          bone thigh_r { cube ur { origin = (1u, 4u, -1u); size = (2u, 4u, 2u); surface = skin_port.limb; } }
          bone shin_r { cube lr { origin = (1u, 0u, -1u); size = (2u, 4u, 2u); surface = skin_port.limb; } }
          bone tail_1 { cube t1 { origin = (-1u, 7u, 2u); size = (2u, 4u, 2u); surface = skin_port.limb; } }
          bone tail_2 { cube t2 { origin = (-1u, 7u, 6u); size = (2u, 4u, 2u); surface = skin_port.limb; } }
        }
      }
    }
  }

  motion attack for Rig {
    duration = 0.8s;
    fps = 30;
    loop = once;
    rest_relative = true;

    pose windup { torso.rotation = (-18deg, -20deg, 0deg); head.rotation = (6deg, 14deg, 0deg); }
    pose strike { torso.rotation = (28deg, 24deg, 0deg); head.rotation = (-10deg, -18deg, 0deg); }

    at 0.0s pose windup smooth;
    at 0.3s pose windup anticipate(0.35);
    at 0.45s pose strike snap;
    at 0.8s pose windup ease_out;

    track pelvis.position {
      key 0.0s = (0u, 0u, 0u) smooth;
      key 0.35s = (0u, -0.8u, -0.5u) ease_in_out;
      key 0.55s = (0u, 0.4u, -1.2u) overshoot(0.2);
      key 0.8s = (0u, 0u, 0u) ease_out;
    }

    wave torso.rotation.x = breath(0.8s, inhale = 0.42) * 3deg;
    ik left_leg { foot_lock = 0.0s..0.38s; }
    secondary chain tail { stiffness = 18; damping = 0.32; gravity = 0.3; }
    squash pelvis { at = 0.46s; duration = 0.16s; axis = y; amount = -0.15; }
    hitstop { at = 0.45s; hold = 0.05s; shake = 0.25u; }
    recoil torso { at = 0.47s; impulse = (-10deg, 0deg, 0deg); decay = 0.18s; }

    cue 0.42s sound "slash_swing" at weapon_tip;
    cue 0.45s..0.52s event "hitbox" { damage = 20; };
  }

  settings { density = 16; forward = north; profile = creature; }
  skeleton = Skel;
  motions = [attack];
  use Body { rig_port = Rig; skin_port = skin; }
}
`;

const compiled = compileDirectoryWorkspace(workspaceConfig, [
  { path: 'assets/models/creature.ashfox', source: SOURCE },
]);
assert.equal(compiled.ok, true, compiled.ok ? '' : JSON.stringify(compiled.diagnostics));
if (compiled.ok) {
  const product = compiled.products[0]!;
  assert.equal(product.kind, 'model');
  if (product.kind === 'model') {
    const clip = Object.values(product.model.animations)[0]!;
    assert.equal(clip.name, 'attack');
    assert.ok((clip.cues?.length ?? 0) >= 2, 'expected sound & hitbox cues preserved');
    const rotCh = Object.values(clip.channels).find((c) => c.property === 'rotation');
    assert.ok(
      rotCh && rotCh.keys.every((k) => k.quaternion !== undefined),
      'expected unit quaternions',
    );
    const posCh = Object.values(clip.channels).find((c) => c.property === 'position');
    assert.ok(posCh && posCh.keys.length >= 2, 'expected unlocked position channel');

    const opened = openAssetProject({
      workspace: product.workspace,
      entry: product.entry,
      identity: { id: 'test', revision: 'rev1', createdAt: '2000-01-01T00:00:00.000Z' },
    });
    assert.equal(opened.ok, true);
    if (opened.ok) {
      const adapter = readExportAdapterInput({ target: 'gltf', modelPath: 'creature' });
      const bundle = compileProjectBundle(opened.project, adapter);
      const gltfFile = bundle.files.find((f) => f.kind === 'json' && f.path.endsWith('.gltf'));
      assert.ok(gltfFile && gltfFile.kind === 'json');
      const gltf = gltfFile.data as { animations?: { extras?: { ashfoxCues?: unknown[] } }[] };
      assert.ok(
        (gltf.animations?.[0]?.extras?.ashfoxCues?.length ?? 0) >= 2,
        'expected ashfoxCues in glTF',
      );
    }
  }
}

console.log('animation end-to-end pipeline ok');

// Multi-turn glTF sample retention never exceeds 61 deg per chord & preserves 90/180/270 deg poses
const spinWs = JSON.stringify({
  format: 'ashfox-workspace',
  version: 2,
  name: 'spin_pipe',
  packages: [
    {
      name: 'spin_pipe',
      root: 'assets/models',
      manifest: {
        format: 'ashfox-package',
        version: 1,
        dependencies: [],
        entries: [{ name: 'spinner', path: 'spinner.ashfox' }],
        modules: [],
      },
    },
  ],
  include: ['assets/**/*.ashfox'],
  ignore: [],
  build: { directory: 'dist/build' },
  exports: [],
});

const SPIN_SOURCE = `ashfox 1
model spinner {
  rig contract Rig {
    handedness = right;
    joint root { parent = none; role = root; channels = (position, rotation); }
    joint rotor { parent = root; role = prop; channels = rotation; }
    joint turbine { parent = root; role = prop; channels = rotation; }
    joint wheel { parent = root; role = prop; channels = rotation; }
    joint spine { parent = root; role = body; channels = rotation; }
    joint arm_tip { parent = spine; role = arm; channels = rotation; }
    joint decor_a { parent = root; role = prop; channels = rotation; }
    joint decor_b { parent = root; role = prop; channels = rotation; }
    joint decor_c { parent = root; role = prop; channels = rotation; }
  }
  skeleton Skel implements Rig {
    bind root { parent_origin = (0u, 0u, 0u); }
    bind rotor { parent_origin = (0u, 8u, 0u); }
    bind turbine { parent_origin = (0u, 4u, 0u); }
    bind wheel { parent_origin = (0u, 2u, 0u); }
    bind spine { parent_origin = (0u, 4u, 0u); }
    bind arm_tip { parent_origin = (2u, 2u, 0u); }
    bind decor_a { parent_origin = (-2u, 1u, 0u); }
    bind decor_b { parent_origin = (2u, 1u, 0u); }
    bind decor_c { parent_origin = (-2u, 3u, 0u); }
  }
  surface contract Skin { chart body box { coverage = opaque; } material = opaque; }
  surface skin : Skin {
    material = opaque;
    texture atlas {
      atlas = (32px, 32px); density = 1; background = metal; background_alpha = 255;
      palette { metal = (#505660, #707884, #909aa8); }
      chart body box { fill = metal; grain = none; }
    }
  }
  component Body {
    requires rig r : Rig; requires surface s : Skin;
    bind bone root to r.root; bind bone rotor to r.rotor; bind bone turbine to r.turbine;
    bind bone wheel to r.wheel; bind bone spine to r.spine; bind bone arm_tip to r.arm_tip;
    bind bone decor_a to r.decor_a; bind bone decor_b to r.decor_b; bind bone decor_c to r.decor_c;
    geometry {
      bone root {
        cube hub { origin = (-1u, 0u, -1u); size = (2u, 2u, 2u); surface = s.body; }
        bone rotor { cube blade { origin = (-1u, 8u, -1u); size = (2u, 2u, 2u); surface = s.body; } }
        bone turbine { cube fan { origin = (-1u, 4u, -1u); size = (2u, 2u, 2u); surface = s.body; } }
        bone wheel { cube rim { origin = (-1u, 2u, -1u); size = (2u, 2u, 2u); surface = s.body; } }
        bone spine {
          cube back { origin = (-1u, 3u, -1u); size = (2u, 2u, 2u); surface = s.body; }
          bone arm_tip { cube hand { origin = (1u, 5u, -1u); size = (2u, 2u, 2u); surface = s.body; } }
        }
        bone decor_a { cube da { origin = (-3u, 0u, -1u); size = (2u, 2u, 2u); surface = s.body; } }
        bone decor_b { cube db { origin = (1u, 0u, -1u); size = (2u, 2u, 2u); surface = s.body; } }
        bone decor_c { cube dc { origin = (-3u, 2u, -1u); size = (2u, 2u, 2u); surface = s.body; } }
      }
    }
  }
  motion spin for Rig {
    duration = 1.0s; fps = 30; loop = loop; rest_relative = true;
    layer base {
      mode = base;
      track rotor.rotation { key 0.0s = (0deg, 0deg, 0deg) linear; key 0.5s = (0deg, 180deg, 0deg) linear; key 1.0s = (0deg, 360deg, 0deg) linear; }
      track turbine.rotation { key 0.0s = (0deg, 0deg, 0deg) linear; key 0.5s = (0deg, 360deg, 0deg) linear; key 1.0s = (0deg, 720deg, 0deg) linear; }
      track wheel.rotation { key 0.0s = (0deg, 0deg, 0deg) linear; key 0.5s = (-180deg, 0deg, 0deg) linear; key 1.0s = (-360deg, 0deg, 0deg) linear; }
      track arm_tip.rotation { key 0.0s = (0deg, 0deg, 0deg) linear; key 0.5s = (25deg, 0deg, 0deg) linear; key 1.0s = (0deg, 0deg, 0deg) linear; }
    }
  }
  settings { density = 16; forward = north; profile = prop; }
  skeleton = Skel;
  motions = [spin];
  use Body { r = Rig; s = skin; }
}
`;

const spinCompiled = compileDirectoryWorkspace(spinWs, [
  { path: 'assets/models/spinner.ashfox', source: SPIN_SOURCE },
]);
assert.equal(
  spinCompiled.ok,
  true,
  spinCompiled.ok ? '' : JSON.stringify(spinCompiled.diagnostics),
);
if (spinCompiled.ok && spinCompiled.products[0]?.kind === 'model') {
  const prod = spinCompiled.products[0];
  const opened = openAssetProject({
    workspace: prod.workspace,
    entry: prod.entry,
    identity: { id: 'spinner', revision: 'r1', createdAt: '2026-01-01T00:00:00.000Z' },
  });
  assert.equal(opened.ok, true);
  if (opened.ok) {
    const doc = opened.project.document;
    const lod1 = buildModelLod1Document(doc);
    assert.ok(lod1.scene.nodes['arm_tip'], 'LOD1 must preserve animated leaf bone arm_tip');
    assert.ok(lod1.scene.nodes['spine'], 'LOD1 must preserve ancestor bone spine');
    assert.ok(lod1.scene.nodes['root'], 'LOD1 must preserve root bone');
    const flattenedDecor = ['decor_a', 'decor_b', 'decor_c'].filter((id) => !lod1.scene.nodes[id]);
    assert.ok(flattenedDecor.length >= 1, 'LOD1 must still flatten un-animated leaf bones');

    const bundle = compileProjectBundle(
      opened.project,
      readExportAdapterInput({ target: 'gltf', modelPath: 'spinner' }),
    );
    const gltfFile = bundle.files.find((f) => f.kind === 'json' && f.path.endsWith('.gltf'));
    const binFile = bundle.files.find((f) => f.kind === 'binary' && f.path.endsWith('.bin'));
    assert.ok(gltfFile?.kind === 'json' && binFile?.kind === 'binary');
    const gltf = gltfFile.data as {
      nodes: { name?: string }[];
      accessors: {
        bufferView: number;
        byteOffset?: number;
        count: number;
        componentType: number;
        type: string;
      }[];
      bufferViews: { byteOffset?: number; byteLength: number }[];
      animations: {
        samplers: { input: number; output: number }[];
        channels: { sampler: number; target: { node: number; path: string } }[];
      }[];
    };
    const readQuats = (accessorIdx: number): Quat[] => {
      const acc = gltf.accessors[accessorIdx]!;
      const bv = gltf.bufferViews[acc.bufferView]!;
      const off = (bv.byteOffset ?? 0) + (acc.byteOffset ?? 0);
      const view = new DataView(binFile.data.buffer, binFile.data.byteOffset + off, acc.count * 8);
      return Array.from({ length: acc.count }, (_, i) => [
        view.getInt16(i * 8, true) / 32767,
        view.getInt16(i * 8 + 2, true) / 32767,
        view.getInt16(i * 8 + 4, true) / 32767,
        view.getInt16(i * 8 + 6, true) / 32767,
      ]);
    };
    const anim = gltf.animations[0]!;
    for (const nodeName of ['rotor', 'turbine', 'wheel']) {
      const nodeIdx = gltf.nodes.findIndex((n) => n.name === nodeName);
      const ch = anim.channels.find(
        (c) => c.target.node === nodeIdx && c.target.path === 'rotation',
      )!;
      const quats = readQuats(anim.samplers[ch.sampler]!.output);
      assert.ok(quats.length >= 7, `expected subdivided rotation keys for ${nodeName}`);
      for (let i = 0; i < quats.length - 1; i += 1) {
        assert.ok(
          quatAngleDeg(quats[i]!, quats[i + 1]!) <= 61,
          `${nodeName} chord exceeded 61 deg`,
        );
      }
    }
    const readChannelPoses = (name: string) => {
      const ch = Object.values(Object.values(doc.animations)[0]!.channels).find(
        (c) => c.targetNodeId === name && c.property === 'rotation',
      )!;
      return (t: number) => {
        const i = Math.max(
          0,
          ch.keys.findIndex(
            (k, idx) => idx < ch.keys.length - 1 && t <= ch.keys[idx + 1]!.timeSeconds + 1e-6,
          ),
        );
        const [a, b] = [ch.keys[i]!, ch.keys[Math.min(ch.keys.length - 1, i + 1)]!];
        return a === b
          ? a.quaternion!
          : slerpQuat(
              a.quaternion!,
              b.quaternion!,
              (t - a.timeSeconds) / Math.max(1e-6, b.timeSeconds - a.timeSeconds),
            );
      };
    };
    const [rS, tS, wS] = [
      readChannelPoses('rotor'),
      readChannelPoses('turbine'),
      readChannelPoses('wheel'),
    ];
    const checks: readonly [typeof rS, number, Vec3][] = [
      [rS, 0.25, [0, 90, 0]],
      [rS, 0.5, [0, 180, 0]],
      [rS, 0.75, [0, 270, 0]],
      [tS, 0.125, [0, 90, 0]],
      [tS, 0.25, [0, 180, 0]],
      [tS, 0.375, [0, 270, 0]],
      [wS, 0.25, [-90, 0, 0]],
      [wS, 0.5, [-180, 0, 0]],
      [wS, 0.75, [-270, 0, 0]],
    ];
    for (const [fn, t, e] of checks) assert.ok(quatAngleDeg(fn(t), quatFromEulerXyzDeg(e)) < 1);
  }
}

const spinTrack = (jointId: string, k0: Vec3, k1: Vec3, k2: Vec3) => ({
  jointId,
  property: 'rotation' as const,
  keys: [
    { time: 0, value: k0 },
    { time: 0.5, value: k1 },
    { time: 1, value: k2 },
  ],
});
const bakedSpin = bakeClip({
  id: 'spin',
  name: 'spin',
  duration: 1,
  fps: 30,
  loop: 'loop',
  rig: {
    joints: ['y360', 'y720', 'x360'].map((id) => ({
      id,
      parentId: null,
      role: 'prop' as const,
      channels: ['rotation' as const],
      restPosition: [0, 0, 0] as Vec3,
      restRotation: IDENTITY_QUAT,
      restScale: [1, 1, 1] as Vec3,
    })),
  },
  layers: [
    {
      id: 'base',
      mode: 'base',
      tracks: [
        spinTrack('y360', [0, 0, 0], [0, 180, 0], [0, 360, 0]),
        spinTrack('y720', [0, 0, 0], [0, 360, 0], [0, 720, 0]),
        spinTrack('x360', [0, 0, 0], [-180, 0, 0], [-360, 0, 0]),
      ],
    },
  ],
});
for (const ch of bakedSpin.channels) {
  for (let i = 0; i < ch.keys.length - 1; i += 1) {
    assert.ok(quatAngleDeg(ch.keys[i]!.value as Quat, ch.keys[i + 1]!.value as Quat) <= 61);
  }
}

// Direct glTF sample optimizer check: exact geodesic SLERP samples across 0->180->360 bisect <= 61 deg
const denseTimes = Array.from({ length: 17 }, (_, i) => i / 16);
const denseQuats = denseTimes.flatMap((t) => [...quatFromEulerXyzDeg([0, t * 360, 0])]);
const opt = optimizeGltfAnimationSamples(
  { id: 'rot', targetNodeId: 'rotor', property: 'rotation', keys: [] },
  { times: denseTimes, values: denseQuats, componentCount: 4, interpolation: 'LINEAR' },
);
assert.ok(opt.times.length >= 7);
for (let i = 0; i < opt.times.length - 1; i += 1) {
  const a: Quat = [
    opt.values[i * 4]!,
    opt.values[i * 4 + 1]!,
    opt.values[i * 4 + 2]!,
    opt.values[i * 4 + 3]!,
  ];
  const b: Quat = [
    opt.values[(i + 1) * 4]!,
    opt.values[(i + 1) * 4 + 1]!,
    opt.values[(i + 1) * 4 + 2]!,
    opt.values[(i + 1) * 4 + 3]!,
  ];
  assert.ok(quatAngleDeg(a, b) <= 61);
}
console.log('animation end-to-end pipeline ok');
