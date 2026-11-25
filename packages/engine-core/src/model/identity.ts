import { PROJECT_DOCUMENT_SCHEMA_VERSION as CURRENT_PROJECT_DOCUMENT_SCHEMA_VERSION } from '@ashfox/internal-contracts';

export const PROJECT_DOCUMENT_SCHEMA_VERSION = CURRENT_PROJECT_DOCUMENT_SCHEMA_VERSION;

export type ProjectId = string;
export type EntityId = string;
export type AssetId = string;
export type ClipId = string;
export type ChannelId = string;
export type KeyframeId = string;
export type Revision = string;
export type ProjectForwardDirection = 'north' | 'south' | 'east' | 'west';
export type Vec2 = readonly [number, number];
export type Vec3 = readonly [number, number, number];
export type UvRect = readonly [number, number, number, number];

/**
 * Density is a multiplier over the Minecraft baseline of 16 texels/block.
 * Asset workspaces fix that baseline; the derived document retains a compact
 * multiplier for renderer and export APIs.
 */
export const SURFACE_PIXEL_DENSITIES = [1, 2, 4, 8] as const;
export type SurfacePixelDensity = (typeof SURFACE_PIXEL_DENSITIES)[number];

export const isSurfacePixelDensity = (value: unknown): value is SurfacePixelDensity =>
  typeof value === 'number' && SURFACE_PIXEL_DENSITIES.includes(value as SurfacePixelDensity);

type JsonPrimitive = string | number | boolean | null;
export type JsonValue = JsonPrimitive | JsonValue[] | { [key: string]: JsonValue };

export interface ProjectSettings {
  /** Canonical viewing direction materialized from workspace semantics. */
  forward: ProjectForwardDirection;
  textureResolution: {
    width: number;
    height: number;
  };
  surfacePixelDensity: SurfacePixelDensity;
  coordinateSystem: {
    up: 'y';
    handedness: 'right';
    unit: 'pixel';
    rotationUnit: 'degree';
    rotationOrder: 'xyz';
  };
}
