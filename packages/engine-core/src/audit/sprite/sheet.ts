import { evaluateSpriteQuality } from './evaluate';
import type { SpriteAuditReport } from './contract';
import type { SpriteProduct } from '../../compiler/sprite/contract';
import { relativeLuminance } from '../../textures/oklch';
import {
  drawBadgeRgba,
  drawTextRgba,
  fillRectRgba,
  type RgbaColor,
} from '../../textures/pixelfont';
import { encodeCanonicalPng } from '../../textures/textureRecipe/png';
import { rasterizeCanonicalTexture } from '../../textures/textureRecipe/raster';

const SHEET_SIZE = 512;
const PANEL_SIZE = 256;

export type SpriteSheetInput = Pick<SpriteProduct, 'profile' | 'raster'>;

const drawChecker = (buf: Uint8Array, ox: number, oy: number, w: number, h: number): void => {
  for (let y = 0; y < h; y += 8) {
    for (let x = 0; x < w; x += 8) {
      const dark = (((x >> 3) + (y >> 3)) & 1) === 0;
      fillRectRgba(
        buf,
        SHEET_SIZE,
        SHEET_SIZE,
        ox + x,
        oy + y,
        Math.min(8, w - x),
        Math.min(8, h - y),
        dark ? [24, 28, 36, 255] : [30, 35, 44, 255],
      );
    }
  }
};

const blitScaled = (
  buf: Uint8Array,
  src: Uint8Array,
  sw: number,
  sh: number,
  dx: number,
  dy: number,
  scale: number,
  mode: 'color' | 'silhouette' | 'luma',
): void => {
  for (let y = 0; y < sh; y += 1) {
    for (let x = 0; x < sw; x += 1) {
      const i = (y * sw + x) * 4;
      if (src[i + 3] === 0) continue;
      let color: RgbaColor;
      if (mode === 'silhouette') color = [221, 213, 198, 255];
      else if (mode === 'luma') {
        const hex =
          '#' +
          [src[i]!, src[i + 1]!, src[i + 2]!].map((v) => v.toString(16).padStart(2, '0')).join('');
        const v = Math.round(Math.sqrt(relativeLuminance(hex)) * 255);
        color = [v, v, v, 255];
      } else {
        const a = src[i + 3]! / 255;
        color = [
          Math.round(src[i]! * a + 26 * (1 - a)),
          Math.round(src[i + 1]! * a + 30 * (1 - a)),
          Math.round(src[i + 2]! * a + 38 * (1 - a)),
          255,
        ];
      }
      fillRectRgba(
        buf,
        SHEET_SIZE,
        SHEET_SIZE,
        dx + x * scale,
        dy + y * scale,
        scale,
        scale,
        color,
      );
    }
  }
};

const extractUniqueSwatches = (src: Uint8Array, count: number): readonly RgbaColor[] => {
  const seen = new Map<string, RgbaColor>();
  for (let i = 0; i < count; i += 1) {
    if (src[i * 4 + 3] === 0) continue;
    const key = `${src[i * 4]},${src[i * 4 + 1]},${src[i * 4 + 2]}`;
    if (!seen.has(key)) seen.set(key, [src[i * 4]!, src[i * 4 + 1]!, src[i * 4 + 2]!, 255]);
  }
  return [...seen.values()].sort(
    (a, b) => a[0] * 299 + a[1] * 587 + a[2] * 114 - (b[0] * 299 + b[1] * 587 + b[2] * 114),
  );
};

