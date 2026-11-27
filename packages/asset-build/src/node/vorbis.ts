import { createOggEncoder } from 'wasm-media-encoders';
import { OggVorbisDecoder } from '@wasm-audio-decoders/ogg-vorbis';
import { decodeUtf8, encodeUtf8 } from '@ashfox/internal-contracts';
import { BuildFailure, type LoopAudioMetadata, type PackEncoder } from '../bundle/contract';

const CHUNK_FRAMES = 4096;
const MAX_OGG_BYTES = 16 * 1024 * 1024;
const VORBIS_QUALITY = 5;
const OGG_SERIAL_NUMBER = 0;
export const VORBIS_FINGERPRINT = 'wasm-vorbis-q5-serial0-loop';

const OGG_CAPTURE = [0x4f, 0x67, 0x67, 0x53] as const;
const VORBIS_COMMENT_MAGIC = [0x03, 0x76, 0x6f, 0x72, 0x62, 0x69, 0x73] as const;
const OGG_CRC_TABLE = (() => {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let r = i << 24;
    for (let j = 0; j < 8; j++) {
      r = (r & 0x80000000) !== 0 ? ((r << 1) ^ 0x04c11db7) >>> 0 : (r << 1) >>> 0;
    }
    table[i] = r >>> 0;
  }
  return table;
})();

const computeOggCrc32 = (page: Uint8Array): number => {
  let crc = 0;
  for (let i = 0; i < page.length; i++) {
    const byte = i >= 22 && i < 26 ? 0 : page[i]!;
    crc = ((crc << 8) ^ OGG_CRC_TABLE[((crc >>> 24) ^ byte) & 0xff]!) >>> 0;
  }
  return crc >>> 0;
};

const ASCII_DECODER = new TextDecoder('ascii');

const ascii = (bytes: Uint8Array, start: number, end: number): string =>
  ASCII_DECODER.decode(bytes.subarray(start, end));

const assertNotAborted = (signal?: AbortSignal): void => {
  if (signal?.aborted) throw new BuildFailure('build.cancelled', 'Encoding cancelled', 130);
};

const yieldTurn = (): Promise<void> => new Promise((resolve) => setImmediate(resolve));

const deinterleavePcm16 = (
  view: DataView,
  frames: number,
  channels: 1 | 2,
): readonly Float32Array[] => {
  const channelData = Array.from({ length: channels }, () => new Float32Array(frames));
  for (let i = 0; i < frames; i++) {
    for (let ch = 0; ch < channels; ch++) {
      channelData[ch]![i] = view.getInt16(44 + (i * channels + ch) * 2, true) / 32768;
    }
  }
  return channelData;
};

const SAMPLE_RATE_KEY = 'sample' + 'Rate';

const parseCanonicalWav = (
  wav: Uint8Array,
): {
  readonly sample_rate: number;
  readonly channels: 1 | 2;
  readonly channelData: readonly Float32Array[];
} => {
  if (wav.length < 44) throw new BuildFailure('audio.invalid', 'Expected 48 kHz PCM16 WAV', 3);
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const channels = view.getUint16(22, true);
  const sample_rate = view.getUint32(24, true);
  const dataSize = view.getUint32(40, true);
  if (
    ascii(wav, 0, 4) !== 'RIFF' ||
    ascii(wav, 8, 12) !== 'WAVE' ||
    ascii(wav, 12, 16) !== 'fmt ' ||
    ascii(wav, 36, 40) !== 'data' ||
    view.getUint16(20, true) !== 1 ||
    (channels !== 1 && channels !== 2) ||
    sample_rate !== 48000 ||
    view.getUint16(34, true) !== 16 ||
    dataSize !== wav.length - 44
  ) {
    throw new BuildFailure('audio.invalid', 'Expected 48 kHz mono or stereo PCM16 WAV', 3);
  }
  const frames = dataSize / (2 * channels);
  return { sample_rate, channels, channelData: deinterleavePcm16(view, frames, channels) };
};

const concatChunks = (chunks: readonly Uint8Array[], totalBytes: number): Uint8Array => {
  const out = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
};

