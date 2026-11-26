import assert from 'node:assert/strict';
import {
  evaluateStructureQuality,
  type StructureGrid,
  type StructureProduct,
} from '../../src/index';

type StructureBakedMesh = StructureProduct['bakedMesh'];
type StructureLightingField = StructureProduct['lighting'];

const makeGrid = (
  size: readonly [number, number, number],
  overrides: Partial<StructureGrid> = {},
): {
  readonly grid: StructureGrid;
  readonly voxels: Int32Array;
  readonly customTags: (string | null)[];
  readonly states: string[];
  readonly set: (x: number, y: number, z: number, state: string) => void;
} => {
  const [w, h, d] = size;
  const voxels = new Int32Array(w * h * d).fill(-1);
  const states = ['minecraft:air'];
  const stateIdx = new Map<string, number>([['minecraft:air', 0]]);
  const customTags = new Array<string | null>(w * h * d).fill(null);

  const set = (x: number, y: number, z: number, state: string): void => {
    let idx = stateIdx.get(state);
    if (idx === undefined) {
      idx = states.length;
      states.push(state);
      stateIdx.set(state, idx);
    }
    voxels[(y * d + z) * w + x] = idx;
  };

  const grid: StructureGrid = {
    id: 'test_struct',
    dataVersion: 3955,
    density: 2,
    seed: 1,
    size,
    states,
    voxels,
    customTags,
    customPlacements: [],
    floors: [],
    rooms: [],
    openings: [],
    sockets: [],
    hasRoofTrim: false,
    roofCount: 0,
    dormerCount: 0,
    chimneyCount: 0,
    semanticStats: {
      roomCount: 0,
      facadeCount: 0,
      stairCount: 0,
      furnishCount: 0,
      weatheringCount: 0,
      rawSetCount: 0,
    },
    ...overrides,
  };
  return { grid, voxels, customTags, states, set };
};

const emptyLighting = (size: readonly [number, number, number]): StructureLightingField => {
  const vol = size[0] * size[1] * size[2];
  return {
    size,
    sky: new Uint8Array(vol),
    blockR: new Uint8Array(vol),
    blockG: new Uint8Array(vol),
    blockB: new Uint8Array(vol),
  };
};

const emptyMesh: StructureBakedMesh = {
  batches: [],
  textures: {},
  instances: [],
  rawFaceCount: 0,
  mergedQuadCount: 0,
};

const fillBox = (
  set: (x: number, y: number, z: number, state: string) => void,
  from: readonly [number, number, number],
  to: readonly [number, number, number],
  state: string,
): void => {
  for (let y = from[1]; y <= to[1]; y += 1) {
    for (let z = from[2]; z <= to[2]; z += 1) {
      for (let x = from[0]; x <= to[0]; x += 1) set(x, y, z, state);
    }
  }
};

const buildBareBox = (opts: { readonly door?: boolean; readonly roof?: boolean }) => {
  const g = makeGrid([9, 7, 9]);
  fillBox(g.set, [1, 0, 1], [7, 0, 7], 'minecraft:cobblestone');
  fillBox(g.set, [1, 1, 1], [7, 4, 7], 'minecraft:cobblestone');
  fillBox(g.set, [2, 1, 2], [6, 4, 6], 'minecraft:air');
  if (opts.roof !== false) fillBox(g.set, [1, 5, 1], [7, 5, 7], 'minecraft:stone');
  if (opts.door !== false) {
    g.set(4, 1, 7, 'minecraft:oak_door[facing=north,half=lower,hinge=left,open=false]');
    g.set(4, 2, 7, 'minecraft:oak_door[facing=north,half=upper,hinge=left,open=false]');
  }
  g.set(4, 1, 4, 'minecraft:torch');
  return g;
};

const gateById = (report: ReturnType<typeof evaluateStructureQuality>, id: string) =>
  report.hardGates.find((gate) => gate.id === id)!;

