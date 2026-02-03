export const BLOCK_VARIANTS = ['block', 'slab', 'stairs', 'wall'] as const;
export type BlockVariant = typeof BLOCK_VARIANTS[number];

export const BLOCK_PIPELINE_MODES = ['json_only', 'with_blockbench'] as const;
export type BlockPipelineMode = typeof BLOCK_PIPELINE_MODES[number];

export const BLOCK_PIPELINE_ON_CONFLICT = ['error', 'overwrite', 'versioned'] as const;
export type BlockPipelineOnConflict = typeof BLOCK_PIPELINE_ON_CONFLICT[number];

export type BlockPipelineTextures = {
  top?: string;
  side?: string;
  bottom?: string;
};


