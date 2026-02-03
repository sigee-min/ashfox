export const TEXTURE_PIPELINE_STEP_REQUIRED =
  'texture_pipeline requires at least one step (plan, assign, uv, textures, presets, facePaint, cleanup, preflight, preview).';
export const TEXTURE_PLAN_INVALID = 'plan must be an object.';
export const TEXTURE_PLAN_DETAIL_INVALID = 'plan.detail must be one of low, medium, high.';
export const TEXTURE_PLAN_MAX_TEXTURES_INVALID = 'plan.maxTextures must be a positive integer.';
export const TEXTURE_PLAN_RESOLUTION_INVALID = 'plan.resolution must include positive width/height.';
export const TEXTURE_PLAN_PAINT_INVALID = 'plan.paint must be an object.';
export const TEXTURE_PLAN_PALETTE_INVALID = 'plan.paint.palette must be an array of strings.';
export const TEXTURE_PLAN_NO_CUBES = 'No cubes available to build a texture plan.';
export const TEXTURE_PLAN_DUPLICATE_CREATE = (names: string) =>
  `plan already creates texture(s): ${names}.`;
export const TEXTURE_PLAN_DUPLICATE_CREATE_FIX =
  'Remove duplicate names from textures/presets or run a follow-up call to update the planned textures.';
export const TEXTURE_PLAN_ONLY_FACE_PAINT =
  'planOnly cannot be combined with facePaint. Run facePaint in a follow-up call.';
export const TEXTURE_PLAN_ASSIGN_UV_CONFLICT =
  'plan already generates assignments and UVs. Remove assign/uv or split into separate calls.';
export const TEXTURE_FACE_PAINT_CONFLICT = (names: string) =>
  `facePaint also targets texture(s): ${names}. Split into separate calls or remove overlapping presets/textures.`;
export const TEXTURE_CLEANUP_INVALID = 'cleanup must be an object.';
export const TEXTURE_CLEANUP_DELETE_REQUIRED = 'cleanup.delete must be a non-empty array.';
export const TEXTURE_CLEANUP_ENTRY_REQUIRED = 'cleanup.delete entries require id or name.';
export const TEXTURE_CLEANUP_FORCE_INVALID = 'cleanup.force must be a boolean.';
export const ASSIGN_MUST_BE_ARRAY = 'assign must be an array';
export const ASSIGN_ENTRY_REQUIRES_TEXTURE = 'assign entry requires textureId or textureName';
export const ASSIGN_CUBE_IDS_ARRAY = 'assign cubeIds must be an array';
export const ASSIGN_CUBE_NAMES_ARRAY = 'assign cubeNames must be an array';
export const PRESETS_MUST_BE_ARRAY = 'presets must be an array';
export const PRESET_NAME_REQUIRED = 'preset name is required';
export const UNKNOWN_TEXTURE_PRESET = (preset: string) => `unknown texture preset: ${preset}`;
export const PRESET_SIZE_POSITIVE = 'preset width/height must be positive numbers';
export const PRESET_SIZE_INTEGER = 'preset width/height must be integers';
export const PRESET_SIZE_EXCEEDS_MAX = (maxSize: number) => `preset size exceeds max ${maxSize}`;
export const PRESET_MODE_INVALID = (preset: string) => `preset mode invalid (${preset})`;
export const PRESET_UPDATE_REQUIRES_TARGET = (preset: string) =>
  `preset update requires targetId or targetName (${preset})`;
export const PREVIEW_MODE_INVALID = (mode: string) => `preview mode invalid (${mode})`;
export const FACE_PAINT_MUST_BE_ARRAY = 'facePaint must be an array.';
export const FACE_PAINT_ENTRY_REQUIRED = 'facePaint entry must be an object.';
export const FACE_PAINT_MATERIAL_REQUIRED = 'facePaint material is required.';
export const FACE_PAINT_MATERIAL_STRING = 'facePaint material must be a string.';
export const FACE_PAINT_MATERIAL_UNKNOWN = (material: string) =>
  `Unknown facePaint material: ${material}. Use a supported material keyword or provide a palette.`;
export const FACE_PAINT_PALETTE_INVALID = 'facePaint palette must be an array of strings.';
export const FACE_PAINT_SEED_INVALID = 'facePaint seed must be a number.';
export const FACE_PAINT_CUBE_IDS_ARRAY = 'facePaint cubeIds must be an array of strings.';
export const FACE_PAINT_CUBE_NAMES_ARRAY = 'facePaint cubeNames must be an array of strings.';
export const FACE_PAINT_FACES_INVALID = 'facePaint faces must include valid directions (north/south/east/west/up/down).';
export const FACE_PAINT_SCOPE_INVALID = 'facePaint scope must be faces, rects, or bounds.';
export const FACE_PAINT_MAPPING_INVALID = 'facePaint mapping must be stretch or tile.';
export const FACE_PAINT_PADDING_INVALID = 'facePaint padding must be a non-negative number.';
export const FACE_PAINT_ANCHOR_INVALID = 'facePaint anchor must be [x,y] numbers.';
export const FACE_PAINT_NO_TEXTURES =
  'No textures available for facePaint. Run texture_pipeline plan or assign textures and UVs first.';
export const FACE_PAINT_TARGET_NOT_FOUND = (material: string) =>
  `No matching cube faces found for facePaint material "${material}".`;
export const FACE_PAINT_UV_MISSING = (material: string) =>
  `UV mapping missing for facePaint material "${material}". Run texture_pipeline or plan to generate UVs.`;
export const FACE_PAINT_TEXTURE_SIZE_MISSING = (name: string) =>
  `Texture size missing for "${name}". Set texture resolution or recreate the texture.`;
