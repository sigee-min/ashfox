import assert from 'node:assert/strict';
import path from 'node:path';
import {
  compileStructureUnits,
  decodeStructureNbt,
  exportStructureGltfResolved,
  parseStructureSource,
  type StructureSourceUnit,
} from '../../src/index';

const validator = require('gltf-validator');
const rel = (owner: string, spec: string): string =>
  path.posix.normalize(path.posix.join(path.posix.dirname(owner), spec));

const INTERIOR_TEST_SRC = `ashfox 1
structure test_hall {
  density = 2;
  seed = 777;
  size = (15b, 14b, 15b);
  data_version = 3955;

  palette {
    stone = "minecraft:stone_bricks";
    oak = "minecraft:oak_planks";
    plaster = "minecraft:white_terracotta";
    log = "minecraft:dark_oak_log[axis=y]";
    beam = "minecraft:dark_oak_log[axis=x]";
    spruce = "minecraft:spruce_planks";
    stair = "minecraft:dark_oak_stairs";
    ridge = "minecraft:dark_oak_slab[type=bottom]";
    door = "minecraft:dark_oak_door[facing=north,half=lower,hinge=left,open=false]";
    glass = "minecraft:glass_pane";
    sill = "minecraft:spruce_slab[type=top]";
  }

  floor main {
    y = 0b;
    height = 7b;
    room hall {
      from = (1b, 1b);
      size = (13b, 11b);
      kind = tavern;
      plinth = stone;
      floor = oak;
      wall = plaster;
      frame = log;
      ceiling = spruce;
      interior {
        dna { arch = rustic; mood = warm_hearth; organic = 0.75; }
        architecture { floor_pattern = herringbone; baseboard = trim; wainscot = paneled; ceiling = open_truss; }
        platform stage {
          on = north;
          size = (5, 2);
          height = 0.25;
          step_facing = south;
          chair { kind = dining_set; seats = 2; }
        }
        mezzanine loft {
          on = west;
          depth = 3;
          y_offset = 4;
          railing = timber;
          shelving { size = (2, 1); }
        }
        alcove hearth_niche { kind = fireplace; wall = north; width = 3; height = 3; }
        partition divider { style = colonnade; axis = x; at = 8; span_from = 2; span_to = 12; doorway_at = 7; doorway_width = 2; }
        wall_line {
          on = east;
          barrel_rack { size = (2, 1); }
          cabinet { size = (2, 1); }
        }
        centerpiece {
          on = center;
          dining_set hero_table { seats = 4; organic_jitter = 0.2; }
          story tavern_meal { on = hero_table; }
        }
        drapery curtains { on = windows; tieback = true; color = "#8b2d2d"; }
        drapery banner { kind = banner; on = ceiling_span; color = "#c8963e"; }
        lighting { bounces = 2; ambient_floor = 0.14; stained_glass_boost = 1.4; }
        sun_shaft { enabled = true; sun_dir = (0.35, -0.72, 0.58); intensity = 0.5; shaft_length = 6.0; }
      }
    }
    facade hall.south {
      door { at = 3b; width = 1b; height = 2b; block = door; hinge = left; frame = log; lintel = beam; }
      window { at = 8b; width = 3b; height = 2b; y_offset = 1b; glass = glass; sill = sill; lintel = beam; stained_glass_color = "#e8a84a"; }
    }
    facade hall.north {
      window { at = center; width = 2b; height = 2b; y_offset = 1b; glass = glass; sill = sill; lintel = beam; }
    }
  }

  roof {
    on = hall;
    style = gable;
    axis = x;
    overhang = 1b;
    pitch = standard;
    stair = stair;
    ridge = ridge;
    gable = plaster;
  }
}
`;