const drawItemPanels = (
  buf: Uint8Array,
  src: Uint8Array,
  w: number,
  h: number,
  audit: SpriteAuditReport,
): void => {
  const mainScale = Math.max(1, Math.floor(192 / Math.max(w, h)));
  const ox1 = Math.floor((PANEL_SIZE - w * mainScale) / 2);
  const oy1 = Math.floor((PANEL_SIZE - h * mainScale) / 2) + 8;
  drawChecker(buf, ox1 - 4, oy1 - 4, w * mainScale + 8, h * mainScale + 8);
  blitScaled(buf, src, w, h, ox1, oy1, mainScale, 'color');
  blitScaled(buf, src, w, h, 14, PANEL_SIZE - h - 12, 1, 'color');

  blitScaled(buf, src, w, h, PANEL_SIZE + ox1, oy1, mainScale, 'silhouette');
  blitScaled(buf, src, w, h, ox1, PANEL_SIZE + oy1, mainScale, 'luma');

  const swatches = extractUniqueSwatches(src, w * h).slice(0, 28);
  swatches.forEach((c, idx) => {
    const col = idx % 7,
      row = Math.floor(idx / 7);
    fillRectRgba(
      buf,
      SHEET_SIZE,
      SHEET_SIZE,
      PANEL_SIZE + 20 + col * 31,
      PANEL_SIZE + 44 + row * 28,
      26,
      22,
      c,
    );
  });
  drawTextRgba(
    buf,
    SHEET_SIZE,
    SHEET_SIZE,
    `SCORE ${audit.score} ${audit.grade.toUpperCase()}`,
    PANEL_SIZE + 20,
    PANEL_SIZE + 188,
    audit.passed ? [130, 230, 150, 255] : [245, 110, 110, 255],
    2,
  );
  drawTextRgba(
    buf,
    SHEET_SIZE,
    SHEET_SIZE,
    `${w}X${h} ${audit.profile}`,
    PANEL_SIZE + 20,
    PANEL_SIZE + 216,
    [190, 200, 215, 255],
    1,
  );
};

const drawTilePanels = (
  buf: Uint8Array,
  src: Uint8Array,
  w: number,
  h: number,
  audit: SpriteAuditReport,
): void => {
  const s1 = Math.max(1, Math.floor(192 / Math.max(w, h)));
  const o1 = Math.floor((PANEL_SIZE - w * s1) / 2);
  blitScaled(buf, src, w, h, o1, o1 + 8, s1, 'color');

  const ts = Math.max(1, Math.floor(192 / (3 * Math.max(w, h))));
  const ox2 = PANEL_SIZE + Math.floor((PANEL_SIZE - 3 * w * ts) / 2);
  const oy2 = Math.floor((PANEL_SIZE - 3 * h * ts) / 2) + 8;
  for (let ty = 0; ty < 3; ty += 1) {
    for (let tx = 0; tx < 3; tx += 1) {
      blitScaled(buf, src, w, h, ox2 + tx * w * ts, oy2 + ty * h * ts, ts, 'color');
      blitScaled(
        buf,
        src,
        w,
        h,
        ox2 - PANEL_SIZE + tx * w * ts,
        PANEL_SIZE + oy2 + ty * h * ts,
        ts,
        'luma',
      );
    }
  }
  const swatches = extractUniqueSwatches(src, w * h).slice(0, 28);
  swatches.forEach((c, idx) => {
    const col = idx % 7,
      row = Math.floor(idx / 7);
    fillRectRgba(
      buf,
      SHEET_SIZE,
      SHEET_SIZE,
      PANEL_SIZE + 20 + col * 31,
      PANEL_SIZE + 44 + row * 28,
      26,
      22,
      c,
    );
  });
  drawTextRgba(
    buf,
    SHEET_SIZE,
    SHEET_SIZE,
    `TILE ${audit.score} ${audit.grade.toUpperCase()}`,
    PANEL_SIZE + 20,
    PANEL_SIZE + 188,
    audit.passed ? [130, 230, 150, 255] : [245, 110, 110, 255],
    2,
  );
};

