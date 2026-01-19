import { Capabilities, Capability, Limits, FormatKind, PreviewCapability } from './types';
import { FormatDescriptor } from './ports/formats';
import { FormatOverrides, resolveFormatId } from './domain/format';

export const PLUGIN_ID = 'bbmcp';
export const PLUGIN_VERSION = '0.0.2';
export const TOOL_SCHEMA_VERSION = '2025-04-02';
export const DEFAULT_SERVER_HOST = '127.0.0.1';
export const DEFAULT_SERVER_PORT = 8787;
export const DEFAULT_SERVER_PATH = '/mcp';

const DEFAULT_LIMITS: Limits = {
  maxCubes: 2048,
  maxTextureSize: 2048,
  maxAnimationSeconds: 120
};

const BASE_FORMATS: Array<{ format: FormatKind; animations: boolean }> = [
  { format: 'vanilla', animations: false },
  { format: 'geckolib', animations: true },
  { format: 'animated_java', animations: true }
];

const CAPABILITIES_GUIDANCE = {
  toolPathStability: {
    cache: 'no' as const,
    note: 'Tool paths like /bbmcp/link_... are session-bound and can change after reconnects.'
  },
  mutationPolicy: {
    requiresRevision: true,
    note: 'All mutating tools require ifRevision. Call get_project_state before mutations and retry with the latest revision.'
  },
  textureStrategy: {
    note: 'Prefer splitting textures by material groups (e.g., pot/soil/plant) and assign by cubeNames. After assign_texture, use set_face_uv to map per-face UVs explicitly. If UVs exceed the current textureResolution, increase project resolution (width >= 2*(w+d), height >= 2*(h+d), round up to 32/64/128) or split textures per material. Use set_project_texture_resolution before creating larger textures. apply_texture_spec uses ops-only; omit ops to create a blank texture (background can still fill).'
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
