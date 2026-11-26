import type { Vec3 } from '../model/identity';

export const VFX_SCHEMA_VERSION = 'ashfox 1' as const;
export const VFX_KIND = 'vfx' as const;

export type VfxBlendMode = 'additive' | 'blend' | 'premul';
export type VfxLoopMode = 'once' | 'loop';
export type VfxPaletteRole = 'core' | 'mid' | 'edge' | 'smoke';

export interface VfxPalette {
  readonly name: string;
  readonly core: string;
  readonly mid: string;
  readonly edge: string;
  readonly smoke: string;
}

export type VfxTextureKind =
  'slash_streak' | 'radial_flare' | 'starburst' | 'ring_wave' | 'magic_circle' | 'stylized_smoke';

export interface VfxTextureSpec {
  readonly kind: VfxTextureKind;
  readonly width: number;
  readonly height: number;
  readonly blendMode: VfxBlendMode;
  readonly seed: number;
  readonly posterize?: number;
  readonly bristles?: number;
  readonly spikes?: number;
  readonly runes?: number;
  readonly rings?: number;
  readonly curlScale?: number;
  readonly tintRole?: VfxPaletteRole;
}

export interface VfxTextureBuffer {
  readonly kind: VfxTextureKind;
  readonly width: number;
  readonly height: number;
  readonly rgba: Uint8Array;
  readonly alphaMode: 'soft';
  readonly blendMode: VfxBlendMode;
  readonly premultiplied: boolean;
  readonly extras: {
    readonly ashfoxBlendMode: VfxBlendMode;
    readonly ashfoxUnlit: true;
  };
}

export type VfxDissolveMode = 'voronoi' | 'simplex' | 'directional_wipe' | 'radial_noise';

export interface VfxDissolveSpec {
  readonly mode: VfxDissolveMode;
  readonly frames: number;
  readonly edgeWidth: number;
  readonly edgeGlowRole: VfxPaletteRole;
  readonly seed?: number;
  readonly directionDeg?: number;
}

export interface VfxDissolveAtlas {
  readonly mode: VfxDissolveMode;
  readonly cellWidth: number;
  readonly cellHeight: number;
  readonly columns: number;
  readonly rows: number;
  readonly frameCount: number;
  readonly atlasWidth: number;
  readonly atlasHeight: number;
  readonly rgba: Uint8Array;
  readonly frameThresholds: readonly number[];
  readonly blendMode: VfxBlendMode;
}

export type VfxPrimitiveKind = 'slash_arc' | 'ribbon' | 'ring' | 'beam' | 'dome';

export interface VfxSlashArcSpec {
  readonly kind: 'slash_arc';
  readonly innerRadius: number;
  readonly outerRadius: number;
  readonly thetaStartDeg: number;
  readonly thetaEndDeg: number;
  readonly segments?: number;
  readonly tipTaper?: number;
  readonly pitchTwistDeg?: number;
  readonly crossed?: boolean;
}

export interface VfxRibbonSpec {
  readonly kind: 'ribbon';
  readonly points: readonly Vec3[];
  readonly segmentsPerSpan?: number;
  readonly widthStart: number;
  readonly widthEnd: number;
  readonly profile: 'crossed' | 'tube';
}

export interface VfxRingSpec {
  readonly kind: 'ring';
  readonly innerRadius: number;
  readonly outerRadius: number;
  readonly segments?: number;
  readonly bevelHeight?: number;
  readonly rippleAmp?: number;
  readonly rippleFreq?: number;
}

export interface VfxBeamSpec {
  readonly kind: 'beam';
  readonly start: Vec3;
  readonly end: Vec3;
  readonly width: number;
  readonly style: 'column' | 'lightning';
  readonly segments?: number;
  readonly jaggedAmp?: number;
  readonly forks?: number;
  readonly forkDepth?: number;
  readonly seed?: number;
}

export interface VfxDomeSpec {
  readonly kind: 'dome';
  readonly shape: 'hemisphere' | 'sphere' | 'cone' | 'torus';
  readonly radius: number;
  readonly innerRadius?: number;
  readonly height?: number;
  readonly subdiv: 1 | 2;
}

export type VfxPrimitiveSpec =
  VfxSlashArcSpec | VfxRibbonSpec | VfxRingSpec | VfxBeamSpec | VfxDomeSpec;

export interface VfxPrimitiveMesh {
  readonly kind: VfxPrimitiveKind;
  readonly positions: readonly number[];
  readonly normals: readonly number[];
  readonly uvs: readonly number[];
  readonly indices: readonly number[];
  readonly vertexCount: number;
  readonly triangleCount: number;
  readonly boundsMin: Vec3;
  readonly boundsMax: Vec3;
}

export type VfxParticleShape = 'voxel_cube' | 'shard' | 'puff' | 'cross_card';
export type VfxEmitterShape = 'point' | 'cone' | 'sphere' | 'ring' | 'box' | 'arc';
export type VfxCurveEasing = 'linear' | 'ease_out' | 'ease_in' | 'snap';

export interface VfxLifeStop<T> {
  readonly t: number;
  readonly value: T;
  readonly easing?: VfxCurveEasing;
}

export interface VfxTurbulenceSpec {
  readonly mode: 'curl';
  readonly freq: number;
  readonly amp: number;
}

export interface VfxVortexSpec {
  readonly axis: Vec3;
  readonly center: Vec3;
  readonly strength: number;
  readonly radialPull?: number;
}

export interface VfxGroundSpec {
  readonly y: number;
  readonly bounce: number;
  readonly friction: number;
}

