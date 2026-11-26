import assert from 'node:assert/strict';
import { decodeStructureNbt } from '../../src/compiler/structure/nbt';
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
  const japandi = parseClosedStyleDna({
    arch: 'modern',
    furn: 'japanese',
    mood: 'zen_daylight',
    organic: 0.12,
  });
  assert.equal(japandi.arch, 'modern');
  assert.equal(japandi.furn, 'japanese');

  assert.throws(
    () => parseClosedStyleDna({ arch: 'rustic', unknownKey: 1 }),
    InteriorContractError,
  );
  assert.throws(() => parseClosedStyleDna({ arch: 'baroque' }), InteriorContractError);
  assert.throws(() => parseClosedStyleDna({ arch: 'scifi', organic: 1.5 }), InteriorContractError);
  assert.throws(() => parseClosedStyleDna({ arch: 'scifi', mood: 'neon' }), InteriorContractError);
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
  assert.ok(shell.boxes.some((b) => b.semantic_tag === 'floor_tatami'));
  assert.ok(shell.boxes.some((b) => b.semantic_tag === 'baseboard_trim'));
  assert.ok(shell.boxes.some((b) => b.semantic_tag === 'wainscot_shoji_lattice'));
  assert.ok(shell.boxes.some((b) => b.semantic_tag === 'molding_timber_cornice'));
  assert.ok(shell.boxes.some((b) => b.semantic_tag === 'ceiling_slatted'));

  const doorBaseboards = shell.boxes.filter(
    (b) =>
      b.semantic_tag === 'baseboard_trim' &&
      b.id.startsWith('bb_south_') &&
      (b.id.endsWith('_5') || b.id.endsWith('_6')),
  );
  assert.equal(doorBaseboards.length, 0, 'baseboard must skip floor-level door openings');

  assert.deepEqual(shell.corbel_blocked_cells, [
    [5, 2, 5],
    [5, 2, 9],
  ]);
  const guard = filterSafeExteriorCorbels(
    [
      [4, 2, 4],
      [0, 2, 4],
    ],
    [{ from: ryokan.bounds_from, to: ryokan.bounds_to, enclosed: true }],
    ryokan.openings,
  );
  assert.deepEqual(guard.blocked, [[4, 2, 4]]);
  assert.deepEqual(guard.safe, [[0, 2, 4]]);

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
  assert.ok(vol.boxes.some((b) => b.semantic_tag === 'volume_mezzanine'));
  assert.ok(vol.boxes.some((b) => b.semantic_tag === 'railing_timber'));
  assert.ok(vol.boxes.some((b) => b.semantic_tag === 'truss_king_post'));
  assert.ok(vol.boxes.some((b) => b.semantic_tag === 'truss_ridge'));
  assert.ok(vol.boxes.some((b) => b.semantic_tag === 'volume_sunken'));
  assert.ok(vol.boxes.some((b) => b.semantic_tag === 'alcove_fireplace'));
  assert.ok(vol.boxes.some((b) => b.semantic_tag === 'partition_colonnade'));
  assert.equal(vol.zone_surfaces.length, 2);
  assert.ok(vol.alcove_carves.length >= 4);
  assert.ok(vol.doorway_clearances.length >= 2);

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
    assert.equal(lowered.data_version, VANILLA_NBT_DATA_VERSION);
    assert.equal(lowered.clearance.passed, true);
    assert.ok(lowered.clearance.min_headroom_b >= 2);
    assert.equal(lowered.clearance.floating_block_count, 0);
    assert.equal(lowered.clearance.blocked_opening_count, 0);

    const bytesA = encodeLoweredVanillaNbt(lowered, room.room_id);
    const bytesB = encodeLoweredVanillaNbt(lowerInteriorToVanillaNbt(room, ir), room.room_id);
    assert.deepEqual(bytesA, bytesB, 'NBT lowering must be byte-deterministic');
    const decoded = decodeStructureNbt(bytesA);
    assert.equal(decoded.dataVersion, 3955);
    assert.deepEqual(decoded.size, lowered.size);
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
  assert.equal(
    solved.clearance.clear_path_cells.some((c) => c[0] === 1 && c[2] === 3),
    false,
  );
  assert.equal(solved.placed_props[0]!.nudged, true);

  const nbt = lowerInteriorToVanillaNbt(regRoom);
  assert.equal(
    nbt.blocks.some((b) => b.pos[2] >= 8 && b.state.includes('slab')),
    true,
  );
  assert.equal(
    nbt.blocks.some((b) => b.pos[2] <= 2 && b.pos[1] === 1 && b.state.includes('slab')),
    false,
  );
  const shell = buildInteriorShell(regRoom);
  assert.equal(
    shell.boxes.some(
      (b) =>
        (b.semantic_tag ?? '').startsWith('floor_') &&
        b.from_16[0] >= 64 &&
        b.to_16[0] <= 96 &&
        b.from_16[2] >= 64 &&
        b.to_16[2] <= 96,
    ),
    false,
  );

  // Verify omitted doorway_at/doorway_width matches centered 2-wide geometry doorway across solver and volumes.
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
  assert.equal(screenSolved.clearance.passed, true);
  assert.equal(
    screenSolved.clearance.clear_path_cells.some((c) => c[2] < 5),
    true,
  );

  // Verify nested props inside explicit-from platform anchor & stay inside platform bounds under collision nudging.
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
  for (const np of nestedProps) {
    assert.ok(np.at[0] >= 1 && np.at[0] <= 2 && np.at[2] >= 1 && np.at[2] <= 2);
    assert.equal(np.at[1], 1.25);
  }
  const daisSolved = solveInteriorLayout({
    ...screenRoom,
    volumes: nestedVols,
    props: nestedProps,
  });
  const [p1, p2] = daisSolved.placed_props;
  assert.ok(p1 && p2);
  assert.notDeepEqual(
    [p1.resolved_at[0], p1.resolved_at[2]],
    [p2.resolved_at[0], p2.resolved_at[2]],
  );
  for (const pp of daisSolved.placed_props) {
    assert.ok(
      pp.resolved_at[0] >= 1 &&
        pp.resolved_at[0] <= 2 &&
        pp.resolved_at[2] >= 1 &&
        pp.resolved_at[2] <= 2,
    );
  }
};

testClosedStyleDnaContract();
testFiveLayerShellAndCorbelGuard();
testSculptedSpatialVolumes();
testVanillaNbtLoweringInvariants();
testVolumeZoneAndDoorwayRegressions();
