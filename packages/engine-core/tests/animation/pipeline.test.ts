import assert from 'node:assert/strict';
import {
  compileDirectoryWorkspace,
  compileProjectBundle,
  openAssetProject,
  readExportAdapterInput,
} from '../../src';

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
