import type { Vec3 } from '../identity';

export interface GeometryMeasurementRequest {
  readonly nodeId: string;
  readonly scope: 'node' | 'subtree';
  readonly groundY: number;
  readonly tolerance: number;
}

export interface GeometryMeasurement {
  readonly schemaVersion: 1;
  readonly nodeId: string;
  readonly scope: 'node' | 'subtree';
  readonly pose: 'rest';
  readonly space: 'model';
  readonly envelope: 'full-primitives-including-hidden-and-alpha';
  readonly geometryCount: number;
  readonly bounds: Readonly<{ readonly min: Vec3; readonly max: Vec3 }>;
  readonly dimensions: Vec3;
  readonly ground: Readonly<{
    readonly y: number;
    readonly tolerance: number;
    readonly signedGap: number;
    readonly relation: 'above' | 'touching' | 'penetrating';
  }>;
}

export type MeasurementResult =
  | { readonly ok: true; readonly value: GeometryMeasurement }
  | { readonly ok: false; readonly path: string;
      readonly reason: 'not_found' | 'empty_geometry' | 'invalid_geometry' |
        'budget_exceeded' | 'invalid_request' };

export interface SurfaceInspection {
  readonly schemaVersion: 1;
  readonly nodeId: string;
  readonly kind: 'cube' | 'plane';
  readonly faces: readonly Readonly<{
    readonly direction: string;
    readonly enabled: boolean;
    readonly textureId: string | null;
    readonly uv: readonly number[] | null;
    readonly rotation: number;
    readonly pixelSpan: readonly number[] | null;
    readonly texture: Readonly<{ readonly width: number; readonly height: number;
      readonly sampling: 'nearest' | 'linear'; readonly contentHash: string }> | null;
  }>[];
}