const run = async (): Promise<void> => {
  const unit = parseStructureSource(INTERIOR_TEST_SRC, 'test_hall.ashfox');
  const roomOp = unit.ops.find((o) => o.op === 'floor');
  assert.ok(roomOp && roomOp.op === 'floor');
  const nestedRoom = roomOp.ops.find((o) => o.op === 'room');
  assert.ok(nestedRoom && nestedRoom.op === 'room' && nestedRoom.interior);
  assert.equal(nestedRoom.interior.dna?.arch, 'rustic');
  assert.equal(nestedRoom.interior.lighting?.bounces, 2);
  assert.equal(nestedRoom.interior.sunShaft?.enabled, true);

  const units = new Map<string, StructureSourceUnit>([['test_hall.ashfox', unit]]);
  const product = compileStructureUnits('test_hall.ashfox', units, {}, rel);

  assert.ok(product.grid.interiors && product.grid.interiors.length === 1);
  const compiled = product.grid.interiors[0]!;
  assert.equal(compiled.nbt_lowering.data_version, 3955);
  assert.equal(
    compiled.nbt_lowering.clearance.passed,
    true,
    JSON.stringify(compiled.nbt_lowering.clearance),
  );
  assert.ok(compiled.nbt_lowering.clearance.min_headroom_b >= 2);
  assert.ok(compiled.window_panes.some((p) => p.color === '#e8a84a' && p.double_sided));
  assert.ok(compiled.sun_shafts.length > 0, 'Expected sun_shaft quads from sunlit south window');

  const rad = compiled.radiosity;
  let maxWarmDiff = 0;
  for (let i = 0; i < rad.bounce_r.length; i += 1) {
    maxWarmDiff = Math.max(maxWarmDiff, Math.abs(rad.bounce_r[i]! - rad.bounce_b[i]!));
  }
  assert.ok(
    maxWarmDiff >= 10,
    `Expected non-uniform bounce radiosity contrast, got ${maxWarmDiff}`,
  );

  assert.ok(product.interiorAudits && product.interiorAudits.length === 1);
  assert.equal(product.interiorAudits[0]!.passed, true, JSON.stringify(product.interiorAudits[0]));
  assert.ok(product.interiorAudits[0]!.score >= 85);
  assert.ok(product.playableMeta.interiors && product.playableMeta.interiors.length === 1);
  assert.ok(product.playableMeta.interiors[0]!.hooks.length > 0);
  const hookSchemas = new Set(product.hooks?.anchors.map((a) => a.schema) ?? []);
  assert.ok(hookSchemas.has('std.sit'), 'Expected interior sit hook in HooksDocument');
  assert.ok(hookSchemas.has('std.door_hinge'), 'Expected interior door_hinge/slide hook');
  assert.ok(hookSchemas.has('std.toggle_light'), 'Expected interior toggle_light hook');
  assert.ok(hookSchemas.has('std.station'), 'Expected interior station hook');
  assert.ok(hookSchemas.has('std.sfx'), 'Expected interior spatial audio hook');

  const layers = new Set(product.bakedMesh.batches.map((b) => b.layer));
  assert.ok(layers.has('translucent'), 'Expected translucent stained-glass batch');
  assert.ok(layers.has('sun_shaft'), 'Expected sun_shaft additive batch');

  const bundle = await exportStructureGltfResolved(product, 'test_hall', 'test-key');
  const glbFile = bundle.files.find((f) => f.path === 'test_hall.glb');
  assert.ok(glbFile?.kind === 'binary');
  const glb = glbFile.data;
  const jsonLen = Buffer.from(glb).readUInt32LE(12);
  const gltf = JSON.parse(Buffer.from(glb.subarray(20, 20 + jsonLen)).toString('utf8')) as {
    nodes?: { name?: string }[];
    extras?: { ashfox?: { hooks?: { anchors?: { schema?: string }[] } } };
    materials?: {
      alphaMode?: string;
      doubleSided?: boolean;
      extensions?: Record<string, unknown>;
      extras?: Record<string, unknown>;
    }[];
  };
  assert.ok(
    gltf.nodes?.some((n) => n.name?.startsWith('anchor_sit_')),
    'Expected glTF anchor_* Empty Node for interior sit hook',
  );
  assert.ok(
    gltf.extras?.ashfox?.hooks?.anchors?.some((a) => a.schema === 'std.sfx'),
    'Expected spatial audio hook in glTF extras.ashfox.hooks',
  );
  assert.ok(
    gltf.materials?.some(
      (m) =>
        m.alphaMode === 'BLEND' &&
        m.extensions?.KHR_materials_unlit &&
        m.extras?.ashfoxBlendMode === 'additive',
    ),
    'Expected additive unlit BLEND material for sun_shaft',
  );
  assert.ok(
    gltf.materials?.some(
      (m) => m.alphaMode === 'BLEND' && m.doubleSided === true && !m.extras?.ashfoxBlendMode,
    ),
    'Expected double-sided BLEND material for translucent stained glass',
  );
  const report = await validator.validateBytes(glb, {
    externalResourceFunction: async () => {
      throw new Error('GLB must be self-contained');
    },
  });
  assert.equal(report.issues.numErrors, 0, JSON.stringify(report.issues));

  // Verify interior nbt_lowering blocks merge into the exported structure .nbt grid.
  const decoded = decodeStructureNbt(product.nbt);
  const paletteNames = new Set(decoded.palette.map((p) => p.Name));
  assert.ok(
    paletteNames.has('minecraft:oak_slab') || paletteNames.has('minecraft:dark_oak_log'),
    `Expected lowered interior partition/platform states in .nbt palette: ${[...paletteNames].join(',')}`,
  );

  // Verify compound_place preserves and rotates child interiors + hooks + radiosity.
  const compoundSrc = `ashfox 1
structure test_compound {
  import "./test_hall.ashfox" as hall_a;
  size = (20b, 16b, 20b);
  palette { grass = "minecraft:grass_block"; }
  box { from = (0b, 0b, 0b); to = (19b, 0b, 19b); block = grass; }
  compound_place hall_a { at = (2b, 0b, 2b); rotate = 180; }
}`;
  const compUnits = new Map<string, StructureSourceUnit>([
    ['test_hall.ashfox', unit],
    ['test_compound.ashfox', parseStructureSource(compoundSrc, 'test_compound.ashfox')],
  ]);
  const compProduct = compileStructureUnits('test_compound.ashfox', compUnits, {}, rel);
  assert.equal(compProduct.grid.interiors?.length, 1);
  assert.equal(compProduct.grid.interiors![0]!.room_id, 'hall_a.hall');
  assert.ok((compProduct.playableMeta.interiors?.length ?? 0) === 1);
  assert.ok(compProduct.hooks?.anchors.some((a) => a.id.startsWith('hall_a.')));
  console.log('ashfox interior wiring integration tests ok');
};

void run().catch((err) => {
  console.error(err);
  process.exit(1);
});
