import { hexToOklch, type OklchColor } from '../textures/oklch';
import {
  VFX_KIND,
  VFX_SCHEMA_VERSION,
  type CompiledVfx,
  type VfxBlendMode,
  type VfxEmitterSpec,
  type VfxFlipbookManifest,
  type VfxRecipe,
  type VfxRuntimeStats,
} from './contract';

export interface VfxRuntimePaletteRole {
  readonly hex: string;
  readonly oklch: OklchColor;
}

export interface VfxRuntimeSpec {
  readonly schema: typeof VFX_SCHEMA_VERSION;
  readonly kind: typeof VFX_KIND;
  readonly name: string;
  readonly durationSeconds: number;
  readonly fps: number;
  readonly loop: 'once' | 'loop';
  readonly palette: {
    readonly name: string;
    readonly core: VfxRuntimePaletteRole;
    readonly mid: VfxRuntimePaletteRole;
    readonly edge: VfxRuntimePaletteRole;
    readonly smoke: VfxRuntimePaletteRole;
  };
  readonly elements: readonly {
    readonly id: string;
    readonly startTime: number;
    readonly endTime: number;
    readonly blendMode: VfxBlendMode;
    readonly primitiveKind: string;
    readonly textureKind: string;
    readonly dissolve?: {
      readonly mode: string;
      readonly frames: number;
      readonly columns: number;
      readonly rows: number;
    };
    readonly colorHex: string;
    readonly drawCalls: number;
  }[];
  readonly bursts: readonly {
    readonly id: string;
    readonly particleShape: string;
    readonly blendMode: VfxBlendMode;
    readonly particleCount: number;
    readonly paletteColors: readonly string[];
    readonly drawCalls: number;
  }[];
  readonly flipbook: VfxFlipbookManifest;
  readonly stats: VfxRuntimeStats;
}

/** Emit an engine-native `.vfx.json` structured runtime spec from a compiled VFX asset. */
export const emitVfxRuntimeSpec = (compiled: CompiledVfx): VfxRuntimeSpec => {
  const roleEntry = (hex: string): VfxRuntimePaletteRole => ({
    hex,
    oklch: hexToOklch(hex),
  });
  return Object.freeze({
    schema: compiled.schema,
    kind: compiled.kind,
    name: compiled.name,
    durationSeconds: compiled.durationSeconds,
    fps: compiled.fps,
    loop: compiled.loop,
    palette: {
      name: compiled.palette.name,
      core: roleEntry(compiled.palette.core),
      mid: roleEntry(compiled.palette.mid),
      edge: roleEntry(compiled.palette.edge),
      smoke: roleEntry(compiled.palette.smoke),
    },
    elements: compiled.elements.map((el) => ({
      id: el.id,
      startTime: el.startTime,
      endTime: el.endTime,
      blendMode: el.blendMode,
      primitiveKind: el.mesh.kind,
      textureKind: el.texture.kind,
      ...(el.dissolveAtlas
        ? {
            dissolve: {
              mode: el.dissolveAtlas.mode,
              frames: el.dissolveAtlas.frameCount,
              columns: el.dissolveAtlas.columns,
              rows: el.dissolveAtlas.rows,
            },
          }
        : {}),
      colorHex: el.colorHex,
      drawCalls: el.drawCalls,
    })),
    bursts: compiled.particleBursts.map((burst) => ({
      id: burst.id,
      particleShape: burst.particleShape,
      blendMode: burst.blendMode,
      particleCount: burst.particleCount,
      paletteColors: burst.paletteColors,
      drawCalls: burst.drawCalls,
    })),
    flipbook: compiled.flipbookManifest,
    stats: compiled.stats,
  });
};

export interface BedrockParticleSpec {
  readonly format_version: '1.10.0';
  readonly particle_effect: {
    readonly description: {
      readonly identifier: string;
      readonly basic_render_parameters: {
        readonly material: 'particles_add' | 'particles_alpha' | 'particles_blend';
        readonly texture: string;
      };
    };
    readonly components: Readonly<Record<string, unknown>>;
  };
}

const bedrockMaterial = (
  blend: VfxBlendMode | undefined,
): 'particles_add' | 'particles_alpha' | 'particles_blend' => {
  if (blend === 'blend') return 'particles_alpha';
  if (blend === 'premul') return 'particles_blend';
  return 'particles_add';
};

