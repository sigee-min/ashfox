import assert from 'node:assert/strict';
import { decodeStructureNbt } from '../../src/compiler/structure/nbt';
import { parseStructureSource } from '../../src/index';
import { StructureInputError } from '../../src/project/structure/contract';
import {
  InteriorContractError,
  STYLE_DNA_ARCHES,
  STYLE_DNA_MOODS,
  VANILLA_NBT_DATA_VERSION,
  parseClosedStyleDna,
  type InteriorRoomInput,
  type InteriorSubVoxelIR,
} from '../../src/compiler/structure/interior/contract';
import {
  encodeLoweredVanillaNbt,
  lowerInteriorToVanillaNbt,
} from '../../src/compiler/structure/interior/nbtLower';
import {
  buildInteriorShell,
  filterSafeExteriorCorbels,
} from '../../src/compiler/structure/interior/shell';
import { lowerVolumeAst } from '../../src/compiler/structure/interior/lowerItems';
import { solveInteriorLayout } from '../../src/compiler/structure/interior/solver';
import { buildSculptedVolumes } from '../../src/compiler/structure/interior/volume';

const makeRyokanRoom = (): InteriorRoomInput => ({
  room_id: 'main_tatami',
  kind: 'living',
  style_dna: parseClosedStyleDna({
    arch: 'japanese',
    furn: 'japanese',
    mood: 'zen_daylight',
    organic: 0.1,
  }),
  architecture: {
    floor_pattern: 'tatami',
    baseboard: 'trim',
    wainscot: 'shoji_lattice',
    molding: 'timber_cornice',
    ceiling: 'slatted',
  },
  bounds_from: [1, 0, 1],
  bounds_to: [11, 5, 9],
  openings: [
    {
      id: 'entry_door',
      kind: 'door',
      wall: 'south',
      from: [5, 1, 9],
      to: [6, 2, 9],
      hinge: 'left',
    },
    { id: 'garden_win', kind: 'window', wall: 'east', from: [11, 2, 4], to: [11, 3, 6] },
  ],
  volumes: [
    {
      kind: 'platform',
      id: 'tokonoma',
      on: 'north',
      size: [4, 2],
      height_16: 4,
      step_facing: 'south',
    },
    {
      kind: 'alcove',
      id: 'toko_niche',
      alcove_kind: 'tokonoma',
      wall: 'north',
      at_u: 3,
      width_b: 2,
      height_b: 2,
    },
    {
      kind: 'partition',
      id: 'shoji_screen',
      style: 'sliding_shoji',
      axis: 'x',
      at_pos: 5,
      span_from: 2,
      span_to: 10,
      doorway_at: 5,
      doorway_width: 2,
      open_ratio: 0.5,
    },
  ],
  seed: 101,
});

const makeTavernRoom = (): InteriorRoomInput => ({
  room_id: 'taproom',
  kind: 'tavern',
  style_dna: parseClosedStyleDna({
    arch: 'rustic',
    furn: 'rustic',
    mood: 'warm_hearth',
    organic: 0.75,
  }),
  architecture: {
    floor_pattern: 'plank',
    baseboard: 'stone_plinth',
    wainscot: 'paneled',
    molding: 'timber_cornice',
    ceiling: 'open_truss',
  },
  bounds_from: [1, 0, 1],
  bounds_to: [15, 7, 11],
  openings: [
    {
      id: 'main_door',
      kind: 'door',
      wall: 'south',
      from: [3, 1, 11],
      to: [4, 2, 11],
      hinge: 'left',
    },
    { id: 'arch_way', kind: 'arch', wall: 'west', from: [1, 1, 5], to: [1, 3, 6] },
    { id: 'west_win', kind: 'window', wall: 'east', from: [15, 2, 4], to: [15, 3, 7] },
  ],
  volumes: [
    {
      kind: 'mezzanine',
      id: 'loft',
      on: 'north',
      depth: 3,
      y_offset_b: 3,
      railing: 'timber',
      support_pillars: true,
    },
    { kind: 'open_truss', id: 'roof_truss', style: 'king_post', axis: 'x', bay_spacing_b: 2 },
    { kind: 'sunken', id: 'hearth_pit', on: 'sw', size: [4, 3], height_16: -4, railing: 'none' },
    {
      kind: 'alcove',
      id: 'hearth_niche',
      alcove_kind: 'fireplace',
      wall: 'north',
      at_u: 1,
      width_b: 2,
      height_b: 2,
    },
    {
      kind: 'partition',
      id: 'booth_cols',
      style: 'colonnade',
      axis: 'z',
      at_pos: 9,
      span_from: 2,
      span_to: 10,
      doorway_at: 5,
      doorway_width: 2,
    },
  ],
  seed: 404,
});