const testHardGates = (): void => {
  const empty = makeGrid([5, 5, 5]);
  const emptyRep = evaluateStructureQuality(empty.grid, 0, emptyLighting([5, 5, 5]), emptyMesh);
  assert.equal(gateById(emptyRep, 'visible_geometry').passed, false);
  assert.ok(emptyRep.score <= 45);

  const floating = buildBareBox({ door: true, roof: true });
  floating.set(4, 3, 4, 'minecraft:stone');
  const floatRep = evaluateStructureQuality(floating.grid, 0, emptyLighting([9, 7, 9]), emptyMesh);
  assert.equal(gateById(floatRep, 'structural_continuity').passed, false);
  assert.ok(floatRep.score <= 45);

  const noDoor = buildBareBox({ door: false, roof: true });
  const sealedRep = evaluateStructureQuality(noDoor.grid, 0, emptyLighting([9, 7, 9]), emptyMesh);
  assert.equal(gateById(sealedRep, 'playable_circulation').passed, false);
  assert.ok(sealedRep.score <= 45);

  const noRoof = buildBareBox({ door: true, roof: false });
  const leakRep = evaluateStructureQuality(noRoof.grid, 0, emptyLighting([9, 7, 9]), emptyMesh);
  assert.equal(gateById(leakRep, 'weatherproof_enclosure').passed, false);
  assert.ok(leakRep.metrics.skyLeakRate > 0);
  assert.ok(leakRep.score <= 45);
};