const bedrockShapeComponent = (emitter: VfxEmitterSpec): Readonly<Record<string, unknown>> => {
  const p = emitter.shapeParams;
  if (emitter.shape === 'sphere') {
    return { 'minecraft:emitter_shape_sphere': { radius: p?.radius ?? 1, surface_only: false } };
  }
  if (emitter.shape === 'ring' || emitter.shape === 'arc') {
    return { 'minecraft:emitter_shape_disc': { radius: p?.radius ?? 4, surface_only: false } };
  }
  if (emitter.shape === 'box') {
    const s = p?.size ?? [2, 2, 2];
    return {
      'minecraft:emitter_shape_box': { half_dimensions: [s[0] * 0.5, s[1] * 0.5, s[2] * 0.5] },
    };
  }
  return {
    'minecraft:emitter_shape_point': {
      offset: p?.offset ?? [0, 0, 0],
      direction:
        emitter.shape === 'cone'
          ? [0, 1, 0]
          : ['math.random(-1,1)', 'math.random(-1,1)', 'math.random(-1,1)'],
    },
  };
};

const buildColorGradient = (
  emitter: VfxEmitterSpec,
  recipe: VfxRecipe,
): Readonly<Record<string, string>> => {
  const roles =
    emitter.colorOverLife.length > 0 ? emitter.colorOverLife : (['core', 'mid', 'edge'] as const);
  const gradient: Record<string, string> = {};
  for (let i = 0; i < roles.length; i += 1) {
    const stop = roles.length === 1 ? '0.0' : (i / (roles.length - 1)).toFixed(2);
    gradient[stop] = recipe.palette[roles[i]!];
  }
  return gradient;
};

const lowerEmitterToBedrock = (recipe: VfxRecipe, emitter: VfxEmitterSpec): BedrockParticleSpec => {
  const safeName = recipe.name.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const safeId = emitter.id.toLowerCase().replace(/[^a-z0-9_]/g, '_');
  const activeTime = Math.max(0.05, emitter.endTime - emitter.startTime);
  const baseSize = emitter.sizeOverLife[0]?.value ?? 1;
  const lifetimeComponent =
    recipe.loop === 'loop'
      ? { 'minecraft:emitter_lifetime_looping': { active_time: activeTime, sleep_time: 0 } }
      : { 'minecraft:emitter_lifetime_once': { active_time: activeTime } };
  const rateComponent =
    recipe.loop === 'loop'
      ? {
          'minecraft:emitter_rate_steady': {
            spawn_rate: Math.max(1, Math.round(emitter.count / activeTime)),
            max_particles: emitter.count,
          },
        }
      : { 'minecraft:emitter_rate_instant': { num_particles: emitter.count } };
  return Object.freeze({
    format_version: '1.10.0',
    particle_effect: {
      description: {
        identifier: `ashfox:${safeName}_${safeId}`,
        basic_render_parameters: {
          material: bedrockMaterial(emitter.blendMode),
          texture: `textures/particle/${safeName}_${emitter.particle}`,
        },
      },
      components: {
        ...rateComponent,
        ...lifetimeComponent,
        ...bedrockShapeComponent(emitter),
        'minecraft:particle_initial_speed': (emitter.speedMin + emitter.speedMax) * 0.5,
        'minecraft:particle_lifetime_expression': {
          max_lifetime: (emitter.lifeMin + emitter.lifeMax) * 0.5,
        },
        'minecraft:particle_motion_dynamic': {
          linear_acceleration: [0, emitter.gravity, 0],
          linear_drag_coefficient: emitter.drag,
        },
        'minecraft:particle_appearance_billboard': {
          size: [baseSize * 0.1, baseSize * 0.1],
          facing_camera_mode: (emitter.velocityStretch ?? 0) > 0 ? 'direction_y' : 'lookat_xyz',
        },
        'minecraft:particle_appearance_tinting': {
          color: {
            interpolant: 'variable.particle_age / variable.particle_lifetime',
            gradient: buildColorGradient(emitter, recipe),
          },
        },
      },
    },
  });
};

/** Deterministically lower a VFX recipe's emitters into Minecraft Bedrock `.particle.json` specs. */
export const emitBedrockParticleSpecs = (recipe: VfxRecipe): readonly BedrockParticleSpec[] =>
  Object.freeze(recipe.emitters.map((emitter) => lowerEmitterToBedrock(recipe, emitter)));
