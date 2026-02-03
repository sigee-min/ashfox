import { BlockPipelineTextures, BlockVariant } from '../types/blockPipeline';

export type BlockPipelineSpec = {
  name: string;
  namespace: string;
  texture: string;
  textures?: BlockPipelineTextures;
  variants: BlockVariant[];
};

export type BlockResourceKind = 'blockstate' | 'model' | 'item';

export type BlockResource = {
  kind: BlockResourceKind;
  name: string;
  json: unknown;
};

export type BlockPipelineResult = {
  namespace: string;
  baseName: string;
  variants: BlockVariant[];
  resources: BlockResource[];
};

export const BLOCK_PIPELINE_RESOURCE_TEMPLATES = [
  {
    uriTemplate: 'bbmcp://blockstate/{namespace}/{name}',
    name: 'Blockstate JSON',
    mimeType: 'application/json'
  },
  {
    uriTemplate: 'bbmcp://model/block/{namespace}/{name}',
    name: 'Block Model JSON',
    mimeType: 'application/json'
  },
  {
    uriTemplate: 'bbmcp://model/item/{namespace}/{name}',
    name: 'Item Model JSON',
    mimeType: 'application/json'
  }
];

const buildTextureRef = (namespace: string, value: string) => {
  if (value.includes(':')) return value;
  return `${namespace}:block/${value}`;
};

const resolveTextures = (spec: BlockPipelineSpec) => {
  const base = buildTextureRef(spec.namespace, spec.texture);
  const top = buildTextureRef(spec.namespace, spec.textures?.top ?? spec.texture);
  const bottom = buildTextureRef(spec.namespace, spec.textures?.bottom ?? spec.texture);
  const side = buildTextureRef(spec.namespace, spec.textures?.side ?? spec.texture);
  return { base, top, bottom, side };
};

const modelId = (namespace: string, path: string) => `${namespace}:${path}`;

const blockModel = (textures: ReturnType<typeof resolveTextures>) => {
  const usesCubeAll =
    textures.base === textures.top && textures.base === textures.bottom && textures.base === textures.side;
  if (usesCubeAll) {
    return {
      parent: 'minecraft:block/cube_all',
      textures: {
        all: textures.base
      }
    };
  }
  return {
    parent: 'minecraft:block/cube',
    textures: {
      down: textures.bottom,
      up: textures.top,
      north: textures.side,
      south: textures.side,
      east: textures.side,
      west: textures.side
    }
  };
};

const slabModels = (textures: ReturnType<typeof resolveTextures>) => ({
  slab: {
    parent: 'minecraft:block/slab',
    textures: {
      bottom: textures.bottom,
      top: textures.top,
      side: textures.side
    }
  },
  slabTop: {
    parent: 'minecraft:block/slab_top',
    textures: {
      bottom: textures.bottom,
      top: textures.top,
      side: textures.side
    }
  }
});

const stairsModels = (textures: ReturnType<typeof resolveTextures>) => ({
  stairs: {
    parent: 'minecraft:block/stairs',
    textures: {
      bottom: textures.bottom,
      top: textures.top,
      side: textures.side
    }
  },
  stairsInner: {
    parent: 'minecraft:block/inner_stairs',
    textures: {
      bottom: textures.bottom,
      top: textures.top,
      side: textures.side
    }
  },
  stairsOuter: {
    parent: 'minecraft:block/outer_stairs',
    textures: {
      bottom: textures.bottom,
      top: textures.top,
      side: textures.side
    }
  }
});

const wallModels = (textures: ReturnType<typeof resolveTextures>) => ({
  wallPost: {
    parent: 'minecraft:block/wall_post',
    textures: {
      wall: textures.side
    }
  },
  wallSide: {
    parent: 'minecraft:block/wall_side',
    textures: {
      wall: textures.side
    }
  },
  wallSideTall: {
    parent: 'minecraft:block/wall_side_tall',
    textures: {
      wall: textures.side
    }
  },
  wallInventory: {
    parent: 'minecraft:block/wall_inventory',
    textures: {
      wall: textures.side
    }
  }
});

const blockBlockstate = (namespace: string, name: string) => ({
  variants: {
    '': { model: modelId(namespace, `block/${name}`) }
  }
});

const slabBlockstate = (namespace: string, name: string) => ({
  variants: {
    'type=bottom': { model: modelId(namespace, `block/${name}_slab`) },
    'type=top': { model: modelId(namespace, `block/${name}_slab_top`) },
    'type=double': { model: modelId(namespace, `block/${name}`) }
  }
});

