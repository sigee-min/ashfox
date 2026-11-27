import type { RampPreset } from '../../textures/oklch';

export type Point = readonly [number, number];
export type SpriteProfile =
  'item' | 'tile' | 'icon' | 'decal' | 'ui_9slice' | 'crosshair' | 'hud_bar';
export type MirrorMode = 'none' | 'x' | 'y' | 'xy';
export type LightDirection =
  'top_left' | 'top' | 'top_right' | 'right' | 'bottom_right' | 'bottom' | 'bottom_left' | 'left';

export interface SpriteNineSlice {
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
}

export const SPRITE_PROFILES: readonly SpriteProfile[] = Object.freeze([
  'item',
  'tile',
  'icon',
  'decal',
  'ui_9slice',
  'crosshair',
  'hud_bar',
]);
export const SPRITE_SIZES = new Set<number>([16, 32, 64]);

export type ShapeSpec =
  | {
      readonly kind: 'rect';
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
    }
  | {
      readonly kind: 'ellipse';
      readonly cx: number;
      readonly cy: number;
      readonly rx: number;
      readonly ry: number;
    }
  | {
      readonly kind: 'capsule';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly radius: number;
    }
  | {
      readonly kind: 'polygon';
      readonly points: readonly Point[];
    }
  | {
      readonly kind: 'line';
      readonly x1: number;
      readonly y1: number;
      readonly x2: number;
      readonly y2: number;
      readonly thickness: number;
    };

export type SpriteMask =
  | { readonly id: string; readonly kind: 'rows'; readonly rows: readonly string[] }
  | {
      readonly id: string;
      readonly kind: 'shape';
      readonly width: number;
      readonly height: number;
      readonly shape: ShapeSpec;
      readonly mirror: MirrorMode;
    };

export interface SpriteStamp {
  readonly id: string;
  readonly rows: readonly string[];
  readonly slots: readonly string[];
}

export type SpriteRamp =
  | {
      readonly mode: 'explicit';
      readonly colors:
        readonly [string, string, string] | readonly [string, string, string, string, string];
    }
  | { readonly mode: 'auto'; readonly base: string; readonly preset: RampPreset };

export interface SpriteMaterial {
  readonly id: string;
  readonly ramp: SpriteRamp;
}

export type SpritePatternSpec =
  | { readonly kind: 'solid' }
  | {
      readonly kind: 'gradient';
      readonly axis: 'x' | 'y' | 'radial';
      readonly to_material?: string;
      readonly dither: boolean;
      readonly seed: number;
    }
  | {
      readonly kind: 'blotch';
      readonly scale: number;
      readonly density: number;
      readonly seed: number;
      readonly to_material?: string;
    }
  | {
      readonly kind: 'stripe';
      readonly axis: 'x' | 'y' | 'diag_pos' | 'diag_neg';
      readonly period: number;
      readonly width: number;
      readonly offset: number;
      readonly to_material?: string;
    }
  | {
      readonly kind: 'brick';
      readonly width: number;
      readonly height: number;
      readonly mortar: number;
      readonly stagger: number;
      readonly seed: number;
      readonly mortar_material?: string;
    }
  | {
      readonly kind: 'plank';
      readonly height: number;
      readonly joint: number;
      readonly seed: number;
      readonly mortar_material?: string;
    }
  | {
      readonly kind: 'voronoi';
      readonly cells: number;
      readonly jitter: number;
      readonly edge_width: number;
      readonly seed: number;
      readonly edge_material?: string;
    }
  | {
      readonly kind: 'dither';
      readonly mode: 'bayer' | 'cluster';
      readonly density: number;
      readonly seed: number;
      readonly to_material?: string;
    }
  | {
      readonly kind: 'crack';
      readonly count: number;
      readonly seed: number;
      readonly crack_material?: string;
    };

export interface SpriteShade {
  readonly form: 'flat' | 'round' | 'bevel' | 'cylinder' | 'facet';
  readonly light: LightDirection;
  readonly contrast: number;
  readonly specular: number;
  readonly axis?: readonly [Point, Point];
}

