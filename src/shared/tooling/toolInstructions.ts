export const RIGGING_WORKFLOW_INSTRUCTIONS = [
  'For animation-ready rigs, ensure a root bone exists (explicit for most formats).',
  'Every non-root part must set parent to an existing part id (no flat bone lists).',
  'Prefer model_pipeline for modeling edits.',
  'For complex objects, use model_pipeline stages to apply bones/cubes in parts.',
  'stagePreview/stageValidate run preview/validate after each stage when preview/validate is set.',
  'Single-create mode: each stage must include at most one bone and one cube. Split bones/cubes across stages or calls.',
  'rigTemplate is limited to single-part templates (empty/block_entity). Use stages with explicit bones/cubes for biped/quadruped.',
  'For GeckoLib entities, prefer entity_pipeline for model + textures + animations.',
  'Prefer stable ids; renaming ids can break animation channels.',
  'If ids are omitted, model_pipeline derives stable_path ids from hierarchy/name. Set model.policies.idPolicy=explicit to require ids.',
  'If you get invalid_state_revision_mismatch, call get_project_state and retry with the latest ifRevision.',
  'If unsure about hierarchy rules, read bbmcp://guide/rigging via resources/read.',
  'For high-level modeling, read bbmcp://guide/modeling-workflow via resources/read.',
  'For Java Block/Item, model_pipeline auto-creates a root bone when enforceRoot=true; omit explicit "root" to avoid duplicates.'
].join(' ');

export const TEXTURE_WORKFLOW_INSTRUCTIONS = [
  'This server exposes high-level tools only. Use texture_pipeline for the entire workflow.',
  'Prefer the macro tool: texture_pipeline. Use plan for auto-assign + auto-UV with texel-density planning; it avoids resolution growth loops. Automatic recovery handles overlap/scale/uvUsageId mismatch or missing UVs. Low-level apply_texture_spec/generate_texture_preset automatically run a single auto_uv_atlas + preflight retry.',
  'For material-first painting, use texture_pipeline.facePaint to map materials to presets and target cube faces without manual UV work (requires UV mapping; pair with plan).',
  'Before painting, lock invariants: project textureResolution, manual per-face UV policy, and intended texture count (single atlas vs per-material).',
  'If you set plan.resolution and need a single atlas, set allowSplit=false or maxTextures=1 to prevent splitting.',
  'plan creates textures; do not issue a second create for the same name. Use mode:"update" with targetName (or omit the textures step).',
  'If preflight_texture is available: call it without texture filters to get a stable uvUsageId and UV mapping.',
  'Paint only inside UV rects (uvPaint enforced). Whole-texture painting is not supported; map UVs to the full texture if you need full coverage.',
  'uvUsageId is a guard. If any UVs change, call preflight_texture again and repaint. If you hit invalid_state due to UV usage mismatch, refresh preflight and retry with the new uvUsageId.',
  'UV overlaps are errors unless the rects are identical. UV scale mismatches are errors. Automatic recovery runs a plan-based re-UV (auto-split, <=512, max 16 textures) and then repaint.',
  'Payload sizing: for <=32px textures, small ops are fine; for 64px+ prefer procedural presets to avoid large payloads.',
  'Texture creation does not bind textures to cubes. Ensure textures are assigned in the same workflow (texture_pipeline assign step) so they are visible.',
  'For visual verification, use render_preview. If images cannot be attached, set saveToTmp=true and read bbmcp://guide/vision-fallback via resources/read.',
  'If unsure about the workflow or recovery, read bbmcp://guide/llm-texture-strategy via resources/read.'
].join(' ');

export const SERVER_TOOL_INSTRUCTIONS = [
  'Tool paths can be session-bound (e.g., /bbmcp/link_...).',
  'toolRegistry.hash is the authoritative schema change signal; toolSchemaVersion is coarse.',
  'Tool schemas are strict (extra fields are rejected).',
  'Use get_project_state (or includeState/includeDiff) before and after edits.',
  'Prefer high-level pipelines: model_pipeline, texture_pipeline, entity_pipeline, block_pipeline.',
  'For GeckoLib entities, use entity_pipeline.texturePlan to auto-create textures + UVs when uvUsageId is unavailable.',
  'Prefer ensure_project to create or reuse projects; use match/onMismatch/onMissing to control when a fresh project is created.',
  'ensure_project supports action="delete" to close the active project. Provide target.name to match the open project; set force=true to discard unsaved changes (no auto-save).',
  'ensure_project auto-confirms the Blockbench project dialog. Provide ensure_project.dialog values for required fields (e.g., format, parent) so creation can proceed without UI input.',
  'For Java Block/Item creation, the server auto-fills dialog defaults (format/parent). Override with ensure_project.dialog when needed.',
  'Use block_pipeline to generate blockstate/model/item JSON resources.',
  'Prefer id fields when updating or deleting items.',
  'Pass ifRevision on mutations to guard against stale state.',
  'If you get invalid_state_revision_mismatch, call get_project_state and retry with the latest ifRevision.',
  RIGGING_WORKFLOW_INSTRUCTIONS,
  TEXTURE_WORKFLOW_INSTRUCTIONS
].join(' ');

export const SIDECAR_TOOL_INSTRUCTIONS = [
  'Use get_project_state (or includeState/includeDiff) before mutations and include ifRevision.',
  'toolRegistry.hash is the authoritative schema change signal; toolSchemaVersion is coarse.',
  'Prefer high-level pipelines: model_pipeline, texture_pipeline, entity_pipeline, block_pipeline.',
  'Prefer ensure_project to create or reuse projects; use match/onMismatch/onMissing to control when a fresh project is created.',
  'ensure_project supports action="delete" to close the active project. Provide target.name to match the open project; set force=true to discard unsaved changes (no auto-save).',
  'ensure_project auto-confirms the Blockbench project dialog. Provide ensure_project.dialog values for required fields (e.g., format, parent) so creation can proceed without UI input.',
  'For Java Block/Item creation, the server auto-fills dialog defaults (format/parent). Override with ensure_project.dialog when needed.',
  'Use block_pipeline to generate blockstate/model/item JSON resources.',
  'Prefer id-based updates.',
  'If you get invalid_state_revision_mismatch, call get_project_state and retry with the latest ifRevision.',
  RIGGING_WORKFLOW_INSTRUCTIONS,
  TEXTURE_WORKFLOW_INSTRUCTIONS
].join(' ');