export const encodeRgbaBufferPng = (buf: Uint8Array, width: number, height: number): Uint8Array => {
  const details = [];
  for (let y = 0; y < height; y += 1) {
    let x = 0;
    while (x < width) {
      const i = (y * width + x) * 4;
      const r = buf[i]!,
        g = buf[i + 1]!,
        b = buf[i + 2]!;
      let end = x + 1;
      while (
        end < width &&
        buf[(y * width + end) * 4] === r &&
        buf[(y * width + end) * 4 + 1] === g &&
        buf[(y * width + end) * 4 + 2] === b
      ) {
        end += 1;
      }
      const color = '#' + [r, g, b].map((c) => c.toString(16).padStart(2, '0')).join('');
      details.push({
        id: `s_${y}_${x}`,
        x,
        y,
        width: end - x,
        height: 1,
        color,
        alpha: 255 as const,
      });
      x = end;
    }
  }
  return encodeCanonicalPng(
    rasterizeCanonicalTexture(width, height, {
      background: '#141820',
      backgroundAlpha: 255,
      canvasDetails: details,
      alphaMasks: [],
    }),
  );
};

/** Pure-CPU 4-panel 512x512 inspection sheet for Sprite v2 items and seamless tiles. */
export function spriteInspectSheetPng(
  sprite: SpriteSheetInput,
  audit: SpriteAuditReport,
): Uint8Array;
export function spriteInspectSheetPng(sprite: SpriteProduct, audit?: SpriteAuditReport): Uint8Array;
export function spriteInspectSheetPng(
  sprite: SpriteSheetInput | SpriteProduct,
  audit?: SpriteAuditReport,
): Uint8Array {
  const report = audit ?? evaluateSpriteQuality(sprite as SpriteProduct);
  const buf = new Uint8Array(SHEET_SIZE * SHEET_SIZE * 4);
  fillRectRgba(buf, SHEET_SIZE, SHEET_SIZE, 0, 0, SHEET_SIZE, SHEET_SIZE, [20, 24, 32, 255]);
  const src = sprite.raster.rgba.copy();
  const w = sprite.raster.width,
    h = sprite.raster.height;
  if (sprite.profile === 'tile') {
    drawTilePanels(buf, src, w, h, report);
    drawBadgeRgba(buf, SHEET_SIZE, SHEET_SIZE, 6, 6, 'TILE 1X');
    drawBadgeRgba(buf, SHEET_SIZE, SHEET_SIZE, PANEL_SIZE + 6, 6, '3X3 TILED');
    drawBadgeRgba(buf, SHEET_SIZE, SHEET_SIZE, 6, PANEL_SIZE + 6, 'VALUE (LUMA)');
    drawBadgeRgba(buf, SHEET_SIZE, SHEET_SIZE, PANEL_SIZE + 6, PANEL_SIZE + 6, 'PALETTE + AUDIT');
  } else {
    drawItemPanels(buf, src, w, h, report);
    drawBadgeRgba(
      buf,
      SHEET_SIZE,
      SHEET_SIZE,
      6,
      6,
      `SCALE 1X + ${Math.floor(192 / Math.max(w, h))}X`,
    );
    drawBadgeRgba(buf, SHEET_SIZE, SHEET_SIZE, PANEL_SIZE + 6, 6, 'SILHOUETTE');
    drawBadgeRgba(buf, SHEET_SIZE, SHEET_SIZE, 6, PANEL_SIZE + 6, 'VALUE (LUMA)');
    drawBadgeRgba(buf, SHEET_SIZE, SHEET_SIZE, PANEL_SIZE + 6, PANEL_SIZE + 6, 'PALETTE + AUDIT');
  }
  fillRectRgba(buf, SHEET_SIZE, SHEET_SIZE, PANEL_SIZE - 1, 0, 2, SHEET_SIZE, [42, 48, 60, 255]);
  fillRectRgba(buf, SHEET_SIZE, SHEET_SIZE, 0, PANEL_SIZE - 1, SHEET_SIZE, 2, [42, 48, 60, 255]);
  return encodeRgbaBufferPng(buf, SHEET_SIZE, SHEET_SIZE);
}
