/** Experimental item study v1. Independent of the model workspace reader. */
export type Point = readonly [number, number];
export interface Mask { readonly id: string; readonly rows: readonly string[] }
export interface Stamp extends Mask { readonly slots: readonly string[] }
export type Ramp = { readonly mode: 'explicit'; readonly colors: readonly [string, string, string] } |
  { readonly mode: 'generated'; readonly base: string; readonly preset: 'warm-v1' | 'neutral-v1' };
export interface Material { readonly id: string; readonly ramp: Ramp }
export interface Patch {
  readonly id: string;
  readonly at: Point;
  readonly rows: readonly string[];
  readonly colors: Readonly<Record<string, string>>;
  readonly protect: number;
}
export type Shade = {
  readonly form: 'flat' | 'round' | 'bevel';
  readonly light: string;
  readonly contrast: number;
  readonly axis?: readonly [Point, Point];
};
export type Layer = {
  readonly id: string; readonly op: 'stamp'; readonly stamp: string;
  readonly at: Point; readonly flip: 'none' | 'x' | 'y' | 'xy';
  readonly colors: Readonly<Record<string, string>>;
} | {
  readonly id: string; readonly op: 'paint'; readonly at: Point;
  readonly rows: readonly string[]; readonly colors: Readonly<Record<string, string>>;
} | {
  readonly id: string; readonly op: 'erase'; readonly at: Point; readonly rows: readonly string[];
} | {
  readonly id: string; readonly op: 'part'; readonly mask: string; readonly material: string;
  readonly at: Point; readonly shade: Shade;
  readonly grain: { readonly mode: 'clustered-v1'; readonly amount: number; readonly seed: number };
  readonly patches: readonly Patch[];
};
export interface Item {
  readonly id: string; readonly profile: 'minecraft-item-v1'; readonly canvas: Point;
  readonly palette: Readonly<Record<string, string>>; readonly layers: readonly Layer[];
}
export interface ItemStudy {
  readonly format: 'ashfox-item-study'; readonly version: 1;
  readonly masks: readonly Mask[]; readonly materials: readonly Material[];
  readonly stamps: readonly Stamp[]; readonly items: readonly Item[];
}
export interface SpriteDiagnostic {
  readonly code: string; readonly file: string; readonly pointer: string;
  readonly expected: string; readonly actual: string;
}
export class SpriteInputError extends Error {
  constructor(readonly diagnostic: SpriteDiagnostic) {
    super(`${diagnostic.pointer}: expected ${diagnostic.expected}; got ${diagnostic.actual}`);
  }
}
export const SPRITE_POLICY = 'item-study:minecraft-profile-1:integer-shading-2:ramp-1:cluster-1:png-1';
export const LIGHTS: Readonly<Record<string, Point>> = Object.freeze({
  top_left: [-1, -1], top: [0, -1], top_right: [1, -1], right: [1, 0],
  bottom_right: [1, 1], bottom: [0, 1], bottom_left: [-1, 1], left: [-1, 0]
});
