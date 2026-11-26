import assert from 'node:assert/strict';
import type {
  InteriorDraperyKind,
  InteriorPropKind,
  InteriorRoomInput,
  InteriorStoryKind,
  StyleDna,
} from '../../src/compiler/structure/interior/contract';
import {
  compileAllDraperies,
  compileDrapery,
  sampleCatenaryPoint,
} from '../../src/compiler/structure/interior/drapery';
import {
  compileInteriorProp,
  compileInteriorProps,
  computeOrganicTransform,
  propSurfaceHeight16,
} from '../../src/compiler/structure/interior/props';
import {
  solveInteriorLayout,
  validateClearPath,
} from '../../src/compiler/structure/interior/solver';
import { compileStoryVignette } from '../../src/compiler/structure/interior/vignettes';

const ZEN_DNA: StyleDna = { arch: 'japanese', furn: 'japanese', mood: 'zen_daylight', organic: 0 };
const TAVERN_DNA: StyleDna = {
  arch: 'rustic',
  furn: 'rustic',
  mood: 'warm_hearth',
  organic: 0.8,
};
const SCIFI_DNA: StyleDna = {
  arch: 'scifi',
  furn: 'scifi',
  mood: 'cyber_neon',
  organic: 0.25,
};

const testParametricPropsAndAutoJoin = (): void => {
  const kinds: readonly InteriorPropKind[] = [
    'tables',
    'l_counter',
    'sofas',
    'shelving',
    'terminals',
    'dining_set',
    'low_table',
    'cushions',
    'fireplace',
    'barrel_rack',
    'display_case',
    'cabinet',
    'holo_screen',
    'swivel_chair',
  ];
  for (const kind of kinds) {
    const res = compileInteriorProp(
      { id: `p_${kind}`, kind, at: [2, 1, 2], size: [2, 1], facing: 'north' },
      TAVERN_DNA,
      404,
    );
    assert.ok(res.boxes.length > 0, `expected boxes for ${kind}`);
  }
  const singleSofa = compileInteriorProps(
    [{ id: 's1', kind: 'sofas', at: [2, 1, 2], size: [1, 1], facing: 'north' }],
    ZEN_DNA,
    11,
  );
  const joinedSofas = compileInteriorProps(
    [
      { id: 's1', kind: 'sofas', at: [2, 1, 2], size: [1, 1], facing: 'north' },
      { id: 's2', kind: 'sofas', at: [3, 1, 2], size: [1, 1], facing: 'north' },
    ],
    ZEN_DNA,
    11,
  );
  assert.ok(
    joinedSofas.boxes.length < singleSofa.boxes.length * 2,
    'auto-joined sofas must omit inner shared armrests',
  );
  const singleTables = compileInteriorProps(
    [{ id: 't1', kind: 'tables', at: [2, 1, 2], size: [1, 1], facing: 'north' }],
    TAVERN_DNA,
    11,
  );
  const joinedTables = compileInteriorProps(
    [
      { id: 't1', kind: 'tables', at: [2, 1, 2], size: [1, 1], facing: 'north' },
      { id: 't2', kind: 'tables', at: [3, 1, 2], size: [1, 1], facing: 'north' },
    ],
    TAVERN_DNA,
    11,
  );
  assert.ok(
    joinedTables.boxes.length < singleTables.boxes.length * 2,
    'auto-joined tables must suppress inner corner legs',
  );
};

const testOrganicAndMounts = (): void => {
  const zen = computeOrganicTransform(77, 'chair_1', 0, undefined, true);
  assert.equal(zen.rotation_y_deg, 0);
  assert.equal(zen.offset_x_16, 0);
  assert.equal(zen.offset_z_16, 0);

  const livelyA = computeOrganicTransform(77, 'chair_1', 0.85, undefined, true);
  const livelyB = computeOrganicTransform(77, 'chair_1', 0.85, undefined, true);
  assert.deepEqual(livelyA, livelyB);
  assert.ok(Math.abs(livelyA.rotation_y_deg) > 0 && Math.abs(livelyA.rotation_y_deg) <= 13.6);

  const dining = compileInteriorProp(
    { id: 'dine', kind: 'dining_set', at: [4, 1, 4], size: [3, 1], facing: 'north' },
    TAVERN_DNA,
    404,
  );
  const chairBoxes = dining.boxes.filter((b) => b.id.includes(':chair_'));
  assert.ok(chairBoxes.some((b) => Math.abs(b.rotation_y_deg ?? 0) >= 4));
  assert.equal(dining.hooks.filter((h) => h.kind === 'sit').length, 6);

  const hearth = compileInteriorProp(
    { id: 'fp', kind: 'fireplace', at: [2, 1, 2], size: [2, 1], facing: 'south' },
    TAVERN_DNA,
    404,
  );
  assert.ok(hearth.boxes.some((b) => b.id.includes('leaning_blade')));
  assert.ok(hearth.hooks.some((h) => h.kind === 'audio_emitter' && h.cue_kind === 'fire_loop'));

  const mountRes = compileInteriorProp(
    {
      id: 'bonsai',
      kind: 'custom_prop',
      at: [3, 1.25, 2],
      facing: 'south',
      mount_on: 'alcove',
      asset_alias: 'custom_bonsai',
    },
    ZEN_DNA,
    7,
  );
  assert.equal(mountRes.custom_mounts.length, 1);
  assert.equal(mountRes.custom_mounts[0]?.asset_alias, 'custom_bonsai');
  assert.equal(mountRes.custom_mounts[0]?.mount_on, 'alcove');
  assert.equal(mountRes.custom_mounts[0]?.at_16[1], 20);
};

