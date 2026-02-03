import type { TextureUsage } from '../../../domain/model';
import type { TexturePipelineSteps } from '../types';
import type { ProxyPipelineDeps } from '../../types';
import type { ProxyPipeline } from '../../pipeline';

export type TexturePipelineContext = {
  deps: ProxyPipelineDeps;
  pipeline: ProxyPipeline;
  steps: TexturePipelineSteps;
  includePreflight: boolean;
  includeUsage: boolean;
  currentUvUsageId?: string;
  preflightUsage?: TextureUsage;
  planCreatedTextureNames?: Set<string>;
};

export const createTexturePipelineContext = (args: {
  deps: ProxyPipelineDeps;
  pipeline: ProxyPipeline;
  steps: TexturePipelineSteps;
  includePreflight: boolean;
  includeUsage: boolean;
}): TexturePipelineContext => ({
  ...args
});
