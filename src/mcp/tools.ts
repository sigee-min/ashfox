import { JsonSchema, McpToolDefinition } from './types';

const numberArray = (minItems: number, maxItems: number): JsonSchema => ({
  type: 'array',
  items: { type: 'number' },
  minItems,
  maxItems
});

const emptyObject: JsonSchema = { type: 'object', additionalProperties: false };
const cubeFaceSchema: JsonSchema = {
  type: 'string',
  enum: ['north', 'south', 'east', 'west', 'up', 'down']
};

const textureOpSchema: JsonSchema = {
  type: 'object',
  required: ['op'],
  additionalProperties: false,
  properties: {
    op: { type: 'string', enum: ['set_pixel', 'fill_rect', 'draw_rect', 'draw_line'] },
    x: { type: 'number' },
    y: { type: 'number' },
    width: { type: 'number' },
    height: { type: 'number' },
    x1: { type: 'number' },
    y1: { type: 'number' },
    x2: { type: 'number' },
    y2: { type: 'number' },
    color: { type: 'string' },
    lineWidth: { type: 'number' }
  }
};

const faceUvSchema: JsonSchema = {
  type: 'object',
  minProperties: 1,
  additionalProperties: false,
  properties: {
    north: numberArray(4, 4),
    south: numberArray(4, 4),
    east: numberArray(4, 4),
    west: numberArray(4, 4),
    up: numberArray(4, 4),
    down: numberArray(4, 4)
  }
};

const modelPartSchema: JsonSchema = {
  type: 'object',
  required: ['id', 'size', 'offset'],
  additionalProperties: false,
  properties: {
    id: { type: 'string' },
    size: numberArray(3, 3),
    offset: numberArray(3, 3),
    uv: numberArray(2, 2),
    inflate: { type: 'number' },
    mirror: { type: 'boolean' },
    pivot: numberArray(3, 3),
    parent: { type: 'string' }
  }
};

const modelSpecSchema: JsonSchema = {
  type: 'object',
  required: ['format', 'name', 'rigTemplate', 'parts'],
  additionalProperties: false,
  properties: {
    format: { type: 'string', enum: ['vanilla', 'geckolib', 'animated_java'] },
    name: { type: 'string' },
    rigTemplate: { type: 'string', enum: ['empty', 'biped', 'quadruped', 'block_entity'] },
    parts: {
      type: 'array',
      items: modelPartSchema
    }
  }
};

const stateProps: Record<string, JsonSchema> = {
  includeState: { type: 'boolean' }
};

const metaProps: Record<string, JsonSchema> = {
  includeState: { type: 'boolean' },
  includeDiff: { type: 'boolean' },
  diffDetail: { type: 'string', enum: ['summary', 'full'] }
};

