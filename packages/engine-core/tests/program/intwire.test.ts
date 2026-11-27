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
  // Verify mezzanine deck box from interior.ir.boxes is included in exported colliders.
  const mezBox = compiled.ir.boxes.find((b) => b.semantic_tag === 'volume_mezzanine')!;
  const [pw, , pd] = product.grid.size;
  const mezMid: readonly [number, number, number] = [
    (mezBox.from_16[0] + mezBox.to_16[0]) / 32 - pw / 2,
    (mezBox.from_16[1] + mezBox.to_16[1]) / 32,
    (mezBox.from_16[2] + mezBox.to_16[2]) / 32 - pd / 2,
  ];
  assert.ok(
    product.playableMeta.colliders.some(
      (c) =>
        mezMid[0] >= c.from[0] &&
        mezMid[0] <= c.to[0] &&
        mezMid[1] >= c.from[1] &&
        mezMid[1] <= c.to[1] &&
        mezMid[2] >= c.from[2] &&
        mezMid[2] <= c.to[2],
    ),
    'Expected interior mezzanine deck midpoint inside exported playableMeta.colliders',
  );
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
    nodes?: { name?: string; extras?: { ashfox?: { hook?: { schema?: string } } } }[];
    extras?: { ashfox?: { hooks?: { anchors?: { schema?: string }[] } } };
    materials?: {
      alphaMode?: string;
      doubleSided?: boolean;
      extensions?: Record<string, unknown>;
      extras?: Record<string, unknown>;
    }[];
  };
  assert.ok(
    gltf.nodes?.some(
      (n) => n.name?.startsWith('anchor_') && n.extras?.ashfox?.hook?.schema === 'std.sit',
    ),
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
  const origYawBox = product.grid.interiors![0]!.ir.boxes.find(
    (b) => b.rotation_y_deg !== undefined,
  )!;
  const xformYawBox = compProduct.grid.interiors![0]!.ir.boxes.find((b) => b.id === origYawBox.id)!;
  assert.equal(
    xformYawBox.rotation_y_deg,
    origYawBox.rotation_y_deg,
    'Rotated compound must preserve local box yaw after transforming bounds/pivot',
  );

  // Verify nudged props emit one resolved station hook (no stale duplicate) and sunken cuts voxel floor.
  const dedupSrc = `ashfox 1
structure dedup_sunken {
  size = (11b, 10b, 11b);
  palette { stone = "minecraft:stone_bricks"; oak = "minecraft:oak_planks"; door = "minecraft:oak_door[facing=north,half=lower,hinge=left,open=false]"; }
  floor f { y = 0b; height = 5b;
    room r { from = (1b, 1b); size = (9b, 9b); kind = living; floor = oak; wall = stone; ceiling = oak;
      interior {
        dna { arch = rustic; }
        sunken pit { from = (4, 4); size = (2, 2); height = -0.25; }
        centerpiece { on = center; low_table tbl_a { size = (1, 1); } low_table tbl_b { size = (1, 1); } }
      }
    }
    facade r.south { door { at = center; width = 1b; height = 2b; block = door; } }
  }
}`;
  const dedupUnits = new Map<string, StructureSourceUnit>([
    ['d.ashfox', parseStructureSource(dedupSrc, 'd.ashfox')],
  ]);
  const dedupProd = compileStructureUnits('d.ashfox', dedupUnits, {}, rel);
  const stationHooks = dedupProd.playableMeta.interiors![0]!.hooks.filter(
    (h) => h.kind === 'station',
  );
  assert.equal(
    stationHooks.length,
    2,
    `Expected 2 unique station hooks, got ${stationHooks.length}`,
  );
  assert.notEqual(
    `${stationHooks[0]!.position[0]},${stationHooks[0]!.position[2]}`,
    `${stationHooks[1]!.position[0]},${stationHooks[1]!.position[2]}`,
    'Resolved table hooks must occupy distinct positions',
  );
  const [dw, , dd] = dedupProd.grid.size;
  const pitState = dedupProd.grid.states[dedupProd.grid.voxels[(0 * dd + 4) * dw + 4]!]!;
  assert.equal(pitState, 'minecraft:oak_slab[type=bottom]');

  // Verify north-facing alcove in a 1-block room wall [2,0,2]..[12,7,12] carves oak wall voxels for mesh and NBT.
  const alcoveSrc = `ashfox 1
structure alcove_carve_test {
  size = (15b, 10b, 15b);
  palette { oak = "minecraft:oak_planks"; door = "minecraft:oak_door[facing=north,half=lower,hinge=left,open=false]"; }
  floor f { y = 0b; height = 7b;
    room r { from = (2b, 2b); size = (11b, 11b); kind = living; floor = oak; wall = oak; ceiling = oak;
      interior {
        dna { arch = rustic; }
        alcove hearth { kind = fireplace; wall = north; at = 3; width = 3; height = 3; }
      }
    }
    facade r.south { door { at = center; width = 1b; height = 2b; block = door; } }
  }
}`;
  const alcoveProd = compileStructureUnits(
    'alc.ashfox',
    new Map([['alc.ashfox', parseStructureSource(alcoveSrc, 'alc.ashfox')]]),
    {},
    rel,
  );
  const [aw, , ad] = alcoveProd.grid.size;
  const nicheState = alcoveProd.grid.states[alcoveProd.grid.voxels[(2 * ad + 2) * aw + 7]!]!;
  assert.equal(nicheState, 'minecraft:air', 'Alcove on 1-block wall must carve wall voxel to air');
  const nbtAlc = decodeStructureNbt(alcoveProd.nbt);
  const oakIdx = nbtAlc.palette.findIndex((p) => p.Name === 'minecraft:oak_planks');
  const sealed = nbtAlc.blocks.some(
    (b) => b.pos[0] === 7 && b.pos[1] === 2 && b.pos[2] === 2 && b.state === oakIdx,
  );
  assert.equal(sealed, false, 'Alcove niche in NBT must not remain sealed by oak_planks');

  // Verify rotated prop colliders include rotated tabletop bounds and clamped mezzanine seats nested chair at deck Y.
  const rotMezSrc = `ashfox 1
structure rot_mez_test {
  size = (11b, 8b, 11b);
  palette { stone = "minecraft:stone_bricks"; oak = "minecraft:oak_planks"; door = "minecraft:oak_door[facing=north,half=lower,hinge=left,open=false]"; }
  floor f { y = 0b; height = 6b;
    room r { from = (0b, 0b); size = (11b, 11b); kind = living; floor = oak; wall = stone; ceiling = oak;
      interior {
        dna { arch = rustic; organic = 0; }
        mezzanine loft { on = north; depth = 3; y_offset = 4; railing = timber; chair loft_seat {} }
        table rot_tbl { at = (4, 1, 4); size = (3, 1); rotation_deg = 90; }
      }
    }
    facade r.south { door { at = center; width = 1b; height = 2b; block = door; } }
  }
}`;
  const rotMezProd = compileStructureUnits(
    'rm.ashfox',
    new Map([['rm.ashfox', parseStructureSource(rotMezSrc, 'rm.ashfox')]]),
    {},
    rel,
  );
  const rmInterior = rotMezProd.grid.interiors![0]!;
  const deckBox = rmInterior.ir.boxes.find((b) => b.semantic_tag === 'volume_mezzanine')!;
  const loftChairHook = rmInterior.playable_meta.hooks.find(
    (h) => h.kind === 'sit' && h.prop_id === 'loft_seat',
  )!;
  assert.equal(deckBox.to_16[1] / 16, 4);
  assert.equal(loftChairHook.position[1], 4, 'Mezzanine chair must sit flush at clamped deck Y=4');
  const [rw, , rd] = rotMezProd.grid.size;
  const pt: readonly [number, number, number] = [5.5 - rw / 2, 1.95, 5.5 - rd / 2];
  const hitsRot = rotMezProd.playableMeta.colliders.some(
    (c) =>
      pt[0] >= c.from[0] &&
      pt[0] <= c.to[0] &&
      pt[1] >= c.from[1] &&
      pt[1] <= c.to[1] &&
      pt[2] >= c.from[2] &&
      pt[2] <= c.to[2],
  );
  assert.equal(hitsRot, true);
  const [tw, , td] = product.grid.size;
  assert.equal(product.grid.states[product.grid.voxels[(7 * td + 6) * tw + 7]!], 'minecraft:air');

  const eastLineSrc = `ashfox 1
structure east_wall_line_test {
  size = (11b, 9b, 11b);
  palette { oak = "minecraft:oak_planks"; door = "minecraft:oak_door[facing=north,half=lower,hinge=left,open=false]"; }
  floor f { y = 0b; height = 7b;
    room r { from = (0b, 0b); size = (11b, 11b); kind = living; floor = oak; wall = oak; ceiling = oak;
      interior {
        dna { arch = rustic; organic = 0; }
        wall_line {
          on = east;
          shelving s1 { size = (2, 1); }
          shelving s2 { size = (2, 1); }
        }
      }
    }
    facade r.south { door { at = center; width = 1b; height = 2b; block = door; } }
  }
}`;
  const compileOne = (f: string, s: string) =>
    compileStructureUnits(f, new Map([[f, parseStructureSource(s, f)]]), {}, rel);
  const [s1, s2] = compileOne('ewl.ashfox', eastLineSrc).grid.interiors![0]!.input.props ?? [];
  assert.deepEqual(
    [s1?.at, s2?.at],
    [
      [9, 1, 1],
      [9, 1, 3],
    ],
  );

  const hostSrc = `ashfox 1
structure placed_host {
  size = (28b, 10b, 20b);
  palette { grass = "minecraft:grass_block"; stone = "minecraft:stone_bricks"; oak = "minecraft:oak_planks"; door = "minecraft:oak_door[facing=north,half=lower,hinge=left,open=false]"; }
  box { from = (0b, 0b, 0b); to = (27b, 0b, 19b); block = grass; }
  prefab wing {
    floor f { y = 0b; height = 7b;
      room r { from = (1b, 1b); size = (8b, 8b); kind = living; floor = oak; wall = stone; ceiling = oak;
        interior {
          dna { arch = rustic; organic = 0; }
          platform dais { from = (2, 2); size = (3, 2); height = 0.25; }
          platform dais_def { height = 0.25; }
          alcove alc_def { kind = display; }
          partition p_mid { style = screen; axis = x; }
          mezzanine loft { on = north; depth = 2; y_offset = 4; railing = timber; }
          low_table lt_def { at = (2, 1, 2); facing = east; }
          chair c_ctr { on = center; }
          drapery diag_c { kind = chains; from = (32, 64, 32); to = (96, 80, 96); }
        }
      }
      facade r.south { door { at = center; width = 1b; height = 2b; block = door; } }
    }
  }
  place wing { at = (15b, 0b, 3b); rotate = 90; }
}`;
  const placedRoom = compileOne('host.ashfox', hostSrc).grid.interiors![0]!;
  const placedDais = placedRoom.ir.boxes.find((b) => b.semantic_tag === 'volume_platform')!;
  const [rb0, rb1] = [placedRoom.input.bounds_from, placedRoom.input.bounds_to];
  assert.ok(placedDais.from_16[0] >= rb0[0] * 16 && placedDais.to_16[0] <= rb1[0] * 16);
  assert.ok(placedDais.from_16[2] >= rb0[2] * 16 && placedDais.to_16[2] <= rb1[2] * 16);
  const gp = (id: string) => placedRoom.input.props?.find((p) => p.id === id);
  const gv = (k: string, id?: string) =>
    placedRoom.input.volumes.find((v) => v.kind === k && (!id || v.id === id));
  const [loftV, daisV, midV, alcV] = [
    gv('mezzanine'),
    gv('platform', 'dais_def'),
    gv('partition'),
    gv('alcove'),
  ];
  const diagD = placedRoom.input.draperies?.[0];
  assert.deepEqual(
    [gp('lt_def')?.at, gp('c_ctr')?.facing, loftV?.kind === 'mezzanine' ? loftV.on : undefined],
    [[12, 1, 5], 'west', 'east'],
  );
  assert.deepEqual(
    [
      daisV?.kind === 'platform' ? [daisV.on, daisV.size] : undefined,
      midV?.kind === 'partition' ? midV.at_pos : undefined,
      alcV?.kind === 'alcove' ? alcV.wall : undefined,
      diagD?.from_16,
      diagD?.to_16,
    ],
    [['east', [2, 3]], 10, 'east', [208, 64, 80], [144, 80, 144]],
  );

  const yawCollisionSrc = `ashfox 1
structure yaw_col {
  size = (11b, 8b, 11b);
  palette { oak = "minecraft:oak_planks"; door = "minecraft:oak_door[facing=north,half=lower,hinge=left,open=false]"; }
  floor f { y = 0b; height = 6b;
    room r { from = (0b, 0b); size = (11b, 11b); kind = living; floor = oak; wall = oak; ceiling = oak;
      interior {
        dna { arch = rustic; organic = 0; }
        dining_set t_rot { at = (4, 1, 4); size = (3, 1); facing = north; rotation_deg = 90; seat_count = 2; }
        cabinet cab_hit { at = (5, 1, 3); size = (1, 1); facing = south; }
        chair c_rot { at = (2, 1, 2); facing = north; rotation_deg = 90; }
        mount m_east { asset = oak; at = (1, 1, 6); size = (3, 1); facing = east; }
        wall_line { on = [north, south]; chair wl_c {} }
      }
    }
    facade r.south { door { at = center; width = 1b; height = 2b; block = door; } }
  }
}`;
  const yawRoom = compileOne('yaw.ashfox', yawCollisionSrc).grid.interiors![0]!;
  assert.equal(new Set(yawRoom.ir.boxes.map((b) => b.id)).size, yawRoom.ir.boxes.length);
  const hk = (id: string) => yawRoom.playable_meta.hooks.find((h) => h.id === id)!;
  const cabPos = hk('hinge_cab_hit').position;
  assert.equal(Math.floor(cabPos[0]) === 5 && Math.floor(cabPos[2]) === 3, false);
  const [c0, cRot] = [hk('t_rot:chair_0:sit'), hk('c_rot:sit')];
  assert.deepEqual(
    [c0.position, c0.kind === 'sit' ? c0.facing : '', cRot.kind === 'sit' ? cRot.facing : ''],
    [[6.5, 1, 3.5], 'west', 'east'],
  );
  const clrHit = yawRoom.ir.clear_path_cells.some((c) => (c[0] === 5 || c[0] === 6) && c[2] === 3);
  assert.deepEqual([yawRoom.custom_mounts[0]?.at_16, clrHit], [[24, 16, 120], false]);
  assert.throws(() =>
    parseStructureSource(
      'ashfox 1 structure d { size = (9b, 6b, 9b); floor f { y = 0b; height = 5b; room r { from = (0b, 0b); size = (9b, 9b); kind = living; interior { drapery noren { split_panels = 1000000000; } } } } }',
      'd.ashfox',
    ),
  );
  console.log('ashfox interior wiring integration tests ok');
};

void run().catch((err) => {
  console.error(err);
  process.exit(1);
});
