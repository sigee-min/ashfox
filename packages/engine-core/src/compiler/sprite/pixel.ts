import type { SpriteGrain, SpritePatternSpec, SpriteShade } from '../../project/sprite/contract';
import { lerpOklchHex } from '../../textures/oklch';
import type { SpritePixelEvidence } from './contract';
import { evaluatePattern, type PatternSample } from './patterns';
import type { FiveToneRamp } from './ramp';
import { baseTone, finalTone, grainDelta } from './shade';

export interface PixelPaintContext {
  readonly width: number;
  readonly height: number;
  readonly wrap: boolean;
  readonly shadeOnly: boolean;
  readonly silhouetteHex: string | null;
  readonly ramps: ReadonlyMap<string, FiveToneRamp>;
}

export interface ShadedPixelInput {
  readonly x: number;
  readonly y: number;
  readonly sx: number;
  readonly sy: number;
  readonly lx: number;
  readonly ly: number;
  readonly bw: number;
  readonly bh: number;
  readonly materialId: string;
  readonly shade: SpriteShade;
  readonly grain: SpriteGrain;
  readonly pattern: SpritePatternSpec | undefined;
  readonly isProt: boolean;
  readonly overlayOnly: boolean;
  readonly prev: SpritePixelEvidence | null;
  readonly owner: SpritePixelEvidence;
}

export interface ShadedPixelResult {
  readonly hex: string;
  readonly material: string;
  readonly usedPattern: boolean;
  readonly evidence: SpritePixelEvidence;
}

const resolvePixelHex = (
  baseRamp: FiveToneRamp,
  patRamp: FiveToneRamp,
  tone: number,
  blend: number | undefined,
): string =>
  blend !== undefined && blend > 0 && blend < 1
    ? lerpOklchHex(baseRamp[tone]!, patRamp[tone]!, blend)
    : patRamp[tone]!;

const evalPixelPattern = (ctx: PixelPaintContext, input: ShadedPixelInput): PatternSample =>
  input.pattern
    ? evaluatePattern(
        input.pattern,
        input.x,
        input.y,
        ctx.width,
        ctx.height,
        ctx.wrap,
        input.materialId,
        input.lx,
        input.ly,
        input.bw,
        input.bh,
      )
    : { active: true, material: input.materialId, toneDelta: 0 };

const resolvePixelTones = (
  ctx: PixelPaintContext,
  input: ShadedPixelInput,
  pat: PatternSample,
): readonly [number, number] => {
  const start = input.overlayOnly
    ? (input.prev?.baseTone ?? 2)
    : baseTone(input.shade, input.lx, input.ly, input.bw, input.bh, input.sx, input.sy);
  const base = Math.max(0, Math.min(4, start + pat.toneDelta));
  const rawDelta = input.isProt || pat.isMortar ? 0 : grainDelta(input.grain, input.x, input.y);
  const tone = ctx.shadeOnly ? base : finalTone(base, rawDelta);
  return [base, tone];
};

/** Resolve final color and evidence for one shaded sprite pixel. */
export const computeShadedPixel = (
  ctx: PixelPaintContext,
  input: ShadedPixelInput,
): ShadedPixelResult | null => {
  const pat = evalPixelPattern(ctx, input);
  if (input.overlayOnly && !pat.active) return null;
  if (input.overlayOnly && input.prev?.baseTone === 0 && input.pattern?.kind !== 'crack')
    return null;
  const baseRamp = ctx.ramps.get(input.materialId)!;
  const patRamp = ctx.ramps.get(pat.material) ?? baseRamp;
  const [base, tone] = resolvePixelTones(ctx, input, pat);
  const hex = ctx.silhouetteHex ?? resolvePixelHex(baseRamp, patRamp, tone, pat.blend);
  return {
    hex,
    material: pat.material,
    usedPattern: input.pattern !== undefined && input.pattern.kind !== 'solid',
    evidence: {
      ...input.owner,
      material: pat.material,
      baseTone: base,
      grainDelta: tone - base,
      protected: input.isProt,
    },
  };
};
