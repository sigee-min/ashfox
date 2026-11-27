import assert from 'node:assert/strict';
import {
  evaluateInteriorAudit,
  type InteriorAuditInput,
} from '../../src/compiler/structure/interior/audit';
import type {
  InteriorRoomInput,
  InteriorSubVoxelIR,
  SubVoxelBoxIR,
  VanillaNbtLoweringIR,
} from '../../src/compiler/structure/interior/contract';
import {
  bakeSubVoxelColors0,
  computeInteriorRadiosity,
  computeRadiosityColorContrast,
  defaultRadiosityConfig,
  sampleRadiosityAt16,
} from '../../src/compiler/structure/interior/radiosity';
import {
  buildSunShaftMeshPrimitives,
  defaultSunShaftConfig,
  emitPlayableInteriorMeta,
  generateInteriorSunShafts,
  generateTranslucentWindowPanes,
} from '../../src/compiler/structure/interior/sunShaft';
import { propFitsBounds } from '../../src/compiler/structure/interior/zoneRect';
import {
  emitInteriorBakedMeshes,
  mountInstanceRotation,
} from '../../src/compiler/structure/interior/mesh';
import type { BatchDraft } from '../../src/compiler/structure/batch';
import { compileStructureUnits, parseStructureSource } from '../../src/index';
import { StructureInputError, type IntVec3 } from '../../src/project/structure/contract';

const box = (
  id: string,
  from_16: readonly [number, number, number],
  to_16: readonly [number, number, number],
  tile_id: string,
  layer: SubVoxelBoxIR['layer'] = 'opaque',
  extra?: Partial<SubVoxelBoxIR>,
): SubVoxelBoxIR => ({ id, from_16, to_16, tile_id, layer, ...extra });

const buildClearPath = (x0: number, x1: number, z0: number, z1: number, y: number): IntVec3[] => {
  const cells: IntVec3[] = [];
  for (let z = z0; z <= z1; z += 1) {
    for (let x = x0; x <= x1; x += 1) cells.push([x, y, z]);
  }
  return cells;
};

const makeTavernRoom = (organic = 0.75, stainedGlass?: string): InteriorRoomInput => ({
  room_id: 'taproom',
  kind: 'tavern',
  style_dna: { arch: 'rustic', furn: 'rustic', mood: 'warm_hearth', organic },
  architecture: {
    floor_pattern: 'plank',
    baseboard: 'stone_plinth',
    wainscot: 'paneled',
    molding: 'timber_cornice',
    ceiling: 'open_truss',
  },
  bounds_from: [0, 0, 0],
  bounds_to: [9, 5, 9],
  openings: [
    { id: 'main_door', kind: 'door', wall: 'south', from: [4, 1, 9], to: [5, 2, 9], hinge: 'left' },
    {
      id: 'north_win',
      kind: 'window',
      wall: 'north',
      from: [3, 2, 0],
      to: [5, 3, 0],
      ...(stainedGlass ? { stained_glass_color: stainedGlass } : {}),
    },
    { id: 'south_win', kind: 'window', wall: 'south', from: [1, 2, 9], to: [2, 3, 9] },
  ],
  volumes: [
    {
      kind: 'platform',
      id: 'bard_stage',
      on: 'north',
      size: [4, 2],
      height_16: 4,
      railing: 'timber',
    },
    { kind: 'mezzanine', id: 'loft', on: 'west', depth: 2, railing: 'timber' },
    {
      kind: 'alcove',
      id: 'hearth_niche',
      alcove_kind: 'fireplace',
      wall: 'east',
      at_u: 4,
      width_b: 2,
      height_b: 3,
    },
  ],
  props: [
    { id: 'hearth', kind: 'fireplace', at: [8, 1, 4], facing: 'west' },
    { id: 'dining_1', kind: 'dining_set', at: [4.5, 1, 4.5], facing: 'north', seat_count: 4 },
    { id: 'bar_counter', kind: 'l_counter', at: [7, 1, 7], facing: 'west' },
    { id: 'display_1', kind: 'cabinet', at: [1.5, 1, 2], facing: 'east' },
  ],
  stories: [
    {
      id: 'meal_1',
      kind: 'tavern_meal',
      on_target: 'dining_1',
      surface_y_16: 32,
      center_xz_16: [72, 72],
      facing: 'north',
    },
  ],
  seed: 404,
});

