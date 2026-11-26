import type { GlbPerformanceMetrics } from '@ashfox/engine-core';
import { readClosedRecord } from '../packs/game/read';
import { BuildFailure } from '../bundle/contract';

const failPerf = (message: string): never => {
  throw new BuildFailure('output.integrity', message, 3);
};

const PERF_KEYS = [
  'glbBytes',
  'drawCalls',
  'triangles',
  'lod1Triangles',
  'lod2Triangles',
  'lod2DrawCalls',
  'hasLod1',
  'hasLod2',
  'skinned',
  'textureCount',
  'estimatedVramBytes',
  'extensionsUsed',
] as const;

const reqNonNegInt = (v: unknown): number => {
  if (typeof v !== 'number' || !Number.isSafeInteger(v) || v < 0) {
    failPerf('Invalid performance metadata');
  }
  return v as number;
};

const reqBool = (v: unknown): boolean => {
  if (typeof v !== 'boolean') failPerf('Invalid performance metadata');
  return v as boolean;
};

export const verifyPerformanceMetrics = (value: unknown): GlbPerformanceMetrics => {
  const r = readClosedRecord(value, PERF_KEYS, failPerf);
  if (!Array.isArray(r.extensionsUsed) || r.extensionsUsed.some((e) => typeof e !== 'string')) {
    failPerf('Invalid performance metadata');
  }
  return {
    glbBytes: reqNonNegInt(r.glbBytes),
    drawCalls: reqNonNegInt(r.drawCalls),
    triangles: reqNonNegInt(r.triangles),
    lod1Triangles: reqNonNegInt(r.lod1Triangles),
    lod2Triangles: reqNonNegInt(r.lod2Triangles),
    lod2DrawCalls: reqNonNegInt(r.lod2DrawCalls),
    hasLod1: reqBool(r.hasLod1),
    hasLod2: reqBool(r.hasLod2),
    skinned: reqBool(r.skinned),
    textureCount: reqNonNegInt(r.textureCount),
    estimatedVramBytes: reqNonNegInt(r.estimatedVramBytes),
    extensionsUsed: r.extensionsUsed as string[],
  };
};