const stairsBlockstate = (namespace: string, name: string) => {
  const facings = ['east', 'south', 'west', 'north'] as const;
  const halves = ['bottom', 'top'] as const;
  const shapes = ['straight', 'inner_left', 'inner_right', 'outer_left', 'outer_right'] as const;
  const baseY: Record<(typeof facings)[number], number> = {
    east: 0,
    south: 90,
    west: 180,
    north: 270
  };
  const variants: Record<string, { model: string; x?: number; y?: number }> = {};

  facings.forEach((facing) => {
    shapes.forEach((shape) => {
      halves.forEach((half) => {
        const key = `facing=${facing},half=${half},shape=${shape}`;
        const modelSuffix =
          shape === 'straight' ? '' : shape.includes('inner') ? '_stairs_inner' : '_stairs_outer';
        const model = modelId(namespace, `block/${name}${modelSuffix || '_stairs'}`);
        const yBase = baseY[facing];
        const y = shape.endsWith('right') ? (yBase + 90) % 360 : yBase;
        const entry: { model: string; x?: number; y?: number } = { model };
        if (y !== 0) entry.y = y;
        if (half === 'top') entry.x = 180;
        variants[key] = entry;
      });
    });
  });

  return { variants };
};

const wallBlockstate = (namespace: string, name: string) => ({
  multipart: [
    { apply: { model: modelId(namespace, `block/${name}_wall_post`) } },
    { when: { north: 'low' }, apply: { model: modelId(namespace, `block/${name}_wall_side`), uvlock: true } },
    { when: { east: 'low' }, apply: { model: modelId(namespace, `block/${name}_wall_side`), y: 90, uvlock: true } },
    { when: { south: 'low' }, apply: { model: modelId(namespace, `block/${name}_wall_side`), y: 180, uvlock: true } },
    { when: { west: 'low' }, apply: { model: modelId(namespace, `block/${name}_wall_side`), y: 270, uvlock: true } },
    { when: { north: 'tall' }, apply: { model: modelId(namespace, `block/${name}_wall_side_tall`), uvlock: true } },
    { when: { east: 'tall' }, apply: { model: modelId(namespace, `block/${name}_wall_side_tall`), y: 90, uvlock: true } },
    { when: { south: 'tall' }, apply: { model: modelId(namespace, `block/${name}_wall_side_tall`), y: 180, uvlock: true } },
    { when: { west: 'tall' }, apply: { model: modelId(namespace, `block/${name}_wall_side_tall`), y: 270, uvlock: true } }
  ]
});

const itemModel = (namespace: string, modelPath: string) => ({
  parent: modelId(namespace, modelPath)
});

export const buildBlockPipeline = (spec: BlockPipelineSpec): BlockPipelineResult => {
  const textures = resolveTextures(spec);
  const resources: BlockResource[] = [];
  const baseName = spec.name;

  const addResource = (kind: BlockResourceKind, name: string, json: unknown) => {
    resources.push({ kind, name, json });
  };

  if (spec.variants.includes('block')) {
    addResource('blockstate', baseName, blockBlockstate(spec.namespace, baseName));
    addResource('model', `block/${baseName}`, blockModel(textures));
    addResource('item', `item/${baseName}`, itemModel(spec.namespace, `block/${baseName}`));
  }

  if (spec.variants.includes('slab')) {
    const slabName = `${baseName}_slab`;
    const models = slabModels(textures);
    addResource('blockstate', slabName, slabBlockstate(spec.namespace, baseName));
    addResource('model', `block/${slabName}`, models.slab);
    addResource('model', `block/${slabName}_top`, models.slabTop);
    addResource('item', `item/${slabName}`, itemModel(spec.namespace, `block/${slabName}`));
    if (!spec.variants.includes('block')) {
      addResource('model', `block/${baseName}`, blockModel(textures));
    }
  }

  if (spec.variants.includes('stairs')) {
    const stairsName = `${baseName}_stairs`;
    const models = stairsModels(textures);
    addResource('blockstate', stairsName, stairsBlockstate(spec.namespace, baseName));
    addResource('model', `block/${stairsName}`, models.stairs);
    addResource('model', `block/${stairsName}_inner`, models.stairsInner);
    addResource('model', `block/${stairsName}_outer`, models.stairsOuter);
    addResource('item', `item/${stairsName}`, itemModel(spec.namespace, `block/${stairsName}`));
  }

  if (spec.variants.includes('wall')) {
    const wallName = `${baseName}_wall`;
    const models = wallModels(textures);
    addResource('blockstate', wallName, wallBlockstate(spec.namespace, baseName));
    addResource('model', `block/${wallName}_post`, models.wallPost);
    addResource('model', `block/${wallName}_side`, models.wallSide);
    addResource('model', `block/${wallName}_side_tall`, models.wallSideTall);
    addResource('model', `block/${wallName}_inventory`, models.wallInventory);
    addResource('item', `item/${wallName}`, itemModel(spec.namespace, `block/${wallName}_inventory`));
  }

  return {
    namespace: spec.namespace,
    baseName,
    variants: [...spec.variants],
    resources
  };
};