const testStoryVignettes = (): void => {
  const stories: readonly InteriorStoryKind[] = [
    'tavern_meal',
    'tea_ceremony',
    'scholar_study',
    'modern_workspace',
    'scifi_diagnostics',
    'hearth_prep',
    'alchemy_brew',
  ];
  const lowTableSurf = 16 + propSurfaceHeight16('low_table');
  assert.equal(lowTableSurf, 24);
  for (const kind of stories) {
    const res = compileStoryVignette(
      {
        id: `st_${kind}`,
        kind,
        on_target: 'low_table',
        surface_y_16: lowTableSurf,
        center_xz_16: [40, 40],
        facing: 'north',
      },
      SCIFI_DNA,
      99,
    );
    assert.ok(res.boxes.length >= 4, `story ${kind} must emit micro-props`);
    for (const box of res.boxes) {
      assert.ok(
        box.from_16[1] >= lowTableSurf - 0.01,
        `story ${kind} seated at exact 1/16 surface`,
      );
    }
    assert.ok(res.hooks.some((h) => h.kind === 'station' && h.station_kind === kind));
  }
};

const testUniversalDrapery = (): void => {
  const mid = sampleCatenaryPoint([16, 64, 16], [80, 64, 16], 12, 0.5);
  const start = sampleCatenaryPoint([16, 64, 16], [80, 64, 16], 12, 0);
  const end = sampleCatenaryPoint([16, 64, 16], [80, 64, 16], 12, 1);
  assert.equal(start[1], 64);
  assert.equal(end[1], 64);
  assert.ok(Math.abs(mid[1] - 52) < 0.01, `catenary midpoint sag expected 52, got ${mid[1]}`);

  const kinds: readonly InteriorDraperyKind[] = [
    'curtains',
    'noren',
    'trailing_vine',
    'tapestry',
    'banner',
    'chains',
    'cables',
    'pipes',
  ];
  const specs = kinds.map((kind, i) => ({
    id: `d_${kind}`,
    kind,
    on_target: kind === 'noren' ? ('doors' as const) : ('windows' as const),
    from_16: [16, 64, 16 + i * 16] as const,
    to_16: [48, 32, 16 + i * 16] as const,
    facing: 'north' as const,
    sag_16: 8,
    tieback: kind === 'curtains',
    split_panels: kind === 'noren' ? 3 : 2,
  }));
  const all = compileAllDraperies(specs);
  for (const kind of kinds) {
    assert.ok(
      compileDrapery(specs.find((s) => s.kind === kind)!).length >= 3,
      `drapery ${kind} must emit >=3 subvoxel boxes`,
    );
  }
  assert.ok(all.length > 30);
};

