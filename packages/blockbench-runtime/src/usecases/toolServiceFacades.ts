import type { ToolServiceContext } from './toolServiceContext';
import type { ModelService } from './ModelService';
import type { ProjectService } from './project';
import type { RenderService } from './RenderService';
import type { TextureService } from './textureService';
import type { ValidationService } from './ValidationService';
import type { AnimationService } from './AnimationService';

export type ToolServiceFacades = {
  project: ProjectService;
  texture: TextureService;
  model: ModelService;
  animation: AnimationService;
  render: RenderService;
  validation: ValidationService;
};

export const createToolServiceFacades = (context: ToolServiceContext): ToolServiceFacades => ({
  project: context.projectService,
  texture: context.textureService,
  model: context.modelService,
  animation: context.animationService,
  render: context.renderService,
  validation: context.validationService,
});
