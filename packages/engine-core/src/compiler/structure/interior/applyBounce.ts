import type { StructureGrid } from '../contract';

type CompiledRoom = NonNullable<StructureGrid['interiors']>[number];

const applyRoomRadiosityCell = (
  sIdx: number,
  gIdx: number,
  rad: CompiledRoom['radiosity'],
  blockR: Uint8Array,
  blockG: Uint8Array,
  blockB: Uint8Array,
): void => {
  const rr = Math.min(255, rad.bounce_r[sIdx]! + Math.round(rad.sun_patch_r[sIdx]! * 0.45));
  const rg = Math.min(255, rad.bounce_g[sIdx]! + Math.round(rad.sun_patch_g[sIdx]! * 0.45));
  const rb = Math.min(255, rad.bounce_b[sIdx]! + Math.round(rad.sun_patch_b[sIdx]! * 0.45));
  if (rr > blockR[gIdx]!) blockR[gIdx] = rr;
  if (rg > blockG[gIdx]!) blockG[gIdx] = rg;
  if (rb > blockB[gIdx]!) blockB[gIdx] = rb;
};

const applyRoomRadiosityRow = (
  grid: StructureGrid,
  room: CompiledRoom,
  gy: number,
  ly: number,
  blockR: Uint8Array,
  blockG: Uint8Array,
  blockB: Uint8Array,
): void => {
  const [gw, , gd] = grid.size;
  const [ox, , oz] = room.input.bounds_from;
  const [rw, , rd] = room.radiosity.size;
  for (let lz = 0; lz < rd; lz += 1) {
    const gz = oz + lz;
    if (gz < 0 || gz >= gd) continue;
    for (let lx = 0; lx < rw; lx += 1) {
      const gx = ox + lx;
      if (gx < 0 || gx >= gw) continue;
      applyRoomRadiosityCell(
        (ly * rd + lz) * rw + lx,
        (gy * gd + gz) * gw + gx,
        room.radiosity,
        blockR,
        blockG,
        blockB,
      );
    }
  }
};

/** Blends 2-bounce interior radiosity and sun patches into the grid RGB lighting buffers. */
export const applyInteriorRadiosityBounce = (
  grid: StructureGrid,
  blockR: Uint8Array,
  blockG: Uint8Array,
  blockB: Uint8Array,
): void => {
  const gh = grid.size[1];
  for (const room of grid.interiors ?? []) {
    const oy = room.input.bounds_from[1];
    const rh = room.radiosity.size[1];
    for (let ly = 0; ly < rh; ly += 1) {
      const gy = oy + ly;
      if (gy >= 0 && gy < gh) applyRoomRadiosityRow(grid, room, gy, ly, blockR, blockG, blockB);
    }
  }
};