export interface VfxEmitterShapeParams {
  readonly angleDeg?: number;
  readonly radius?: number;
  readonly innerRadius?: number;
  readonly size?: Vec3;
  readonly sweepDeg?: number;
  readonly offset?: Vec3;
}

export interface VfxEmitterSpec {
  readonly id: string;
  readonly startTime: number;
  readonly endTime: number;
  readonly seed: number;
  readonly count: number;
  readonly shape: VfxEmitterShape;
  readonly shapeParams?: VfxEmitterShapeParams;
  readonly particle: VfxParticleShape;
  readonly speedMin: number;
  readonly speedMax: number;
  readonly lifeMin: number;
  readonly lifeMax: number;
  readonly gravity: number;
  readonly drag: number;
  readonly turbulence?: VfxTurbulenceSpec;
  readonly vortex?: VfxVortexSpec;
  readonly ground?: VfxGroundSpec;
  readonly sizeOverLife: readonly VfxLifeStop<number>[];
  readonly colorOverLife: readonly VfxPaletteRole[];
  readonly velocityStretch?: number;
  readonly spinSpeedDeg?: number;
  readonly blendMode?: VfxBlendMode;
}

export type VfxQuat = readonly [number, number, number, number];

export interface VfxVec3Track {
  readonly times: readonly number[];
  readonly values: readonly Vec3[];
  readonly interpolation: 'LINEAR' | 'STEP';
}

export interface VfxQuatTrack {
  readonly times: readonly number[];
  readonly values: readonly VfxQuat[];
  readonly interpolation: 'LINEAR' | 'STEP';
}

export interface VfxParticleTrack {
  readonly particleIndex: number;
  readonly birthTime: number;
  readonly deathTime: number;
  readonly position: VfxVec3Track;
  readonly rotation: VfxQuatTrack;
  readonly scale: VfxVec3Track;
}

export interface VfxBakedBurst {
  readonly id: string;
  readonly particleShape: VfxParticleShape;
  readonly blendMode: VfxBlendMode;
  readonly sharedMesh: VfxPrimitiveMesh;
  readonly paletteColors: readonly string[];
  readonly particleCount: number;
  readonly drawCalls: number;
  readonly tracks: readonly VfxParticleTrack[];
  readonly boundsMin: Vec3;
  readonly boundsMax: Vec3;
}

export interface VfxElementSpec {
  readonly id: string;
  readonly startTime: number;
  readonly endTime: number;
  readonly blendMode: VfxBlendMode;
  readonly primitive: VfxPrimitiveSpec;
  readonly texture: VfxTextureSpec;
  readonly dissolve?: VfxDissolveSpec;
  readonly colorRole: VfxPaletteRole;
  readonly position?: Vec3;
  readonly rotationDeg?: Vec3;
  readonly spinDeg?: number;
  readonly scaleCurve: readonly VfxLifeStop<number>[];
  readonly alphaCurve?: readonly VfxLifeStop<number>[];
}

export interface VfxBudget {
  readonly maxDrawCalls: number;
  readonly maxTriangles: number;
  readonly maxEstimatedGlbBytes: number;
  readonly maxParticles: number;
}

export const DEFAULT_VFX_BUDGET: VfxBudget = Object.freeze({
  maxDrawCalls: 4,
  maxTriangles: 2500,
  maxEstimatedGlbBytes: 150 * 1024,
  maxParticles: 64,
});

export interface VfxRecipe {
  readonly schema: typeof VFX_SCHEMA_VERSION;
  readonly kind: typeof VFX_KIND;
  readonly name: string;
  readonly durationSeconds: number;
  readonly fps: number;
  readonly loop: VfxLoopMode;
  readonly palette: VfxPalette;
  readonly elements: readonly VfxElementSpec[];
  readonly emitters: readonly VfxEmitterSpec[];
  readonly budget?: Partial<VfxBudget>;
}

export interface CompiledVfxElement {
  readonly id: string;
  readonly startTime: number;
  readonly endTime: number;
  readonly blendMode: VfxBlendMode;
  readonly mesh: VfxPrimitiveMesh;
  readonly texture: VfxTextureBuffer;
  readonly dissolveAtlas?: VfxDissolveAtlas;
  readonly colorHex: string;
  readonly position?: Vec3;
  readonly rotationDeg?: Vec3;
  readonly spinDeg?: number;
  readonly scaleCurve: readonly VfxLifeStop<number>[];
  readonly alphaCurve: readonly VfxLifeStop<number>[];
  readonly drawCalls: number;
}

export interface VfxRuntimeStats {
  readonly drawCalls: number;
  readonly triangles: number;
  readonly estimatedGlbBytes: number;
  readonly particleCount: number;
  readonly textureBytes: number;
}

export interface VfxFlipbookManifest {
  readonly columns: number;
  readonly rows: number;
  readonly frameCount: number;
  readonly fps: number;
  readonly durationSeconds: number;
}

export interface CompiledVfx {
  readonly schema: typeof VFX_SCHEMA_VERSION;
  readonly kind: typeof VFX_KIND;
  readonly name: string;
  readonly durationSeconds: number;
  readonly fps: number;
  readonly loop: VfxLoopMode;
  readonly palette: VfxPalette;
  readonly elements: readonly CompiledVfxElement[];
  readonly particleBursts: readonly VfxBakedBurst[];
  readonly stats: VfxRuntimeStats;
  readonly flipbookManifest: VfxFlipbookManifest;
}