const testClosedStyleDnaContract = (): void => {
  for (const arch of STYLE_DNA_ARCHES) {
    for (const furn of STYLE_DNA_ARCHES) {
      const dna = parseClosedStyleDna({ arch, furn });
      assert.equal(dna.arch, arch);
      assert.equal(dna.furn, furn);
      assert.ok(STYLE_DNA_MOODS.includes(dna.mood));
      assert.ok(dna.organic >= 0 && dna.organic <= 1);
    }
  }
  const j = parseClosedStyleDna({ arch: 'modern', furn: 'japanese', organic: 0.12 });
  assert.deepEqual([j.arch, j.furn, j.organic], ['modern', 'japanese', 0.12]);

  for (const bad of [
    { arch: 'rustic', unknownKey: 1 },
    { arch: 'baroque' },
    { arch: 'scifi', organic: 1.5 },
    { arch: 'scifi', mood: 'neon' },
  ])
    assert.throws(() => parseClosedStyleDna(bad), InteriorContractError);
};

const testFiveLayerShellAndCorbelGuard = (): void => {
  const ryokan = makeRyokanRoom();
  const shell = buildInteriorShell(ryokan, [
    [5, 2, 5],
    [5, 2, 9],
    [0, 2, 5],
    [12, 3, 5],
  ]);
  assert.equal(shell.shell_layer_count, 5);
  for (const t of 'floor_tatami,baseboard_trim,wainscot_shoji_lattice,molding_timber_cornice,ceiling_slatted'.split(
    ',',
  ))
    assert.ok(shell.boxes.some((b) => b.semantic_tag === t));
  const doorBaseboards = shell.boxes.filter(
    (b) =>
      b.semantic_tag === 'baseboard_trim' &&
      b.id.startsWith('bb_south_') &&
      (b.id.endsWith('_5') || b.id.endsWith('_6')),
  );
  assert.equal(doorBaseboards.length, 0);
  const guard = filterSafeExteriorCorbels(
    [
      [4, 2, 4],
      [0, 2, 4],
    ],
    [{ from: ryokan.bounds_from, to: ryokan.bounds_to, enclosed: true }],
    ryokan.openings,
  );
  assert.deepEqual(shell.corbel_blocked_cells, [
    [5, 2, 5],
    [5, 2, 9],
  ]);
  assert.deepEqual([guard.blocked, guard.safe], [[[4, 2, 4]], [[0, 2, 4]]]);

  const scifiShell = buildInteriorShell({
    ...ryokan,
    style_dna: parseClosedStyleDna({ arch: 'scifi', mood: 'cyber_neon', organic: 0.2 }),
    architecture: {
      floor_pattern: 'grate',
      baseboard: 'led_strip',
      wainscot: 'tech_ribbed',
      molding: 'neon_channel',
      ceiling: 'coffered',
      strip_light_color: '#4ce8ff',
    },
  });
  assert.ok(scifiShell.boxes.some((b) => b.layer === 'emissive' && b.color_tint === '#4ce8ff'));
};

const testSculptedSpatialVolumes = (): void => {
  const tavern = makeTavernRoom();
  const vol = buildSculptedVolumes(tavern);
  for (const t of 'volume_mezzanine,railing_timber,truss_king_post,truss_ridge,volume_sunken,alcove_fireplace,partition_colonnade'.split(
    ',',
  ))
    assert.ok(vol.boxes.some((b) => b.semantic_tag === t));
  assert.equal(vol.zone_surfaces.length, 2);
  assert.ok(vol.alcove_carves.length >= 4 && vol.doorway_clearances.length >= 2);
  assert.throws(
    () =>
      buildSculptedVolumes({
        ...tavern,
        volumes: [{ kind: 'platform', id: 'bad', size: [3, 2], height_16: 2 }],
      }),
    InteriorContractError,
  );
};

