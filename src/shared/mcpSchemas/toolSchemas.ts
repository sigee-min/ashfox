import type { JsonSchema } from './types';
import { baseToolSchemas } from './toolSchemas/base';
import { projectToolSchemas } from './toolSchemas/projects';
import { textureToolSchemas } from './toolSchemas/textures';
import { modelToolSchemas } from './toolSchemas/models';
import { previewToolSchemas } from './toolSchemas/preview';
import { entityToolSchemas } from './toolSchemas/entities';

export const toolSchemas: Record<string, JsonSchema> = {
  ...baseToolSchemas,
  ...projectToolSchemas,
  ...textureToolSchemas,
  ...modelToolSchemas,
  ...previewToolSchemas,
  ...entityToolSchemas
};
