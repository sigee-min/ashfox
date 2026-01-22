import { Capabilities, Capability, Limits, FormatKind, PreviewCapability } from './types';
import { FormatDescriptor } from './ports/formats';
import { FormatOverrides, resolveFormatId } from './domain/format';

export const PLUGIN_ID = 'bbmcp';
export const PLUGIN_VERSION = '0.0.2';
export const TOOL_SCHEMA_VERSION = '2025-04-06';
export const DEFAULT_SERVER_HOST = '127.0.0.1';
export const DEFAULT_SERVER_PORT = 8787;
export const DEFAULT_SERVER_PATH = '/mcp';

const DEFAULT_LIMITS: Limits = {
  maxCubes: 2048,
  maxTextureSize: 2048,
  maxAnimationSeconds: 120
};

const BASE_FORMATS: Array<{ format: FormatKind; animations: boolean }> = [
  { format: 'Java Block/Item', animations: false },
  { format: 'geckolib', animations: true },
  { format: 'animated_java', animations: true }
];

const CAPABILITIES_GUIDANCE = {
  toolPathStability: {
    cache: 'no' as const,
    note: 'Tool paths like /bbmcp/link_... are session-bound and can change after reconnects. Re-discover tools on Resource not found or when toolRegistry.hash changes.'
  },
  mutationPolicy: {
    requiresRevision: true,
    note: 'All mutating tools require ifRevision. Call get_project_state before mutations; the server may auto-retry once on revision mismatch. Prefer ensure_project to reuse active projects.'
  },
  retryPolicy: {
    maxAttempts: 2,
    onErrors: ['resource_not_found', 'invalid_state', 'invalid_state_revision_mismatch', 'tool_registry_empty'],
    steps: ['tools/list', 'refresh_state', 'retry_once']
  },
  rediscovery: {
    refetchTools: true,
    refreshState: true,
    methods: ['tools/list', 'list_capabilities', 'get_project_state']
  },
  textureStrategy: {
    note:
      'Prefer high-level tools (generate_block_pipeline, apply_model_spec, apply_texture_spec, generate_texture_preset). Use low-level tools (add_bone/add_cube/set_face_uv) only when high-level tools cannot express the change; avoid mixing high- and low-level edits in the same task. Lock invariants before painting: textureResolution, UV policy (manual per-face), and texture count (single atlas vs per-material). For <=32px textures, set_pixel ops are fine; for 64px+ use generate_texture_preset to avoid large payloads. Build a mapping table first: call preflight_texture without texture filters, then paint only the UV rects it reports (uvPaint enforced); pass its uvUsageId to apply_texture_spec or generate_texture_preset. Full-texture painting is not supported; map UVs to the full texture if you want whole-texture coverage. If UV usage changes, apply_texture_spec/generate_texture_preset will fail with invalid_state and you must preflight again. UV rects must not overlap unless identical; overlapping rects block apply_texture_spec and are reported by preflight/validate. Start with a checker/label texture to verify orientation before final paint. If UVs change, repaint using the new mapping. Prefer splitting textures by material groups (e.g., pot/soil/plant) and assign by cubeNames. After assign_texture, use set_face_uv to map per-face UVs explicitly. Low opaque coverage is rejected to avoid transparent results; fill a larger area or tighten UVs. If UVs exceed the current textureResolution, increase project resolution (width >= 2*(w+d), height >= 2*(h+d), round up to 32/64/128) or split textures per material. Use set_project_texture_resolution before creating larger textures. apply_texture_spec uses ops-only; omit ops to create a blank texture (background can still fill). For visual inspection, render_preview/read_texture return image content; use saveToTmp to snapshot into .bbmcp/tmp when images cannot be attached. For entity workflows, prefer apply_entity_spec (geckolib v3/v4) and see bbmcp://guide/entity-workflow via resources/read.'
  }
};

const computeFormatCapabilities = (
  formats: FormatDescriptor[],
  overrides?: FormatOverrides
): Capability[] =>
  BASE_FORMATS.map((base) => {
    const resolved = resolveFormatId(base.format, formats, overrides);
    return { ...base, enabled: Boolean(resolved) };
  });

export function computeCapabilities(
  blockbenchVersion: string | undefined,
  formats: FormatDescriptor[] = [],
  overrides?: FormatOverrides,
  preview?: PreviewCapability
): Capabilities {
  return {
    pluginVersion: PLUGIN_VERSION,
    toolSchemaVersion: TOOL_SCHEMA_VERSION,
    blockbenchVersion: blockbenchVersion ?? 'unknown',
    formats: computeFormatCapabilities(formats, overrides),
    limits: DEFAULT_LIMITS,
    preview,
    guidance: CAPABILITIES_GUIDANCE
  };
}