const testBareBoxVsRichBuilding = (): void => {
  const bare = buildBareBox({ door: true, roof: true });
  const bareRep = evaluateStructureQuality(bare.grid, 0, emptyLighting([9, 7, 9]), emptyMesh);
  assert.equal(
    bareRep.hardGates.every((g) => g.passed),
    true,
    JSON.stringify(bareRep.hardGates.filter((g) => !g.passed)),
  );
  assert.ok(bareRep.score < 55, `Expected bare box < 55, got ${bareRep.score}`);
  assert.equal(bareRep.passed, false);
  assert.ok(bareRep.topDeductions.length > 0);

  const rich = makeGrid([13, 14, 13], {
    floors: [
      { name: 'ground', y: 0, height: 4 },
      { name: 'upper', y: 4, height: 4 },
    ],
    rooms: [
      {
        name: 'hall',
        kind: 'living',
        acousticSpace: 'timber_room',
        from: [1, 0, 1],
        to: [11, 4, 11],
        enclosed: true,
      },
      {
        name: 'loft',
        kind: 'bedroom',
        acousticSpace: 'small_chamber',
        from: [1, 4, 1],
        to: [11, 8, 11],
        enclosed: true,
      },
    ],
    openings: [
      {
        kind: 'door',
        room: 'hall',
        wall: 'south',
        from: [6, 1, 11],
        to: [6, 2, 11],
        hinge: 'left',
      },
      { kind: 'window', room: 'hall', wall: 'south', from: [3, 2, 11], to: [3, 3, 11] },
    ],
    hasRoofTrim: true,
    roofCount: 1,
    chimneyCount: 1,
    customPlacements: [
      {
        x: 5,
        y: 1,
        z: 12,
        assetAlias: 's#lantern',
        fallbackState: 'minecraft:lantern[hanging=false]',
        facing: 'south',
      },
      {
        x: 7,
        y: 1,
        z: 12,
        assetAlias: 's#pillar',
        fallbackState: 'minecraft:chiseled_stone_bricks',
        facing: 'south',
      },
    ],
    semanticStats: {
      roomCount: 2,
      facadeCount: 4,
      stairCount: 1,
      furnishCount: 4,
      weatheringCount: 1,
      rawSetCount: 1,
    },
  });
  fillBox(rich.set, [1, 0, 1], [11, 0, 11], 'minecraft:cobblestone');
  fillBox(rich.set, [2, 0, 2], [10, 0, 10], 'minecraft:oak_planks');
  fillBox(rich.set, [1, 1, 1], [11, 8, 11], 'minecraft:white_terracotta');
  fillBox(rich.set, [2, 1, 2], [10, 3, 10], 'minecraft:air');
  fillBox(rich.set, [2, 4, 2], [10, 4, 10], 'minecraft:spruce_planks');
  fillBox(rich.set, [2, 5, 2], [10, 7, 10], 'minecraft:air');
  fillBox(rich.set, [1, 8, 1], [11, 8, 11], 'minecraft:spruce_planks');
  fillBox(rich.set, [0, 9, 0], [12, 9, 12], 'minecraft:spruce_stairs[facing=north,half=bottom]');
  fillBox(rich.set, [2, 10, 2], [10, 10, 10], 'minecraft:spruce_slab[type=bottom]');
  rich.set(6, 1, 11, 'minecraft:spruce_door[facing=north,half=lower,hinge=left,open=false]');
  rich.set(6, 2, 11, 'minecraft:spruce_door[facing=north,half=upper,hinge=left,open=false]');
  for (const [wx, wz] of [
    [3, 11],
    [9, 11],
    [3, 1],
    [9, 1],
    [1, 4],
    [1, 8],
    [11, 4],
    [11, 8],
  ] as const) {
    rich.set(wx, 2, wz, 'minecraft:glass_pane');
    rich.set(wx, 3, wz, 'minecraft:glass_pane');
    rich.set(wx, 6, wz, 'minecraft:glass_pane');
  }
  for (const [cx, cz] of [
    [1, 1],
    [11, 1],
    [1, 11],
    [11, 11],
  ] as const) {
    fillBox(rich.set, [cx, 1, cz], [cx, 8, cz], 'minecraft:spruce_log[axis=y]');
  }
  rich.set(2, 2, 12, 'minecraft:oak_trapdoor[facing=north,half=bottom,open=true]');
  rich.set(4, 2, 12, 'minecraft:oak_trapdoor[facing=north,half=bottom,open=true]');
  rich.set(8, 2, 12, 'minecraft:oak_trapdoor[facing=north,half=bottom,open=true]');
  rich.set(10, 2, 12, 'minecraft:oak_trapdoor[facing=north,half=bottom,open=true]');
  rich.set(4, 1, 12, 'minecraft:lantern[hanging=false]');
  rich.customTags[(1 * 13 + 12) * 13 + 5] = 's#lantern';
  rich.set(5, 1, 12, 'minecraft:lantern[hanging=false]');
  rich.customTags[(1 * 13 + 12) * 13 + 7] = 's#pillar';
  rich.set(7, 1, 12, 'minecraft:chiseled_stone_bricks');
  for (let i = 0; i < 4; i += 1) {
    if (i > 0) rich.set(3 + i, i, 3, 'minecraft:oak_planks');
    rich.set(3 + i, 1 + i, 3, 'minecraft:oak_stairs[facing=east,half=bottom]');
    rich.set(3 + i, 4, 3, 'minecraft:air');
    if (i > 0) rich.set(3 + i, 5, 3, 'minecraft:air');
  }
  rich.set(8, 1, 8, 'minecraft:red_bed[facing=north,part=head]');
  rich.set(8, 1, 7, 'minecraft:chest[facing=north]');
  rich.set(3, 1, 8, 'minecraft:crafting_table');
  rich.set(3, 1, 9, 'minecraft:bookshelf');
  rich.set(9, 1, 3, 'minecraft:furnace[facing=south,lit=true]');
  rich.set(6, 1, 8, 'minecraft:red_carpet');
  rich.set(6, 3, 6, 'minecraft:lantern[hanging=true]');
  rich.set(6, 7, 6, 'minecraft:lantern[hanging=true]');
  rich.set(8, 5, 8, 'minecraft:blue_bed[facing=north,part=head]');
  rich.set(9, 5, 8, 'minecraft:barrel[facing=up]');
  rich.set(6, 5, 6, 'minecraft:blue_carpet');

  const light = emptyLighting([13, 14, 13]);
  light.blockR.fill(200);
  light.blockG.fill(165);
  light.blockB.fill(110);
  const mesh: StructureBakedMesh = {
    batches: [],
    textures: {},
    instances: [],
    rawFaceCount: 1000,
    mergedQuadCount: 320,
  };
  const richRep = evaluateStructureQuality(rich.grid, 3, light, mesh);
  assert.equal(
    richRep.hardGates.every((g) => g.passed),
    true,
    JSON.stringify(richRep.hardGates.filter((g) => !g.passed)),
  );
  assert.equal(
    richRep.pillars.reduce((s, p) => s + p.maxScore, 0),
    100,
  );
  assert.ok(richRep.score >= 85, `Expected rich building >= 85, got ${richRep.score}`);
  assert.equal(richRep.passed, true);
  assert.equal(richRep.grade, 'excellent');
};

testHardGates();
testBareBoxVsRichBuilding();
console.log('ashfox structure 4-pillar audit tests ok');