const makeTavernIr = (): InteriorSubVoxelIR => {
  const boxes: SubVoxelBoxIR[] = [];
  for (let z = 0; z <= 9; z += 1) {
    for (let x = 0; x <= 9; x += 1) {
      boxes.push(
        box(
          `floor_${x}_${z}`,
          [x * 16, 0, z * 16],
          [x * 16 + 16, 16, z * 16 + 16],
          'oak_planks',
          'opaque',
          { semantic_tag: 'floor' },
        ),
      );
      boxes.push(
        box(
          `ceil_${x}_${z}`,
          [x * 16, 80, z * 16],
          [x * 16 + 16, 96, z * 16 + 16],
          'spruce_planks',
          'opaque',
          { semantic_tag: 'ceiling' },
        ),
      );
    }
  }
  for (let y = 1; y <= 4; y += 1) {
    for (let i = 0; i <= 9; i += 1) {
      if (i < 3 || i > 5 || y < 2 || y > 3) {
        boxes.push(
          box(
            `wall_n_${i}_${y}`,
            [i * 16, y * 16, 0],
            [i * 16 + 16, y * 16 + 16, 16],
            'plaster_white',
            'opaque',
            { semantic_tag: 'wall' },
          ),
        );
      }
      boxes.push(
        box(
          `wall_e_${i}_${y}`,
          [144, y * 16, i * 16],
          [160, y * 16 + 16, i * 16 + 16],
          'plaster_white',
          'opaque',
          { semantic_tag: 'wall' },
        ),
      );
      boxes.push(
        box(
          `wall_w_${i}_${y}`,
          [0, y * 16, i * 16],
          [16, y * 16 + 16, i * 16 + 16],
          'plaster_white',
          'opaque',
          { semantic_tag: 'wall' },
        ),
      );
    }
  }
  boxes.push(
    box('crimson_rug', [48, 16, 32], [96, 17, 64], 'carpet_red', 'opaque', { semantic_tag: 'rug' }),
  );
  boxes.push(
    box('table_leg_1', [66, 16, 66], [68, 29, 68], 'dark_oak_planks', 'opaque', {
      semantic_tag: 'furniture_leg',
      contact_ao: 0.7,
    }),
  );
  boxes.push(
    box('baseboard_n', [16, 16, 16], [144, 20, 18], 'stone_bricks', 'opaque', {
      semantic_tag: 'baseboard',
      contact_ao: 0.55,
    }),
  );
  boxes.push(
    box('beam_joint_1', [16, 72, 16], [144, 80, 22], 'dark_oak_planks', 'opaque', {
      semantic_tag: 'beam_joint',
      contact_ao: 0.6,
    }),
  );
  boxes.push(
    box('hearth_fire', [128, 16, 64], [144, 32, 80], 'hearth_ember', 'emissive', {
      semantic_tag: 'hearth',
      color_tint: '#ff822e',
    }),
  );
  return {
    room_id: 'taproom',
    units_per_block: 16,
    boxes,
    clear_path_cells: buildClearPath(1, 8, 1, 8, 1),
    corbel_blocked_cells: [],
  };
};

