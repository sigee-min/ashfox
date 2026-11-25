import { parseBlockState } from '../../project/structure/state';
import type { DecodedStructureNbt, StructureGrid } from './contract';

const TAG_END = 0;
const TAG_INT = 3;
const TAG_STRING = 8;
const TAG_LIST = 9;
const TAG_COMPOUND = 10;

class NbtWriter {
  private buf = new Uint8Array(4096);
  private view = new DataView(this.buf.buffer);
  private pos = 0;
  private enc = new TextEncoder();

  private ensure(extra: number): void {
    if (this.pos + extra <= this.buf.length) return;
    let nextCap = this.buf.length * 2;
    while (nextCap < this.pos + extra) nextCap *= 2;
    const next = new Uint8Array(nextCap);
    next.set(this.buf.subarray(0, this.pos));
    this.buf = next;
    this.view = new DataView(this.buf.buffer);
  }

  byte(value: number): void {
    this.ensure(1);
    this.buf[this.pos++] = value & 0xff;
  }

  short(value: number): void {
    this.ensure(2);
    this.view.setInt16(this.pos, value, false);
    this.pos += 2;
  }

  int(value: number): void {
    this.ensure(4);
    this.view.setInt32(this.pos, value, false);
    this.pos += 4;
  }

  str(value: string): void {
    const bytes = this.enc.encode(value);
    this.short(bytes.length);
    this.ensure(bytes.length);
    this.buf.set(bytes, this.pos);
    this.pos += bytes.length;
  }

  named(tag: number, name: string): void {
    this.byte(tag);
    this.str(name);
  }

  listHeader(elemTag: number, count: number): void {
    this.byte(elemTag);
    this.int(count);
  }

  bytes(): Uint8Array {
    return this.buf.slice(0, this.pos);
  }
}

const CRC_TABLE = Uint32Array.from({ length: 256 }, (_, value) => {
  let c = value;
  for (let bit = 0; bit < 8; bit += 1) c = (c & 1) === 0 ? c >>> 1 : (c >>> 1) ^ 0xedb88320;
  return c >>> 0;
});

const crc32 = (bytes: Uint8Array): number => {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i += 1) c = (c >>> 8) ^ CRC_TABLE[(c ^ bytes[i]!) & 0xff]!;
  return (c ^ 0xffffffff) >>> 0;
};

const wrapGzipStored = (raw: Uint8Array): Uint8Array => {
  const blockCount = Math.max(1, Math.ceil(raw.length / 65535));
  const out = new Uint8Array(10 + blockCount * 5 + raw.length + 8);
  const view = new DataView(out.buffer);
  out.set([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x03], 0);
  let cursor = 10;
  let offset = 0;
  for (let b = 0; b < blockCount; b += 1) {
    const len = Math.min(65535, raw.length - offset);
    out[cursor++] = b === blockCount - 1 ? 0x01 : 0x00;
    view.setUint16(cursor, len, true);
    view.setUint16(cursor + 2, ~len & 0xffff, true);
    cursor += 4;
    out.set(raw.subarray(offset, offset + len), cursor);
    cursor += len;
    offset += len;
  }
  view.setUint32(cursor, crc32(raw), true);
  view.setUint32(cursor + 4, raw.length >>> 0, true);
  return out;
};

const writePalette = (w: NbtWriter, states: readonly string[]): void => {
  w.named(TAG_LIST, 'palette');
  w.listHeader(TAG_COMPOUND, states.length);
  for (const state of states) {
    const parsed = parseBlockState(state);
    w.named(TAG_STRING, 'Name');
    w.str(parsed.name);
    const propKeys = Object.keys(parsed.properties).sort();
    if (propKeys.length > 0) {
      w.named(TAG_COMPOUND, 'Properties');
      for (const k of propKeys) {
        w.named(TAG_STRING, k);
        w.str(parsed.properties[k]!);
      }
      w.byte(TAG_END);
    }
    w.byte(TAG_END);
  }
};

