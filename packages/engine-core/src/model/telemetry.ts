export type GrainMode = 'clustered' | 'soft' | 'fur' | 'wood' | 'cloth' | 'brushed' | 'none';

export interface ChartAuthoringTelemetry {
  readonly id: string;
  readonly layout: 'box' | 'flat';
  readonly visibleTexels: number;
  readonly authoredDeltaTexels: number;
  readonly aoTexels: number;
  readonly protectedTexels: number;
  readonly distinctRoles: number;
  readonly regionGrainModes: Readonly<Record<string, GrainMode>>;
  readonly faceSymmetry: Readonly<Record<string, number>>;
}

export interface TextureAuthoringTelemetry {
  readonly textureId: string;
  readonly tone: 'none' | 'voxel' | 'painterly';
  readonly defaultGrain: GrainMode;
  readonly charts: readonly ChartAuthoringTelemetry[];
}

export interface AssetAuthoringTelemetry {
  readonly textures: Readonly<Record<string, TextureAuthoringTelemetry>>;
}