const testVanillaNbtLoweringInvariants = (): void => {
  const ryokan = makeRyokanRoom();
  const tavern = makeTavernRoom();
  const adversarialIR: InteriorSubVoxelIR = {
    room_id: tavern.room_id,
    units_per_block: 16,
    boxes: [
      {
        id: 'float_lamp',
        from_16: [96, 48, 96],
        to_16: [104, 56, 104],
        tile_id: 'lantern',
        layer: 'emissive',
      },
      {
        id: 'door_blocker',
        from_16: [48, 16, 160],
        to_16: [64, 32, 176],
        tile_id: 'lantern',
        layer: 'emissive',
      },
    ],
    clear_path_cells: [],
    corbel_blocked_cells: [],
  };

  for (const [room, ir] of [
    [ryokan, undefined],
    [tavern, adversarialIR],
  ] as const) {
    const lowered = lowerInteriorToVanillaNbt(room, ir);
    assert.ok(
      lowered.data_version === VANILLA_NBT_DATA_VERSION &&
        lowered.clearance.passed &&
        lowered.clearance.min_headroom_b >= 2 &&
        lowered.clearance.floating_block_count === 0 &&
        lowered.clearance.blocked_opening_count === 0,
    );
    const bytesA = encodeLoweredVanillaNbt(lowered, room.room_id);
    assert.deepEqual(
      bytesA,
      encodeLoweredVanillaNbt(lowerInteriorToVanillaNbt(room, ir), room.room_id),
    );
    const decoded = decodeStructureNbt(bytesA);
    assert.deepEqual([decoded.dataVersion, decoded.size], [3955, lowered.size]);
  }
};