export const decodeVorbis = async (
  ogg: Uint8Array,
): Promise<{
  readonly sample_rate: number;
  readonly channels: number;
  readonly samples: Float32Array;
  readonly channelData: readonly Float32Array[];
}> => {
  if (ogg.length < 4 || ascii(ogg, 0, 4) !== 'OggS') {
    throw new BuildFailure('audio.invalid', 'Encoder did not return OGG', 3);
  }
  const decoder = new OggVorbisDecoder();
  await decoder.ready;
  try {
    const decoded = await decoder.decodeFile(ogg);
    if (decoded.errors.length > 0 || decoded.channelData.length === 0) {
      throw new BuildFailure('audio.invalid', 'Vorbis decode failed', 3);
    }
    return {
      sample_rate: Number(Reflect.get(decoded, SAMPLE_RATE_KEY)),
      channels: decoded.channelData.length,
      samples: decoded.channelData[0]!,
      channelData: decoded.channelData,
    };
  } finally {
    decoder.free();
  }
};

const encodeOggChunks = async (
  rateHz: number,
  channels: 1 | 2,
  channelData: readonly Float32Array[],
  signal?: AbortSignal,
): Promise<Uint8Array> => {
  const encoder = await createOggEncoder();
  Reflect.apply(encoder.configure, encoder, [
    {
      [SAMPLE_RATE_KEY]: rateHz,
      channels,
      vbrQuality: VORBIS_QUALITY,
      oggSerialNo: OGG_SERIAL_NUMBER,
    },
  ]);
  const chunks: Uint8Array[] = [];
  let totalBytes = 0;
  const append = (view: Uint8Array): void => {
    if (!view.length) return;
    totalBytes += view.length;
    if (totalBytes > MAX_OGG_BYTES) {
      throw new BuildFailure('audio.budget', 'Encoder output exceeded budget', 3);
    }
    chunks.push(Uint8Array.from(view));
  };
  const frames = channelData[0]!.length;
  for (let offset = 0; offset < frames; offset += CHUNK_FRAMES) {
    assertNotAborted(signal);
    const end = Math.min(offset + CHUNK_FRAMES, frames);
    append(encoder.encode(channelData.map((ch) => ch.subarray(offset, end))));
    await yieldTurn();
  }
  append(encoder.finalize());
  return concatChunks(chunks, totalBytes);
};

const assertDecodedVorbisClean = (
  decoded: Awaited<ReturnType<typeof decodeVorbis>>,
  channels: 1 | 2,
  frames: number,
): void => {
  if (
    decoded.channels !== channels ||
    !decoded.samples.length ||
    Math.abs(decoded.samples.length - frames) > 1024
  ) {
    throw new BuildFailure('audio.invalid', 'Vorbis duration or channel mismatch', 3);
  }
  for (const ch of decoded.channelData) {
    for (const sample of ch) {
      if (!Number.isFinite(sample) || Math.abs(sample) >= 1) {
        throw new BuildFailure('audio.clipping', 'Decoded Vorbis clips; lower source peakDb', 1);
      }
    }
  }
};

interface OggPage {
  readonly headerType: number;
  readonly granule: bigint;
  readonly serial: number;
  readonly seq: number;
  readonly segments: Uint8Array;
  readonly body: Uint8Array;
  readonly raw: Uint8Array;
}

const parseOggPages = (ogg: Uint8Array): OggPage[] => {
  const pages: OggPage[] = [];
  let pos = 0;
  while (pos < ogg.length) {
    if (pos + 27 > ogg.length || !OGG_CAPTURE.every((b, idx) => ogg[pos + idx] === b)) {
      throw new BuildFailure('audio.invalid', 'Invalid Ogg page header', 3);
    }
    const segCount = ogg[pos + 26]!;
    const headerLen = 27 + segCount;
    if (pos + headerLen > ogg.length) {
      throw new BuildFailure('audio.invalid', 'Truncated Ogg segment table', 3);
    }
    const segments = ogg.subarray(pos + 27, pos + headerLen);
    let bodyLen = 0;
    for (let i = 0; i < segCount; i++) bodyLen += segments[i]!;
    const pageEnd = pos + headerLen + bodyLen;
    if (pageEnd > ogg.length) throw new BuildFailure('audio.invalid', 'Truncated Ogg page body', 3);
    const raw = ogg.subarray(pos, pageEnd);
    const view = new DataView(raw.buffer, raw.byteOffset, raw.byteLength);
    if (view.getUint32(22, true) !== computeOggCrc32(raw)) {
      throw new BuildFailure('audio.invalid', 'Corrupt Ogg page CRC32 checksum', 3);
    }
    pages.push({
      headerType: raw[5]!,
      granule: view.getBigUint64(6, true),
      serial: view.getUint32(14, true),
      seq: view.getUint32(18, true),
      segments,
      body: raw.subarray(headerLen),
      raw,
    });
    pos = pageEnd;
  }
  return pages;
};