export interface SpriteGrain {
  readonly mode: 'none' | 'clustered' | 'soft' | 'directional';
  readonly axis?: 'horizontal' | 'vertical' | 'diagonal';
  readonly amount: number;
  readonly seed: number;
}

export interface SpritePatch {
  readonly id: string;
  readonly at: Point;
  readonly rows: readonly string[];
  readonly colors: Readonly<Record<string, string>>;
  readonly protect: number;
}

export type SpriteLayer =
  | {
      readonly id: string;
      readonly op: 'fill';
      readonly material: string;
      readonly pattern: SpritePatternSpec;
      readonly grain: SpriteGrain;
      readonly alpha?: number;
    }
  | {
      readonly id: string;
      readonly op: 'shape';
      readonly shape: ShapeSpec;
      readonly material: string;
      readonly shade: SpriteShade;
      readonly grain: SpriteGrain;
      readonly mirror: MirrorMode;
      readonly pattern?: SpritePatternSpec;
      readonly clip: 'canvas' | 'occupied';
      readonly alpha?: number;
      readonly feather?: number;
    }
  | {
      readonly id: string;
      readonly op: 'part';
      readonly mask: string;
      readonly material: string;
      readonly at: Point;
      readonly shade: SpriteShade;
      readonly grain: SpriteGrain;
      readonly mirror: MirrorMode;
      readonly pattern?: SpritePatternSpec;
      readonly patches: readonly SpritePatch[];
      readonly alpha?: number;
      readonly feather?: number;
    }
  | {
      readonly id: string;
      readonly op: 'paint';
      readonly at: Point;
      readonly rows: readonly string[];
      readonly colors: Readonly<Record<string, string>>;
      readonly alpha?: number;
    }
  | {
      readonly id: string;
      readonly op: 'stamp';
      readonly stamp: string;
      readonly at: Point;
      readonly flip: MirrorMode;
      readonly colors: Readonly<Record<string, string>>;
      readonly alpha?: number;
    }
  | {
      readonly id: string;
      readonly op: 'erase';
      readonly at?: Point;
      readonly rows?: readonly string[];
      readonly shape?: ShapeSpec;
    }
  | {
      readonly id: string;
      readonly op: 'outline';
      readonly mode: 'sel_out' | 'dark' | 'colored';
      readonly color?: string;
      readonly strength: number;
      readonly inner_rim: boolean;
    }
  | {
      readonly id: string;
      readonly op: 'pattern';
      readonly material: string;
      readonly pattern: SpritePatternSpec;
      readonly clip: 'canvas' | 'occupied';
      readonly alpha?: number;
    };

export interface SpriteItem {
  readonly id: string;
  readonly profile: SpriteProfile;
  readonly canvas: Point;
  readonly slice?: SpriteNineSlice;
  readonly palette: Readonly<Record<string, string>>;
  readonly layers: readonly SpriteLayer[];
}

export interface SpriteDocument {
  readonly masks: readonly SpriteMask[];
  readonly materials: readonly SpriteMaterial[];
  readonly stamps: readonly SpriteStamp[];
  readonly item: SpriteItem;
}

export interface SpriteDiagnostic {
  readonly code: string;
  readonly file: string;
  readonly pointer: string;
  readonly expected: string;
  readonly actual: string;
  readonly hint?: string;
}

export class SpriteInputError extends Error {
  constructor(readonly diagnostic: SpriteDiagnostic) {
    super(
      `${diagnostic.pointer}: expected ${diagnostic.expected}; got ${diagnostic.actual}` +
        (diagnostic.hint ? ` ${diagnostic.hint}` : ''),
    );
  }
}

export const SPRITE_POLICY = 'sprite-v2:oklch:shapes:selout:tile-wrap:png-1';

export const LIGHTS: Readonly<Record<LightDirection, Point>> = Object.freeze({
  top_left: [-1, -1],
  top: [0, -1],
  top_right: [1, -1],
  right: [1, 0],
  bottom_right: [1, 1],
  bottom: [0, 1],
  bottom_left: [-1, 1],
  left: [-1, 0],
});