const testTwoBounceRadiosityAndPerformance = (): void => {
  const room = makeTavernRoom();
  const ir = makeTavernIr();
  const b1 = computeInteriorRadiosity(room, ir, { bounces: 1 }, [0.2, -0.75, 0.63]);
  const b2 = computeInteriorRadiosity(room, ir, { bounces: 2 }, [0.2, -0.75, 0.63]);
  const b2Repeat = computeInteriorRadiosity(room, ir, { bounces: 2 }, [0.2, -0.75, 0.63]);

  assert.ok(b2.compute_ms < 3, `Expected < 3ms radiosity compute, got ${b2.compute_ms}ms`);
  assert.deepEqual(b2.bounce_r, b2Repeat.bounce_r);
  assert.deepEqual(b2.bounce_g, b2Repeat.bounce_g);
  assert.deepEqual(b2.bounce_b, b2Repeat.bounce_b);
  assert.deepEqual(b2.sun_patch_r, b2Repeat.sun_patch_r);
  assert.deepEqual(b2.contact_ao, b2Repeat.contact_ao);

  const [w, _h, d] = b2.size;
  const wallIdx = (2 * d + 3) * w + 1;
  assert.ok(
    b2.bounce_r[wallIdx]! > b2.bounce_b[wallIdx]!,
    'Expected warm oak/rug red bounce > blue on plaster wall',
  );

  let sumB1 = 0;
  let sumB2 = 0;
  for (let i = 0; i < b2.bounce_r.length; i += 1) {
    sumB1 += b1.bounce_r[i]! + b1.bounce_g[i]! + b1.bounce_b[i]!;
    sumB2 += b2.bounce_r[i]! + b2.bounce_g[i]! + b2.bounce_b[i]!;
  }
  assert.ok(sumB2 > sumB1, 'Expected 2-bounce radiosity total energy > 1-bounce');
  assert.ok(computeRadiosityColorContrast(b2) > 0.15);

  const neonIr: InteriorSubVoxelIR = {
    ...ir,
    boxes: [
      ...ir.boxes,
      box('cyan_console', [32, 16, 112], [48, 32, 128], 'neon_panel', 'emissive', {
        semantic_tag: 'neon',
        color_tint: '#30ebff',
      }),
    ],
  };
  const neonField = computeInteriorRadiosity(room, neonIr, defaultRadiosityConfig('cyber_neon'));
  const neonWall = sampleRadiosityAt16(neonField, room.bounds_from, 16, 24, 116);
  assert.ok(neonWall[2] > neonWall[0], 'Expected cyan neon bounce B > R near console');
  const colors0 = bakeSubVoxelColors0(room, ir, b2);
  assert.equal(colors0.size, ir.boxes.length);
  assert.equal(colors0.get('floor_4_2')!.length, 72);
};

const testStainedGlassAndSubVoxelContactAo = (): void => {
  const room = makeTavernRoom(0.75, '#e82e4a');
  const ir = makeTavernIr();
  const field = computeInteriorRadiosity(
    room,
    ir,
    { bounces: 2, stained_glass_boost: 1.3 },
    [0, -0.7, 0.71],
  );

  let maxRedPatchDiff = 0;
  for (let i = 0; i < field.sun_patch_r.length; i += 1) {
    const diff = field.sun_patch_r[i]! - field.sun_patch_b[i]!;
    if (diff > maxRedPatchDiff) maxRedPatchDiff = diff;
  }
  assert.ok(
    maxRedPatchDiff > 40,
    `Expected crimson stained-glass patch R >> B, got diff=${maxRedPatchDiff}`,
  );

  const [w, _h, d] = field.size;
  const legCellIdx = (1 * d + 4) * w + 4;
  const openCellIdx = (1 * d + 6) * w + 6;
  assert.ok(
    field.contact_ao[legCellIdx]! < 230,
    'Expected contact AO darkening under grounded table leg',
  );
  assert.equal(field.contact_ao[openCellIdx]!, 255);

  const colors0 = bakeSubVoxelColors0(room, ir, field);
  const legFloorTop = colors0.get('floor_4_4')!;
  const nearLegLum = legFloorTop[48 + 9]!;
  const farCornerLum = legFloorTop[48 + 3]!;
  assert.ok(
    nearLegLum < farCornerLum,
    `Expected floor COLOR_0 near leg (${nearLegLum}) < far corner (${farCornerLum})`,
  );
};