export const encodeStructureNbt = (grid: StructureGrid): Uint8Array => {
  const [wDim, hDim, dDim] = grid.size;
  const entries: {
    readonly x: number;
    readonly y: number;
    readonly z: number;
    readonly state: number;
  }[] = [];
  for (let y = 0; y < hDim; y += 1) {
    for (let z = 0; z < dDim; z += 1) {
      for (let x = 0; x < wDim; x += 1) {
        const state = grid.voxels[(y * dDim + z) * wDim + x]!;
        if (state >= 0) entries.push({ x, y, z, state });
      }
    }
  }
  const w = new NbtWriter();
  w.named(TAG_COMPOUND, '');
  w.named(TAG_INT, 'DataVersion');
  w.int(grid.dataVersion);
  w.named(TAG_LIST, 'size');
  w.listHeader(TAG_INT, 3);
  w.int(wDim);
  w.int(hDim);
  w.int(dDim);
  writePalette(w, grid.states);
  w.named(TAG_LIST, 'blocks');
  w.listHeader(TAG_COMPOUND, entries.length);
  for (const b of entries) {
    w.named(TAG_LIST, 'pos');
    w.listHeader(TAG_INT, 3);
    w.int(b.x);
    w.int(b.y);
    w.int(b.z);
    w.named(TAG_INT, 'state');
    w.int(b.state);
    w.byte(TAG_END);
  }
  w.named(TAG_LIST, 'entities');
  w.listHeader(TAG_END, 0);
  w.byte(TAG_END);
  return wrapGzipStored(w.bytes());
};

const gunzipStored = (gz: Uint8Array): Uint8Array => {
  if (gz[0] !== 0x1f || gz[1] !== 0x8b || gz[2] !== 0x08) throw new Error('Invalid GZip header');
  let offset = 10;
  const chunks: Uint8Array[] = [];
  const view = new DataView(gz.buffer, gz.byteOffset, gz.byteLength);
  while (offset < gz.length - 8) {
    const bfinal = gz[offset]!;
    const len = view.getUint16(offset + 1, true);
    offset += 5;
    chunks.push(gz.subarray(offset, offset + len));
    offset += len;
    if ((bfinal & 1) === 1) break;
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const out = new Uint8Array(total);
  let cursor = 0;
  for (const c of chunks) {
    out.set(c, cursor);
    cursor += c.length;
  }
  return out;
};

class NbtReader {
  private view: DataView;
  private dec = new TextDecoder();
  pos = 0;

  constructor(private readonly buf: Uint8Array) {
    this.view = new DataView(buf.buffer, buf.byteOffset, buf.byteLength);
  }

  u8(): number {
    return this.buf[this.pos++]!;
  }

  i32(): number {
    const v = this.view.getInt32(this.pos, false);
    this.pos += 4;
    return v;
  }

  str(): string {
    const len = this.view.getUint16(this.pos, false);
    this.pos += 2;
    const text = this.dec.decode(this.buf.subarray(this.pos, this.pos + len));
    this.pos += len;
    return text;
  }

  payload(tag: number): unknown {
    if (tag === TAG_INT) return this.i32();
    if (tag === TAG_STRING) return this.str();
    if (tag === TAG_LIST) {
      const elemTag = this.u8();
      const len = this.i32();
      return Array.from({ length: len }, () => this.payload(elemTag));
    }
    if (tag === TAG_COMPOUND) {
      const obj: Record<string, unknown> = {};
      while (true) {
        const next = this.u8();
        if (next === TAG_END) return obj;
        obj[this.str()] = this.payload(next);
      }
    }
    throw new Error(`Unsupported NBT tag ${tag}`);
  }
}

export const decodeStructureNbt = (bytes: Uint8Array): DecodedStructureNbt => {
  const raw = gunzipStored(bytes);
  const r = new NbtReader(raw);
  const rootTag = r.u8();
  r.str();
  const root = r.payload(rootTag) as {
    DataVersion: number;
    size: [number, number, number];
    palette: { Name: string; Properties?: Record<string, string> }[];
    blocks: { pos: [number, number, number]; state: number }[];
  };
  return {
    dataVersion: root.DataVersion,
    size: root.size,
    palette: root.palette,
    blocks: root.blocks,
  };
};