const testVolumeZoneAndDoorwayRegressions = (): void => {
  const base = makeRyokanRoom();
  const regRoom: InteriorRoomInput = {
    ...base,
    room_id: 'reg_room',
    bounds_from: [0, 0, 0],
    bounds_to: [10, 7, 10],
    openings: [{ id: 'd', kind: 'door', wall: 'south', from: [5, 1, 10], to: [5, 2, 10] }],
    volumes: [
      {
        kind: 'mezzanine',
        id: 'mez',
        on: 'north',
        depth: 3,
        y_offset_b: 3,
        railing: 'timber',
        support_pillars: true,
      },
      { kind: 'platform', id: 'south_stage', on: 'south', size: [3, 2], height_16: 4 },
      { kind: 'sunken', id: 'pit', from: [4, 4], size: [2, 2], height_16: -4 },
    ],
    props: [{ id: 'at_pillar', kind: 'chair', at: [1, 1, 3], size: [1, 1], facing: 'south' }],
    stories: [],
    draperies: [],
    seed: 11,
  };
  const volumes = buildSculptedVolumes(regRoom);
  const solved = solveInteriorLayout(regRoom, volumes.boxes);
  assert.ok(
    !solved.clearance.clear_path_cells.some((c) => c[0] === 1 && c[2] === 3) &&
      solved.placed_props[0]!.nudged,
  );
  const nbt = lowerInteriorToVanillaNbt(regRoom);
  assert.ok(
    nbt.blocks.some((b) => b.pos[2] >= 8 && b.state.includes('slab')) &&
      !nbt.blocks.some((b) => b.pos[2] <= 2 && b.pos[1] === 1 && b.state.includes('slab')),
  );
  const shell = buildInteriorShell(regRoom);
  const pitHit = shell.boxes.some(
    (b) =>
      (b.semantic_tag ?? '').startsWith('floor_') &&
      b.from_16[0] >= 64 &&
      b.to_16[0] <= 96 &&
      b.from_16[2] >= 64 &&
      b.to_16[2] <= 96,
  );
  assert.equal(pitHit, false);

  const screenRoom: InteriorRoomInput = {
    ...regRoom,
    bounds_to: [10, 8, 10],
    openings: [{ id: 's_door', kind: 'door', wall: 'south', from: [5, 1, 10], to: [6, 2, 10] }],
    volumes: [
      {
        kind: 'partition',
        id: 'screen',
        style: 'screen',
        axis: 'x',
        at_pos: 5,
        span_from: 1,
        span_to: 9,
      },
    ],
    props: [],
  };
  const screenVol = buildSculptedVolumes(screenRoom);
  assert.deepEqual(screenVol.doorway_clearances, [
    [5, 1, 5],
    [6, 1, 5],
  ]);
  const screenSolved = solveInteriorLayout(screenRoom, screenVol.boxes);
  assert.ok(
    screenSolved.clearance.passed && screenSolved.clearance.clear_path_cells.some((c) => c[2] < 5),
  );

  const nestedVols: InteriorRoomInput['volumes'][number][] = [];
  const nestedProps: NonNullable<InteriorRoomInput['props']>[number][] = [];
  lowerVolumeAst(
    {
      kind: 'platform',
      id: 'dais',
      from: [1, 1],
      size: [2, 2],
      height_16: 4,
      nested: [
        { item: 'prop', spec: { id: 'p_c1', kind: 'chair' } },
        { item: 'prop', spec: { id: 'p_c2', kind: 'chair' } },
      ],
    },
    {
      name: 'r1',
      kind: 'room',
      acousticSpace: 'timber_room',
      from: [0, 0, 0],
      to: [10, 8, 10],
      enclosed: true,
    },
    nestedVols,
    nestedProps,
    [],
  );
  const in12 = (x: number, z: number) => x >= 1 && x <= 2 && z >= 1 && z <= 2;
  assert.ok(nestedProps.every((p) => in12(p.at[0], p.at[2]) && p.at[1] === 1.25));
  const daisSolved = solveInteriorLayout({
    ...screenRoom,
    volumes: nestedVols,
    props: nestedProps,
  });
  const [p1, p2] = daisSolved.placed_props;
  assert.ok(
    p1 &&
      p2 &&
      (p1.resolved_at[0] !== p2.resolved_at[0] || p1.resolved_at[2] !== p2.resolved_at[2]),
  );
  assert.ok(daisSolved.placed_props.every((p) => in12(p.resolved_at[0], p.resolved_at[2])));
  const chairSolve = solveInteriorLayout({
    ...screenRoom,
    volumes: [],
    props: [
      { id: 'd_tbl', kind: 'dining_set', at: [4, 1, 4], size: [3, 1], facing: 'north' },
      { id: 'adj_cab', kind: 'cabinet', at: [4, 1, 3], size: [1, 1], facing: 'south' },
    ],
  });
  assert.equal(chairSolve.placed_props.find((p) => p.id === 'adj_cab')?.nudged, true);
  const badPartSrc =
    'ashfox 1 structure p { size = (11b, 8b, 11b); floor f { y = 0b; height = 6b; room r { from = (0b, 0b); size = (11b, 11b); kind = living; interior { partition s { style = screen; span_from = 1; span_to = 1000000000; } } } } }';
  assert.throws(() => parseStructureSource(badPartSrc, 'p.ashfox'), StructureInputError);
  const colPart = {
    kind: 'partition',
    id: 'cols',
    style: 'colonnade',
    axis: 'x',
    at_pos: 5,
    span_from: 1,
    span_to: 9,
    doorway_width: 0,
  } as const;
  const bigPart = { ...colPart, id: 'big', style: 'screen', span_to: 1_000_000_000 } as const;
  const clampedVol = buildSculptedVolumes({ ...screenRoom, volumes: [bigPart] });
  assert.ok(clampedVol.boxes.length <= 9 && clampedVol.boxes.length > 0);
  const colonnadeSolved = solveInteriorLayout({ ...screenRoom, volumes: [colPart], props: [] });
  assert.equal(
    colonnadeSolved.clearance.clear_path_cells.some((c) => c[0] === 2 && c[2] === 5),
    true,
  );
  const mezStack = solveInteriorLayout({
    ...screenRoom,
    volumes: [
      { kind: 'mezzanine', id: 'loft', on: 'north', depth: 4, y_offset_b: 4, railing: 'timber' },
    ],
    props: [
      { id: 'gf_tbl', kind: 'table', at: [4, 1, 4], size: [1, 1], facing: 'north' },
      { id: 'mz_chr', kind: 'chair', at: [4, 5, 4], size: [1, 1], facing: 'south' },
    ],
  });
  assert.equal(
    mezStack.placed_props.every((p) => !p.nudged),
    true,
  );
  const lowMez: InteriorRoomInput = {
    ...regRoom,
    volumes: [
      {
        kind: 'mezzanine',
        id: 'l2',
        on: 'north',
        depth: 3,
        y_offset_b: 2,
        railing: 'timber',
        support_pillars: false,
      },
    ],
    props: [{ id: 'fp', kind: 'fireplace', at: [4, 1, 2], size: [2, 1], facing: 'south' }],
  };
  for (const res of [
    solveInteriorLayout(lowMez),
    solveInteriorLayout(lowMez, buildSculptedVolumes(lowMez).boxes),
  ]) {
    const fp = res.placed_props.find((p) => p.id === 'fp')!;
    assert.ok(fp.nudged && fp.resolved_at[2] >= 4);
  }
  const splitSolved = solveInteriorLayout({
    ...screenRoom,
    openings: [
      { id: 'n_door', kind: 'door', wall: 'north', from: [5, 1, 0], to: [5, 2, 0] },
      { id: 's_door', kind: 'door', wall: 'south', from: [5, 1, 10], to: [5, 2, 10] },
    ],
    volumes: [{ ...colPart, id: 'wall', style: 'screen', doorway_width: 0 }],
    props: [],
  });
  assert.ok(!splitSolved.clearance.passed && splitSolved.clearance.blocked_opening_count >= 1);
  assert.equal(
    splitSolved.clearance.clear_path_cells.every((c) => c[2] < 5),
    true,
  );
};

testClosedStyleDnaContract();
testFiveLayerShellAndCorbelGuard();
testSculptedSpatialVolumes();
testVanillaNbtLoweringInvariants();
testVolumeZoneAndDoorwayRegressions();