const testSunShaftsPanesAndPlayableHooks = (): void => {
  const room = makeTavernRoom();
  const ir = makeTavernIr();
  const shafts = generateInteriorSunShafts(
    room,
    defaultSunShaftConfig('warm_hearth', { sun_dir: [0.1, -0.72, 0.68] }),
  );
  assert.equal(shafts.length, 2);
  assert.equal(shafts[0]!.opening_id, 'north_win');
  assert.ok(shafts[0]!.alpha_top > shafts[0]!.alpha_bottom);
  assert.ok(Math.abs(shafts[0]!.floor_patch_center[1] - 1.02) < 0.01);

  const mesh = buildSunShaftMeshPrimitives(shafts);
  assert.equal(mesh.doubleSided, true);
  assert.equal(mesh.alphaMode, 'BLEND');
  assert.equal(mesh.positions.length, 24);
  assert.equal(mesh.colors.length, 32);

  const panes = generateTranslucentWindowPanes(room);
  assert.equal(panes.length, 2);
  for (const pane of panes) {
    assert.equal(pane.double_sided, true);
    assert.equal(pane.box.layer, 'translucent');
    assert.ok(pane.alpha > 0 && pane.alpha < 1);
  }

  const playable = emitPlayableInteriorMeta(room, ir);
  assert.equal(playable.schema_version, 1);
  assert.equal(playable.acoustic_space, 'timber_room');
  const kinds = new Set(playable.hooks.map((h) => h.kind));
  assert.ok(kinds.has('sit'), 'Expected sit hooks');
  assert.ok(kinds.has('hinge'), 'Expected hinge hook for rustic door/cabinet');
  assert.ok(kinds.has('toggle_light'), 'Expected toggle_light hook for emissive hearth');
  assert.ok(kinds.has('station'), 'Expected station hooks');
  assert.ok(kinds.has('audio_emitter'), 'Expected spatial audio emitter hooks');

  const ryokan: InteriorRoomInput = {
    ...room,
    room_id: 'ryokan',
    style_dna: { arch: 'japanese', furn: 'japanese', mood: 'zen_daylight', organic: 0.1 },
    volumes: [
      {
        kind: 'partition',
        id: 'shoji',
        style: 'sliding_shoji',
        axis: 'x',
        at_pos: 5,
        span_from: 1,
        span_to: 8,
      },
      {
        kind: 'alcove',
        id: 'tokonoma',
        alcove_kind: 'tokonoma',
        wall: 'north',
        at_u: 3,
        width_b: 3,
        height_b: 2,
      },
    ],
    props: [{ id: 'cushions_1', kind: 'cushions', at: [4, 1, 4], facing: 'north', seat_count: 4 }],
    stories: [
      {
        id: 'tea',
        kind: 'tea_ceremony',
        on_target: 'low_table',
        surface_y_16: 22,
        center_xz_16: [64, 64],
        facing: 'north',
      },
    ],
  };
  const ryokanMeta = emitPlayableInteriorMeta(ryokan, ir);
  assert.ok(ryokanMeta.hooks.some((h) => h.kind === 'slide'));
  assert.ok(ryokanMeta.hooks.some((h) => h.kind === 'audio_emitter' && h.cue_kind === 'chime'));
};