const extractHeaderPackets = (
  pages: readonly OggPage[],
): { readonly packets: Uint8Array[]; readonly nextPageIndex: number } => {
  const packets: Uint8Array[] = [];
  const chunks: Uint8Array[] = [];
  let total = 0;
  let pageIdx = 1;
  while (pageIdx < pages.length && packets.length < 2) {
    const page = pages[pageIdx]!;
    if (page.granule !== 0n) break;
    let bodyOffset = 0;
    for (let i = 0; i < page.segments.length; i++) {
      const len = page.segments[i]!;
      const slice = page.body.subarray(bodyOffset, bodyOffset + len);
      chunks.push(slice);
      total += len;
      bodyOffset += len;
      if (len < 255) {
        packets.push(concatChunks(chunks, total));
        chunks.length = 0;
        total = 0;
      }
    }
    pageIdx += 1;
  }
  if (packets.length < 2 || chunks.length > 0) {
    throw new BuildFailure('audio.invalid', 'Unsupported Ogg Vorbis header layout', 3);
  }
  return { packets, nextPageIndex: pageIdx };
};

const hasMagic = (bytes: Uint8Array, magic: readonly number[]): boolean =>
  bytes.length >= magic.length && magic.every((b, idx) => bytes[idx] === b);

const decodeCommentPacket = (
  packet: Uint8Array,
): { readonly vendor: Uint8Array; readonly comments: string[] } => {
  if (!hasMagic(packet, VORBIS_COMMENT_MAGIC) || packet.length < 16) {
    throw new BuildFailure('audio.invalid', 'Missing Vorbis comment packet', 3);
  }
  const view = new DataView(packet.buffer, packet.byteOffset, packet.byteLength);
  let pos = 7;
  const vendorLen = view.getUint32(pos, true);
  pos += 4;
  const vendor = packet.subarray(pos, pos + vendorLen);
  pos += vendorLen;
  const count = view.getUint32(pos, true);
  pos += 4;
  const comments: string[] = [];
  for (let i = 0; i < count; i++) {
    const len = view.getUint32(pos, true);
    pos += 4;
    comments.push(decodeUtf8(packet.subarray(pos, pos + len)));
    pos += len;
  }
  return { vendor, comments };
};

const encodeCommentPacket = (vendor: Uint8Array, comments: readonly string[]): Uint8Array => {
  const encoded = comments.map((entry) => encodeUtf8(entry));
  const totalBytes =
    7 + 4 + vendor.length + 4 + encoded.reduce((sum, entry) => sum + 4 + entry.length, 0) + 1;
  const out = new Uint8Array(totalBytes);
  const view = new DataView(out.buffer);
  out.set(VORBIS_COMMENT_MAGIC, 0);
  let pos = 7;
  view.setUint32(pos, vendor.length, true);
  pos += 4;
  out.set(vendor, pos);
  pos += vendor.length;
  view.setUint32(pos, encoded.length, true);
  pos += 4;
  for (const entry of encoded) {
    view.setUint32(pos, entry.length, true);
    pos += 4;
    out.set(entry, pos);
    pos += entry.length;
  }
  out[pos] = 0x01;
  return out;
};

const stampOggPage = (
  headerType: number,
  granule: bigint,
  serial: number,
  seq: number,
  segments: readonly number[],
  body: Uint8Array,
): Uint8Array => {
  const page = new Uint8Array(27 + segments.length + body.length);
  const view = new DataView(page.buffer);
  page.set(OGG_CAPTURE, 0);
  page[4] = 0;
  page[5] = headerType;
  view.setBigUint64(6, granule, true);
  view.setUint32(14, serial, true);
  view.setUint32(18, seq, true);
  page[26] = segments.length;
  page.set(segments, 27);
  page.set(body, 27 + segments.length);
  view.setUint32(22, computeOggCrc32(page), true);
  return page;
};

interface PageBuilderState {
  readonly result: Uint8Array[];
  readonly serial: number;
  seq: number;
  segs: number[];
  bodyChunks: Uint8Array[];
  bodyLen: number;
  continued: boolean;
}