const toolSchemas: Record<string, JsonSchema> = {
  list_capabilities: emptyObject,
  get_project_state: {
    type: 'object',
    additionalProperties: false,
    properties: {
      detail: { type: 'string', enum: ['summary', 'full'] }
    }
  },
  get_project_diff: {
    type: 'object',
    required: ['sinceRevision'],
    additionalProperties: false,
    properties: {
      sinceRevision: { type: 'string' },
      detail: { type: 'string', enum: ['summary', 'full'] }
    }
  },
  set_project_texture_resolution: {
    type: 'object',
    required: ['width', 'height'],
    additionalProperties: false,
    properties: {
      width: { type: 'number' },
      height: { type: 'number' },
      modifyUv: { type: 'boolean' },
      ifRevision: { type: 'string' },
      ...metaProps
    }
  },
  get_texture_usage: {
    type: 'object',
    additionalProperties: false,
    properties: {
      textureId: { type: 'string' },
      textureName: { type: 'string' }
    }
  },
  list_projects: emptyObject,
  select_project: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      ...stateProps
    }
  },
  create_project: {
    type: 'object',
    required: ['format', 'name'],
    additionalProperties: false,
    properties: {
      format: { type: 'string', enum: ['vanilla', 'geckolib', 'animated_java'] },
      name: { type: 'string' },
      confirmDiscard: { type: 'boolean' },
      confirmDialog: { type: 'boolean' },
      dialog: { type: 'object', additionalProperties: true },
      ifRevision: { type: 'string' },
      ...metaProps
    }
  },
  reset_project: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ifRevision: { type: 'string' },
      ...metaProps
    }
  },
  delete_texture: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      ifRevision: { type: 'string' },
      ...metaProps
    }
  },
  assign_texture: {
    type: 'object',
    additionalProperties: false,
    properties: {
      textureId: { type: 'string' },
      textureName: { type: 'string' },
      cubeIds: { type: 'array', items: { type: 'string' } },
      cubeNames: { type: 'array', items: { type: 'string' } },
      faces: { type: 'array', minItems: 1, items: cubeFaceSchema },
      ifRevision: { type: 'string' },
      ...metaProps
    }
  },
  set_face_uv: {
    type: 'object',
    required: ['faces'],
    additionalProperties: false,
    properties: {
      cubeId: { type: 'string' },
      cubeName: { type: 'string' },
      faces: faceUvSchema,
      ifRevision: { type: 'string' },
      ...metaProps
    }
  },
  add_bone: {
    type: 'object',
    required: ['name', 'pivot'],
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      parent: { type: 'string' },
      parentId: { type: 'string' },
      pivot: numberArray(3, 3),
      rotation: numberArray(3, 3),
      scale: numberArray(3, 3),
      ifRevision: { type: 'string' },
      ...metaProps
    }
  },
  update_bone: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      newName: { type: 'string' },
      parent: { type: 'string' },
      parentId: { type: 'string' },
      parentRoot: { type: 'boolean' },
      pivot: numberArray(3, 3),
      rotation: numberArray(3, 3),
      scale: numberArray(3, 3),
      ifRevision: { type: 'string' },
      ...metaProps
    }
  },
  delete_bone: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      ifRevision: { type: 'string' },
      ...metaProps
    }
  },
  add_cube: {
    type: 'object',
    required: ['name', 'from', 'to'],
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      from: numberArray(3, 3),
      to: numberArray(3, 3),
      bone: { type: 'string' },
      boneId: { type: 'string' },
      uv: numberArray(2, 2),
      inflate: { type: 'number' },
      mirror: { type: 'boolean' },
      ifRevision: { type: 'string' },
      ...metaProps
    }
  },
  update_cube: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      newName: { type: 'string' },
      bone: { type: 'string' },
      boneId: { type: 'string' },
      boneRoot: { type: 'boolean' },
      from: numberArray(3, 3),
      to: numberArray(3, 3),
      uv: numberArray(2, 2),
      inflate: { type: 'number' },
      mirror: { type: 'boolean' },
      ifRevision: { type: 'string' },
      ...metaProps
    }
  },
  delete_cube: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      ifRevision: { type: 'string' },
      ...metaProps
    }
  },
  apply_rig_template: {
    type: 'object',
    required: ['templateId'],
    additionalProperties: false,
    properties: {
      templateId: { type: 'string' },
      ifRevision: { type: 'string' },
      ...metaProps
    }
  },
  create_animation_clip: {
    type: 'object',
    required: ['name', 'length', 'loop', 'fps'],
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      length: { type: 'number' },
      loop: { type: 'boolean' },
      fps: { type: 'number' },
      ifRevision: { type: 'string' },
      ...metaProps
    }
  },
  update_animation_clip: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      newName: { type: 'string' },
      length: { type: 'number' },
      loop: { type: 'boolean' },
      fps: { type: 'number' },
      ifRevision: { type: 'string' },
      ...metaProps
    }
  },
  delete_animation_clip: {
    type: 'object',
    additionalProperties: false,
    properties: {
      id: { type: 'string' },
      name: { type: 'string' },
      ifRevision: { type: 'string' },
      ...metaProps
    }
  },
  set_keyframes: {
    type: 'object',
    required: ['clip', 'bone', 'channel', 'keys'],
    additionalProperties: false,
    properties: {
      clipId: { type: 'string' },
      clip: { type: 'string' },
      bone: { type: 'string' },
      channel: { enum: ['rot', 'pos', 'scale'] },
      keys: {
        type: 'array',
        items: {
          type: 'object',
          required: ['time', 'value'],
          additionalProperties: false,
          properties: {
            time: { type: 'number' },
            value: numberArray(3, 3),
            interp: { enum: ['linear', 'step', 'catmullrom'] }
          }
        }
      },
      ifRevision: { type: 'string' },
      ...metaProps
    }
  },
  export: {
    type: 'object',
    required: ['format', 'destPath'],
    additionalProperties: false,
    properties: {
      format: { enum: ['vanilla_json', 'gecko_geo_anim', 'animated_java'] },
      destPath: { type: 'string' },
      ...stateProps
    }
  },
  render_preview: {
    type: 'object',
      required: ['mode'],
    additionalProperties: false,
    properties: {
      mode: { enum: ['fixed', 'turntable'] },
        angle: numberArray(2, 3),
        clip: { type: 'string' },
        timeSeconds: { type: 'number' },
        durationSeconds: { type: 'number' },
        fps: { type: 'number' },
        output: { enum: ['single', 'sequence'] },
        ...stateProps
      }
    },
  validate: {
    type: 'object',
    additionalProperties: false,
    properties: {
      ...stateProps
    }
  },
  apply_model_spec: {
    type: 'object',
    required: ['model'],
    additionalProperties: false,
    properties: {
      model: modelSpecSchema,
      ifRevision: { type: 'string' },
      ...metaProps
    }
  },
  apply_texture_spec: {
    type: 'object',
    required: ['textures'],
    additionalProperties: false,
    properties: {
      textures: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['width', 'height'],
          additionalProperties: false,
          properties: {
            mode: { type: 'string', enum: ['create', 'update'] },
            id: { type: 'string' },
            targetId: { type: 'string' },
            targetName: { type: 'string' },
            name: { type: 'string' },
            width: { type: 'number' },
            height: { type: 'number' },
            background: { type: 'string' },
            useExisting: { type: 'boolean' },
            ops: {
              type: 'array',
              items: textureOpSchema
            }
          }
        }
      },
      ifRevision: { type: 'string' },
      ...metaProps
    }
  },
  apply_anim_spec: {
    type: 'object',
    required: ['animation'],
    additionalProperties: false,
    properties: {
      animation: { type: 'object', additionalProperties: true },
      ifRevision: { type: 'string' },
      ...metaProps
    }
  },
  apply_project_spec: {
    type: 'object',
    additionalProperties: false,
    properties: {
      model: modelSpecSchema,
      textures: {
        type: 'array',
        minItems: 1,
        items: {
          type: 'object',
          required: ['width', 'height'],
          additionalProperties: false,
          properties: {
            mode: { type: 'string', enum: ['create', 'update'] },
            id: { type: 'string' },
            targetId: { type: 'string' },
            targetName: { type: 'string' },
            name: { type: 'string' },
            width: { type: 'number' },
            height: { type: 'number' },
            background: { type: 'string' },
            useExisting: { type: 'boolean' },
            ops: {
              type: 'array',
              items: textureOpSchema
            }
          }
        }
      },
      animation: { type: 'object', additionalProperties: true },
      projectMode: { type: 'string', enum: ['auto', 'reuse', 'create'] },
      ifRevision: { type: 'string' },
      ...metaProps
    }
  }
};