const testBfsSolverAndClearPath = (): void => {
  const baseRoom: InteriorRoomInput = {
    room_id: 'taproom',
    kind: 'tavern',
    style_dna: TAVERN_DNA,
    architecture: {
      floor_pattern: 'plank',
      baseboard: 'stone_plinth',
      wainscot: 'paneled',
      ceiling: 'open_truss',
    },
    bounds_from: [0, 0, 0],
    bounds_to: [10, 5, 10],
    openings: [
      { id: 'main_door', kind: 'door', wall: 'south', from: [5, 1, 10], to: [5, 2, 10] },
      { id: 'win_w', kind: 'window', wall: 'west', from: [0, 2, 5], to: [0, 3, 5] },
    ],
    volumes: [
      { kind: 'mezzanine', id: 'mez', on: 'north', depth: 2, railing: 'timber', stair_at: [8, 8] },
    ],
    props: [
      { id: 'bad_door_table', kind: 'table', at: [5, 1, 9], size: [1, 1], facing: 'north' },
      { id: 'bad_win_shelf', kind: 'shelving', at: [1, 1, 5], size: [1, 1], facing: 'east' },
      { id: 'center_dine', kind: 'dining_set', at: [4, 1, 4], size: [2, 1], facing: 'north' },
    ],
    stories: [
      {
        id: 'meal_1',
        kind: 'tavern_meal',
        on_target: 'center_dine',
        surface_y_16: 0,
        center_xz_16: [80, 72],
        facing: 'north',
      },
    ],
    draperies: [
      {
        id: 'curtain_w',
        kind: 'curtains',
        on_target: 'windows',
        from_16: [16, 64, 80],
        to_16: [16, 32, 96],
        facing: 'west',
        sag_16: 4,
        tieback: true,
      },
    ],
    seed: 404,
  };

  const solvedA = solveInteriorLayout(baseRoom);
  const solvedB = solveInteriorLayout(baseRoom);
  assert.deepEqual(solvedA, solvedB, 'solver must be byte-deterministic');
  assert.equal(solvedA.clearance.passed, true);
  assert.equal(solvedA.clearance.blocked_opening_count, 0);
  assert.equal(solvedA.clearance.blocked_seat_count, 0);
  assert.equal(solvedA.clearance.blocked_stair_count, 0);
  assert.ok(solvedA.clearance.min_headroom_b >= 2);
  assert.ok(solvedA.placed_props.find((p) => p.id === 'bad_door_table')?.nudged);
  assert.ok(solvedA.placed_props.find((p) => p.id === 'bad_win_shelf')?.nudged);

  // Verify validator detects blocked doorway and low headroom when forced directly.
  const lowCeilBoxes = [
    {
      id: 'low_beam',
      from_16: [16, 32, 16] as const,
      to_16: [144, 48, 144] as const,
      tile_id: 'timber_trim',
      layer: 'opaque' as const,
    },
  ];
  const lowReport = validateClearPath(baseRoom, lowCeilBoxes);
  assert.equal(lowReport.passed, false);
  assert.equal(lowReport.blocked_opening_count, 1);

  // Verify partition walls block seat reachability when doorway is absent.
  const walledRoom: InteriorRoomInput = {
    ...baseRoom,
    volumes: [
      {
        kind: 'partition',
        id: 'wall_off',
        style: 'fusuma',
        axis: 'z',
        at_pos: 3,
        span_from: 1,
        span_to: 9,
      },
    ],
    props: [{ id: 'trapped_chair', kind: 'chair', at: [2, 1, 2], facing: 'south' }],
    stories: [],
    draperies: [],
  };
  const trappedCompiled = compileInteriorProps(walledRoom.props!, TAVERN_DNA, 1);
  const trappedReport = validateClearPath(walledRoom, trappedCompiled.boxes, trappedCompiled.hooks);
  assert.equal(trappedReport.passed, false);
  assert.equal(trappedReport.blocked_seat_count, 1);

  // Verify axis='x' partition spans X at fixed Z=at_pos, and story follows nudged target prop.
  const xPartitionRoom: InteriorRoomInput = {
    ...baseRoom,
    volumes: [
      {
        kind: 'partition',
        id: 'x_wall',
        style: 'sliding_shoji',
        axis: 'x',
        at_pos: 4,
        span_from: 1,
        span_to: 9,
      },
    ],
    props: [{ id: 'north_chair', kind: 'chair', at: [2, 1, 2], facing: 'south' }],
    stories: [],
    draperies: [],
  };
  const xPartSolved = solveInteriorLayout(xPartitionRoom);
  assert.equal(
    xPartSolved.clearance.clear_path_cells.some((c) => c[2] === 4),
    false,
    'axis=x partition at z=4 must block clear_path along z=4',
  );
  assert.equal(xPartSolved.clearance.blocked_seat_count, 1);

  const nudgeStoryRoom: InteriorRoomInput = {
    ...baseRoom,
    volumes: [],
    props: [{ id: 'tea_tbl', kind: 'low_table', at: [5, 1, 8], size: [1, 1], facing: 'north' }],
    stories: [
      {
        id: 'tea_story',
        kind: 'tea_ceremony',
        on_target: 'tea_tbl',
        surface_y_16: 24,
        center_xz_16: [5.5 * 16, 8.5 * 16],
        facing: 'north',
      },
    ],
    draperies: [],
  };
  const nudgedSolved = solveInteriorLayout(nudgeStoryRoom);
  const movedTbl = nudgedSolved.placed_props.find((p) => p.id === 'tea_tbl')!;
  assert.equal(movedTbl.nudged, true);
  const storyHook = nudgedSolved.hooks.find(
    (h) => h.kind === 'station' && h.station_kind === 'tea_ceremony',
  )!;
  assert.ok(storyHook, 'Expected station hook for tea_ceremony');
  assert.ok(
    Math.abs(storyHook.position[0] - (movedTbl.resolved_at[0] + 0.5)) < 0.01 &&
      Math.abs(storyHook.position[2] - (movedTbl.resolved_at[2] + 0.5)) < 0.01,
    `Expected story to move to nudged table ${JSON.stringify(movedTbl.resolved_at)}, got ${JSON.stringify(storyHook.position)}`,
  );
};

testParametricPropsAndAutoJoin();
testOrganicAndMounts();
testStoryVignettes();
testUniversalDrapery();
testBfsSolverAndClearPath();
console.log('ashfox interior props, drapery & bfs solver tests ok');