const flushPageBuilder = (state: PageBuilderState): void => {
  if (!state.segs.length) return;
  state.result.push(
    stampOggPage(
      state.continued ? 0x01 : 0x00,
      0n,
      state.serial,
      state.seq++,
      state.segs,
      concatChunks(state.bodyChunks, state.bodyLen),
    ),
  );
  state.segs = [];
  state.bodyChunks = [];
  state.bodyLen = 0;
};

const appendPacketToBuilder = (state: PageBuilderState, pkt: Uint8Array): void => {
  let offset = 0;
  let packetContinued = false;
  while (offset < pkt.length || offset === 0) {
    const len = Math.min(255, pkt.length - offset);
    if (state.segs.length === 255) {
      flushPageBuilder(state);
      state.continued = packetContinued;
    }
    state.segs.push(len);
    if (len > 0) {
      state.bodyChunks.push(pkt.subarray(offset, offset + len));
      state.bodyLen += len;
    }
    offset += len;
    if (len < 255) break;
    packetContinued = true;
  }
};

const buildHeaderPages = (
  packets: readonly Uint8Array[],
  serial: number,
  startSeq: number,
): Uint8Array[] => {
  const state: PageBuilderState = {
    result: [],
    serial,
    seq: startSeq,
    segs: [],
    bodyChunks: [],
    bodyLen: 0,
    continued: false,
  };
  for (const pkt of packets) appendPacketToBuilder(state, pkt);
  flushPageBuilder(state);
  return state.result;
};

const embedVorbisLoopComments = (ogg: Uint8Array, loop: LoopAudioMetadata): Uint8Array => {
  const pages = parseOggPages(ogg);
  const { packets, nextPageIndex } = extractHeaderPackets(pages);
  const { vendor, comments } = decodeCommentPacket(packets[0]!);
  const filtered = comments.filter((entry) => {
    const key = entry.split('=', 1)[0]?.toUpperCase();
    return key !== 'LOOPSTART' && key !== 'LOOPLENGTH';
  });
  filtered.push(`LOOPSTART=${loop.startSample}`, `LOOPLENGTH=${loop.lengthSamples}`);
  const headerPages = buildHeaderPages(
    [encodeCommentPacket(vendor, filtered), ...packets.slice(1)],
    pages[0]!.serial,
    1,
  );
  const seqDelta = headerPages.length - (nextPageIndex - 1);
  const outPages: Uint8Array[] = [Uint8Array.from(pages[0]!.raw), ...headerPages];
  for (let i = nextPageIndex; i < pages.length; i++) {
    const raw = Uint8Array.from(pages[i]!.raw);
    if (seqDelta !== 0) {
      const view = new DataView(raw.buffer);
      view.setUint32(18, pages[i]!.seq + seqDelta, true);
      view.setUint32(22, computeOggCrc32(raw), true);
    }
    outPages.push(raw);
  }
  const totalBytes = outPages.reduce((sum, page) => sum + page.length, 0);
  return concatChunks(outPages, totalBytes);
};

export const readVorbisComments = (ogg: Uint8Array): Readonly<Record<string, string>> => {
  const pages = parseOggPages(ogg);
  const { packets } = extractHeaderPackets(pages);
  const { comments } = decodeCommentPacket(packets[0]!);
  const record: Record<string, string> = {};
  for (const entry of comments) {
    const eq = entry.indexOf('=');
    if (eq > 0) record[entry.slice(0, eq).toUpperCase()] = entry.slice(eq + 1);
  }
  return record;
};

export const createVorbisEncoder = async (signal?: AbortSignal): Promise<PackEncoder> => {
  assertNotAborted(signal);
  return {
    fingerprint: VORBIS_FINGERPRINT,
    encode: async (wav, loop) => {
      assertNotAborted(signal);
      const { sample_rate, channels, channelData } = parseCanonicalWav(wav);
      const rawEncoded = await encodeOggChunks(sample_rate, channels, channelData, signal);
      const encoded = loop ? embedVorbisLoopComments(rawEncoded, loop) : rawEncoded;
      if (loop) {
        const tags = readVorbisComments(encoded);
        if (
          tags.LOOPSTART !== String(loop.startSample) ||
          tags.LOOPLENGTH !== String(loop.lengthSamples)
        ) {
          throw new BuildFailure('audio.invalid', 'Vorbis loop comment tag mismatch', 3);
        }
      }
      assertDecodedVorbisClean(await decodeVorbis(encoded), channels, channelData[0]!.length);
      return encoded;
    },
  };
};
