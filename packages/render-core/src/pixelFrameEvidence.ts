import {
  hasExactContractKeys,
  isClosedContractRecord
} from '@ashfox/internal-contracts';

export const PIXEL_FRAME_EVIDENCE_ALGORITHM =
  'rgba8-sha256' as const;

export interface PixelFrameEvidence {
  algorithm: typeof PIXEL_FRAME_EVIDENCE_ALGORITHM;
  width: number;
  height: number;
  rgbaByteLength: number;
  pixelHash: string;
}

const PIXEL_FRAME_EVIDENCE_KEYS = new Set([
  'algorithm',
  'width',
  'height',
  'rgbaByteLength',
  'pixelHash'
]);

const SHA256_FINGERPRINT = /^sha256:[0-9a-f]{64}$/;

const isPositiveSafeInteger = (value: unknown): value is number =>
  Number.isSafeInteger(value) && (value as number) > 0;

export const isPixelFrameEvidence = (
  value: unknown
): value is PixelFrameEvidence =>
  isClosedContractRecord(value) &&
  hasExactContractKeys(value, PIXEL_FRAME_EVIDENCE_KEYS) &&
  value.algorithm === PIXEL_FRAME_EVIDENCE_ALGORITHM &&
  isPositiveSafeInteger(value.width) &&
  isPositiveSafeInteger(value.height) &&
  isPositiveSafeInteger(value.rgbaByteLength) &&
  value.rgbaByteLength === value.width * value.height * 4 &&
  typeof value.pixelHash === 'string' &&
  SHA256_FINGERPRINT.test(value.pixelHash);

const dimensionBoundDigestPayload = (
  width: number,
  height: number,
  rgbaDigest: ArrayBuffer
): Uint8Array<ArrayBuffer> => {
  const payload = new Uint8Array(8 + rgbaDigest.byteLength);
  const dimensions = new DataView(payload.buffer, 0, 8);
  dimensions.setUint32(0, width, false);
  dimensions.setUint32(4, height, false);
  payload.set(new Uint8Array(rgbaDigest), 8);
  return payload;
};

export const pixelFrameEvidenceFromRgba = async (
  width: number,
  height: number,
  rgba: Uint8Array<ArrayBuffer>
): Promise<PixelFrameEvidence> => {
  if (
    !isPositiveSafeInteger(width) ||
    !isPositiveSafeInteger(height) ||
    width > 0xffffffff ||
    height > 0xffffffff ||
    rgba.byteLength !== width * height * 4
  ) {
    throw new RangeError(
      'RGBA frame evidence requires positive dimensions and exactly four bytes per pixel.'
    );
  }
  const rgbaDigest = await crypto.subtle.digest('SHA-256', rgba);
  const digest = await crypto.subtle.digest(
    'SHA-256',
    dimensionBoundDigestPayload(width, height, rgbaDigest)
  );
  const pixelHash = [...new Uint8Array(digest)]
    .map((byte) => byte.toString(16).padStart(2, '0'))
    .join('');
  return {
    algorithm: PIXEL_FRAME_EVIDENCE_ALGORITHM,
    width,
    height,
    rgbaByteLength: rgba.byteLength,
    pixelHash: `sha256:${pixelHash}`
  };
};