export const MCP_TOOLS: McpToolDefinition[] = [
  {
    name: 'list_capabilities',
    title: 'List Capabilities',
    description: 'Returns plugin capabilities and limits. Tool schemas are strict (extra fields are rejected).',
    inputSchema: toolSchemas.list_capabilities
  },
  {
    name: 'get_project_state',
    title: 'Get Project State',
    description:
      'Returns the current project state (summary by default). Summary includes texture metadata and textureResolution. Full detail includes textureUsage (per-face mappings) when available.',
    inputSchema: toolSchemas.get_project_state
  },
  {
    name: 'get_project_diff',
    title: 'Get Project Diff',
    description: 'Returns a diff from a prior revision to the current project state.',
    inputSchema: toolSchemas.get_project_diff
  },
    {
      name: 'set_project_texture_resolution',
      title: 'Set Project Texture Resolution',
      description:
        'Sets the project texture resolution (width/height). Requires ifRevision; call get_project_state first. Set modifyUv=true to scale existing UVs to the new resolution (if supported). This does not resize existing textures; use it before creating textures. If UVs exceed the current resolution, increase it (width >= 2*(w+d), height >= 2*(h+d), round up to 32/64/128) or split textures per material.',
      inputSchema: toolSchemas.set_project_texture_resolution
    },
  {
    name: 'get_texture_usage',
    title: 'Get Texture Usage',
    description:
      'Returns which cubes/faces reference each texture, including per-face UVs when available. unresolved lists face references that do not match known textures.',
    inputSchema: toolSchemas.get_texture_usage
  },
  {
    name: 'list_projects',
    title: 'List Projects',
    description: 'Lists the currently open project (Blockbench has one active project).',
    inputSchema: toolSchemas.list_projects
  },
  {
    name: 'select_project',
    title: 'Select Project',
    description: 'Selects the active project for bbmcp operations. Optionally provide id from list_projects.',
    inputSchema: toolSchemas.select_project
  },
  {
    name: 'create_project',
    title: 'Create Project',
    description:
      'Creates a new Blockbench project with the given format. Requires ifRevision; call get_project_state first. Set confirmDiscard=true to discard unsaved changes. If a project dialog opens, pass dialog values and set confirmDialog=true to auto-confirm.',
    inputSchema: toolSchemas.create_project
  },
  {
    name: 'reset_project',
    title: 'Reset Project',
    description: 'Resets the current Blockbench project. Requires ifRevision; call get_project_state first.',
    inputSchema: toolSchemas.reset_project
  },
  {
    name: 'delete_texture',
    title: 'Delete Texture',
    description: 'Deletes a texture by id or name. Requires ifRevision; call get_project_state first.',
    inputSchema: toolSchemas.delete_texture
  },
  {
    name: 'assign_texture',
    title: 'Assign Texture',
    description:
      'Assigns a texture to cubes/faces without changing UVs (forces per-face UV mode; auto UV disabled). Requires ifRevision; call get_project_state first. Use this after apply_texture_spec. Omit cubeIds/cubeNames to apply to all cubes. Use set_face_uv to define per-face UVs explicitly. Prefer material-group textures (pot/soil/plant) and assign by cubeNames for stability. If UVs exceed the current textureResolution, increase it or split textures per material.',
    inputSchema: toolSchemas.assign_texture
  },
  {
    name: 'set_face_uv',
    title: 'Set Face UV',
    description:
      'Sets per-face UVs for a cube (manual UV only; auto UV disabled). Requires ifRevision; call get_project_state first. Provide cubeId or cubeName plus a faces map (e.g., {north:[x1,y1,x2,y2], up:[x1,y1,x2,y2]}). UVs are in texture pixels and must fit within the project textureResolution; if they exceed it, increase resolution or split textures.',
    inputSchema: toolSchemas.set_face_uv
  },
  {
    name: 'add_bone',
    title: 'Add Bone',
    description: 'Adds a bone to the current project. Requires ifRevision; call get_project_state first.',
    inputSchema: toolSchemas.add_bone
  },
  {
    name: 'update_bone',
    title: 'Update Bone',
    description: 'Updates a bone (rename, transform, or reparent). Requires ifRevision; call get_project_state first.',
    inputSchema: toolSchemas.update_bone
  },
  {
    name: 'delete_bone',
    title: 'Delete Bone',
    description: 'Deletes a bone (and its descendants). Requires ifRevision; call get_project_state first.',
    inputSchema: toolSchemas.delete_bone
  },
  {
    name: 'add_cube',
    title: 'Add Cube',
    description:
      'Adds a cube to the given bone. Requires ifRevision; call get_project_state first. If uv is provided it must fit within the project textureResolution. Texture binding is separate; use assign_texture.',
    inputSchema: toolSchemas.add_cube
  },
  {
    name: 'update_cube',
    title: 'Update Cube',
    description:
      'Updates a cube (rename, transform, or reparent). Requires ifRevision; call get_project_state first. If uv is provided it must fit within the project textureResolution.',
    inputSchema: toolSchemas.update_cube
  },
  {
    name: 'delete_cube',
    title: 'Delete Cube',
    description: 'Deletes a cube. Requires ifRevision; call get_project_state first.',
    inputSchema: toolSchemas.delete_cube
  },
  {
    name: 'apply_rig_template',
    title: 'Apply Rig Template',
    description: 'Applies a rig template to the project. Requires ifRevision; call get_project_state first.',
    inputSchema: toolSchemas.apply_rig_template
  },
  {
    name: 'create_animation_clip',
    title: 'Create Animation Clip',
    description: 'Creates an animation clip. Requires ifRevision; call get_project_state first.',
    inputSchema: toolSchemas.create_animation_clip
  },
  {
    name: 'update_animation_clip',
    title: 'Update Animation Clip',
    description: 'Updates an animation clip. Requires ifRevision; call get_project_state first.',
    inputSchema: toolSchemas.update_animation_clip
  },
  {
    name: 'delete_animation_clip',
    title: 'Delete Animation Clip',
    description: 'Deletes an animation clip. Requires ifRevision; call get_project_state first.',
    inputSchema: toolSchemas.delete_animation_clip
  },
  {
    name: 'set_keyframes',
    title: 'Set Keyframes',
    description: 'Adds keyframes to an animation clip. Requires ifRevision; call get_project_state first.',
    inputSchema: toolSchemas.set_keyframes
  },
  {
    name: 'export',
    title: 'Export',
    description: 'Exports the current model to a file path. Requires ifRevision; call get_project_state first.',
    inputSchema: toolSchemas.export
  },
  {
    name: 'render_preview',
    title: 'Render Preview',
    description:
      'Renders a preview image. fixed -> single (optional angle). turntable -> sequence. Returns MCP image content blocks (base64 PNG) plus structured metadata without dataUri. Single returns result.image; sequence returns result.frames[]. Example(single): {"mode":"fixed","output":"single","angle":[30,45,0]} Example(sequence): {"mode":"turntable","output":"sequence","durationSeconds":2,"fps":12}',
    inputSchema: toolSchemas.render_preview
  },
  {
    name: 'validate',
    title: 'Validate',
    description: 'Validates the current project.',
    inputSchema: toolSchemas.validate
  },
  {
    name: 'apply_model_spec',
    title: 'Apply Model Spec',
    description:
      'Applies a structured model specification. Requires ifRevision; call get_project_state first. Textures are handled separately via apply_texture_spec + assign_texture.',
    inputSchema: toolSchemas.apply_model_spec
  },
  {
    name: 'apply_texture_spec',
    title: 'Apply Texture Spec',
    description:
      'Applies a structured texture specification. Requires ifRevision; returns no_change when no pixels change. This creates/updates texture data only; call assign_texture to bind it to cubes, then set_face_uv for manual per-face UVs. width/height are required and must match the intended project textureResolution. Prefer separate textures per material group (pot/soil/plant) rather than one mega-texture. If UVs exceed the current textureResolution, increase it (width >= 2*(w+d), height >= 2*(h+d), round up to 32/64/128) or split textures per material. Use set_project_texture_resolution before creating textures when increasing size. ops are optional; omit ops to create a blank texture (background can still fill).',
    inputSchema: toolSchemas.apply_texture_spec
  },
  {
    name: 'apply_anim_spec',
    title: 'Apply Animation Spec',
    description: 'Applies a structured animation specification. Requires ifRevision; call get_project_state first.',
    inputSchema: toolSchemas.apply_anim_spec
  },
  {
    name: 'apply_project_spec',
    title: 'Apply Project Spec',
    description:
      'Applies a combined model, texture, and animation specification. Requires ifRevision; call get_project_state first. Textures use ops-only (omit ops for blank); call assign_texture after texture steps to apply them to cubes.',
    inputSchema: toolSchemas.apply_project_spec
  }
];

export const getToolSchema = (name: string): JsonSchema | null => toolSchemas[name] ?? null;

export const isKnownTool = (name: string) => Boolean(toolSchemas[name]);