const testInteriorAuditPassAndFailureGates = (): void => {
  const room = makeTavernRoom(0.75, '#f59e42');
  const ir = makeTavernIr();
  const radiosity = computeInteriorRadiosity(room, ir);
  const sunShafts = generateInteriorSunShafts(room);
  const playableMeta = emitPlayableInteriorMeta(room, ir);
  const passInput: InteriorAuditInput = { room, ir, radiosity, sunShafts, playableMeta };
  const passReport = evaluateInteriorAudit(passInput);

  assert.equal(passReport.passed, true, JSON.stringify(passReport));
  assert.ok(passReport.score >= 75, `Expected passing score >= 75, got ${passReport.score}`);
  assert.ok(passReport.hard_gates.every((g) => g.passed));
  assert.equal(passReport.metrics.organic_calibration_delta, 0);
  assert.equal(passReport.metrics.volume_feature_count, 3);
  assert.equal(passReport.metrics.shell_layer_count, 5);

  const noisyZenRoom = {
    ...room,
    style_dna: {
      arch: 'japanese' as const,
      furn: 'japanese' as const,
      mood: 'zen_daylight' as const,
      organic: 0.9,
    },
  };
  const noisyZenReport = evaluateInteriorAudit({ ...passInput, room: noisyZenRoom });
  assert.ok(noisyZenReport.metrics.organic_calibration_delta >= 0.79);
  const zenOrgSub = noisyZenReport.submetrics.find((s) => s.id === 'interior.organic')!;
  assert.ok(zenOrgSub.score < 2);

  const badNbt: VanillaNbtLoweringIR = {
    data_version: 3955,
    size: [10, 6, 10],
    palette: ['minecraft:air', 'minecraft:oak_planks'],
    blocks: [],
    clearance: {
      min_headroom_b: 1,
      floating_block_count: 2,
      blocked_opening_count: 1,
      passed: false,
    },
  };
  const failNbtReport = evaluateInteriorAudit({ ...passInput, nbt: badNbt });
  assert.equal(failNbtReport.passed, false);
  assert.ok(failNbtReport.score <= 45);
  assert.equal(failNbtReport.hard_gates.find((g) => g.id === 'vanilla_headroom')!.passed, false);
  assert.equal(failNbtReport.hard_gates.find((g) => g.id === 'no_floating_blocks')!.passed, false);
  assert.equal(failNbtReport.hard_gates.find((g) => g.id === 'unblocked_openings')!.passed, false);

  const blockedIr: InteriorSubVoxelIR = {
    ...ir,
    boxes: [
      ...ir.boxes,
      box('door_blocker', [68, 16, 148], [80, 44, 158], 'spruce_planks', 'opaque', {
        semantic_tag: 'counter',
      }),
      box('floating_crate', [96, 48, 96], [112, 64, 112], 'oak_planks', 'opaque', {
        semantic_tag: 'prop',
      }),
    ],
    clear_path_cells: [],
  };
  const directFail = evaluateInteriorAudit({ ...passInput, ir: blockedIr });
  assert.equal(directFail.passed, false);
  assert.ok(directFail.metrics.blocked_opening_count >= 1);
  assert.ok(directFail.metrics.floating_block_count >= 1);
  assert.equal(directFail.metrics.clear_path_ratio, 0);
};

const testContactAoPropagationAndOversizedPropRejection = (): void => {
  const makeAoSrc = (ao: number) => `ashfox 1
structure ao_room {
  size = (9b, 7b, 9b);
  palette { oak = "minecraft:oak_planks"; door = "minecraft:oak_door[facing=north,half=lower,hinge=left,open=false]"; }
  floor f { y = 0b; height = 5b;
    room r { from = (1b, 1b); size = (7b, 7b); kind = living; floor = oak; wall = oak; ceiling = oak;
      interior {
        dna { arch = rustic; organic = 0; }
        lighting { contact_ao_strength = ${ao}; }
        table tbl { at = (4, 1, 4); size = (2, 1); facing = north; }
      }
    }
    facade r.south { door { at = center; width = 1b; height = 2b; block = door; } }
  }
}`;
  const compileAoColorAvg = (ao: number): number => {
    const u = new Map([['a.ashfox', parseStructureSource(makeAoSrc(ao), 'a.ashfox')]]);
    const p = compileStructureUnits('a.ashfox', u, {}, (_o, s) => s);
    const batches = new Map<string, BatchDraft>();
    emitInteriorBakedMeshes(p.grid, batches, {}, 99);
    const cols = [...batches.values()].flatMap((b) => b.colors);
    return cols.reduce((acc, v) => acc + v, 0) / cols.length;
  };
  assert.ok(compileAoColorAvg(0) > compileAoColorAvg(0.85));
  const badSrc =
    'ashfox 1 structure x { size = (9b, 6b, 9b); floor f { y = 0b; height = 5b; room r { from = (0b, 0b); size = (9b, 9b); kind = living; interior { table huge { size = (1000000, 1000000); } } } } }';
  assert.throws(() => parseStructureSource(badSrc, 'x.ashfox'), StructureInputError);
  const huge = {
    id: 'huge',
    kind: 'table',
    at: [2, 1, 2],
    size: [1_000_000, 1_000_000],
    facing: 'north',
  } as const;
  assert.equal(propFitsBounds(huge, 2, 2, { x0: 1, x1: 8, z0: 1, z1: 8 }), false);
  assert.equal(mountInstanceRotation('north', 90), 270);
  assert.equal(mountInstanceRotation('east', 90), 180);
};

testTwoBounceRadiosityAndPerformance();
testStainedGlassAndSubVoxelContactAo();
testSunShaftsPanesAndPlayableHooks();
testInteriorAuditPassAndFailureGates();
testContactAoPropagationAndOversizedPropRejection();
