export type BlockVariant = 'block' | 'slab' | 'stairs' | 'wall';

export type BlockPipelineMode = 'json_only' | 'with_blockbench';

export type BlockPipelineOnConflict = 'error' | 'overwrite' | 'versioned';

export type BlockPipelineTextures = {
  top?: string;
  side?: string;
  bottom?: string;
};
