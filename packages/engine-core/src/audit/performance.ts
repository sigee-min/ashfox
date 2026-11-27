import { decodeUtf8 } from '@ashfox/internal-contracts';

export type GlbPerformanceKind = 'creature' | 'prop' | 'structure' | 'compound';

export interface GlbPerformanceMetrics {
  readonly glbBytes: number;
  readonly drawCalls: number;
  readonly triangles: number;
  readonly lod1Triangles: number;
  readonly lod2Triangles: number;
  readonly lod2DrawCalls: number;
  readonly hasLod1: boolean;
  readonly hasLod2: boolean;
  readonly skinned: boolean;
  readonly textureCount: number;
  readonly estimatedVramBytes: number;
  readonly extensionsUsed: readonly string[];
}

export interface GlbPerformanceBudget {
  readonly kind: GlbPerformanceKind;
  readonly maxDrawCalls: number;
  readonly maxTriangles: number;
  readonly maxGlbBytes: number;
  readonly maxLod1Ratio: number;
  readonly requiredLod2DrawCalls: 1;
}

export interface GlbPerformanceViolation {
  readonly metric: 'drawCalls' | 'triangles' | 'glbBytes' | 'lod1Ratio' | 'lod2DrawCalls';
  readonly actual: number;
  readonly limit: number;
  readonly message: string;
}

export interface GlbPerformanceReport {
  readonly kind: GlbPerformanceKind;
  readonly passed: boolean;
  readonly metrics: GlbPerformanceMetrics;
  readonly budget: GlbPerformanceBudget;
  readonly violations: readonly GlbPerformanceViolation[];
}

export interface GlbPerformanceOptions {
  readonly externalImages?:
    ReadonlyMap<string, Uint8Array> | ((uri: string) => Uint8Array | undefined);
}

interface ParsedGltf {
  readonly extensionsUsed?: readonly string[];
  readonly scene?: number;
  readonly scenes?: readonly { readonly nodes?: readonly number[] }[];
  readonly nodes?: readonly {
    readonly name?: string;
    readonly mesh?: number;
    readonly skin?: number;
    readonly children?: readonly number[];
    readonly extensions?: {
      readonly MSFT_lod?: { readonly ids?: readonly number[] };
      readonly EXT_mesh_gpu_instancing?: { readonly attributes?: Readonly<Record<string, number>> };
    };
  }[];
  readonly meshes?: readonly {
    readonly primitives?: readonly {
      readonly attributes?: Readonly<Record<string, number>>;
      readonly indices?: number;
      readonly mode?: number;
    }[];
  }[];
  readonly accessors?: readonly { readonly bufferView?: number; readonly count?: number }[];
  readonly bufferViews?: readonly {
    readonly buffer?: number;
    readonly byteOffset?: number;
    readonly byteLength: number;
    readonly target?: number;
  }[];
  readonly images?: readonly { readonly bufferView?: number; readonly uri?: string }[];
  readonly textures?: readonly unknown[];
}

type ParsedNode = NonNullable<ParsedGltf['nodes']>[number];
type ParsedAccessor = NonNullable<ParsedGltf['accessors']>[number];
type ParsedPrimitive = NonNullable<NonNullable<ParsedGltf['meshes']>[number]['primitives']>[number];

const parseGlbContainer = (bytes: Uint8Array) => {
  if (bytes.byteLength < 20) throw new Error('Invalid GLB: file shorter than 20-byte header.');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2) {
    throw new Error('Invalid GLB: bad magic or version.');
  }
  const totalLength = view.getUint32(8, true);
  if (totalLength > bytes.byteLength) throw new Error('Invalid GLB: truncated container.');
  let offset = 12;
  let gltf: ParsedGltf | undefined;
  let binChunk: Uint8Array | undefined;
  while (offset + 8 <= totalLength) {
    const chunkLen = view.getUint32(offset, true);
    const chunkType = view.getUint32(offset + 4, true);
    const end = offset + 8 + chunkLen;
    if (end > totalLength) throw new Error('Invalid GLB: chunk exceeds container.');
    if (chunkType === 0x4e4f534a && !gltf) {
      gltf = JSON.parse(decodeUtf8(bytes.subarray(offset + 8, end))) as ParsedGltf;
    } else if (chunkType === 0x004e4942 && !binChunk) {
      binChunk = bytes.subarray(offset + 8, end);
    }
    offset = end;
  }
  if (!gltf) throw new Error('Invalid GLB: missing JSON chunk.');
  return { gltf, binChunk };
};

const parsePngDimensions = (bytes: Uint8Array): { width: number; height: number } | null => {
  if (bytes.byteLength < 24) return null;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, false) !== 0x89504e47 || view.getUint32(12, false) !== 0x49484452) {
    return null;
  }
  return { width: view.getUint32(16, false), height: view.getUint32(20, false) };
};

const resolveImageBytes = (
  image: { readonly bufferView?: number; readonly uri?: string },
  views: NonNullable<ParsedGltf['bufferViews']>,
  binChunk: Uint8Array | undefined,
  options?: GlbPerformanceOptions,
): Uint8Array | undefined => {
  if (image.bufferView !== undefined && binChunk) {
    const bv = views[image.bufferView];
    if (!bv || (bv.buffer !== undefined && bv.buffer !== 0)) return undefined;
    return binChunk.subarray(bv.byteOffset ?? 0, (bv.byteOffset ?? 0) + bv.byteLength);
  }
  if (!image.uri || !options?.externalImages) return undefined;
  return typeof options.externalImages === 'function'
    ? options.externalImages(image.uri)
    : options.externalImages.get(image.uri);
};

const collectAccessorIds = (gltf: ParsedGltf): number[] => {
  const ids: number[] = [];
  for (const mesh of gltf.meshes ?? []) {
    for (const prim of mesh.primitives ?? []) {
      if (prim.indices !== undefined) ids.push(prim.indices);
      ids.push(...Object.values(prim.attributes ?? {}));
    }
  }
  for (const node of gltf.nodes ?? []) {
    const attrs = node.extensions?.EXT_mesh_gpu_instancing?.attributes;
    if (attrs) ids.push(...Object.values(attrs));
  }
  return ids;
};

const collectGeometryViews = (gltf: ParsedGltf): Set<number> => {
  const geoViews = new Set<number>();
  const accessors = gltf.accessors ?? [];
  (gltf.bufferViews ?? []).forEach((bv, idx) => {
    if (bv.target === 34962 || bv.target === 34963) geoViews.add(idx);
  });
  for (const idx of collectAccessorIds(gltf)) {
    const bv = accessors[idx]?.bufferView;
    if (bv !== undefined) geoViews.add(bv);
  }
  return geoViews;
};

const computeEstimatedVramBytes = (
  gltf: ParsedGltf,
  binChunk: Uint8Array | undefined,
  options?: GlbPerformanceOptions,
): number => {
  const views = gltf.bufferViews ?? [];
  let imageVram = 0;
  for (const image of gltf.images ?? []) {
    const imgBytes = resolveImageBytes(image, views, binChunk, options);
    const dims = imgBytes ? parsePngDimensions(imgBytes) : null;
    if (dims && dims.width > 0 && dims.height > 0) imageVram += dims.width * dims.height * 4 * 1.33;
  }
  let vboBytes = 0;
  for (const bvIdx of collectGeometryViews(gltf)) vboBytes += views[bvIdx]?.byteLength ?? 0;
  return Math.round(imageVram + vboBytes);
};

const primitiveTriangles = (
  prim: ParsedPrimitive,
  accessors: readonly ParsedAccessor[],
): number => {
  const mode = prim.mode ?? 4;
  const idxOrPos = prim.indices ?? prim.attributes?.POSITION;
  const count = idxOrPos !== undefined ? (accessors[idxOrPos]?.count ?? 0) : 0;
  if (mode === 4) return Math.floor(count / 3);
  return mode === 5 || mode === 6 ? Math.max(0, count - 2) : 0;
};

const nodeNameLodTier = (name: string | undefined): 0 | 1 | 2 | undefined => {
  if (!name) return undefined;
  if (/_lod1$/i.test(name)) return 1;
  if (/_lod2$/i.test(name)) return 2;
  return /_lod0$/i.test(name) ? 0 : undefined;
};

const assignNodeTiers = (nodes: readonly ParsedNode[]): Map<number, 0 | 1 | 2> => {
  const tiers = new Map<number, 0 | 1 | 2>();
  nodes.forEach((node, idx) => {
    const byName = nodeNameLodTier(node.name);
    if (byName !== undefined) tiers.set(idx, byName);
    const lodIds = node.extensions?.MSFT_lod?.ids;
    if (!lodIds) return;
    if (!tiers.has(idx)) tiers.set(idx, 0);
    lodIds.forEach((targetIdx, pos) => {
      if (!tiers.has(targetIdx)) tiers.set(targetIdx, pos === 0 ? 1 : 2);
    });
  });
  return tiers;
};

const nodeInstanceCount = (node: ParsedNode, accessors: readonly ParsedAccessor[]): number => {
  const attrs = node.extensions?.EXT_mesh_gpu_instancing?.attributes;
  if (!attrs) return 1;
  const firstIdx = attrs.TRANSLATION ?? Object.values(attrs)[0];
  return firstIdx !== undefined ? Math.max(1, accessors[firstIdx]?.count ?? 1) : 1;
};

interface LodCtx {
  readonly nodes: readonly ParsedNode[];
  readonly meshes: NonNullable<ParsedGltf['meshes']>;
  readonly accessors: readonly ParsedAccessor[];
  readonly explicitTiers: ReadonlyMap<number, 0 | 1 | 2>;
  readonly visited: Set<number>;
  readonly drawCalls: number[];
  readonly triangles: number[];
  readonly hasLod: boolean[];
  skinned: boolean;
}

const visitLodNode = (ctx: LodCtx, idx: number, inheritedTier: 0 | 1 | 2): void => {
  if (ctx.visited.has(idx)) return;
  const node = ctx.nodes[idx];
  if (!node) return;
  ctx.visited.add(idx);
  const tier = ctx.explicitTiers.get(idx) ?? inheritedTier;
  ctx.hasLod[tier] = true;
  if (tier === 0 && node.skin !== undefined) ctx.skinned = true;
  if (node.mesh !== undefined) {
    const prims = ctx.meshes[node.mesh]?.primitives ?? [];
    const instances = nodeInstanceCount(node, ctx.accessors);
    const tris = prims.reduce((sum, p) => sum + primitiveTriangles(p, ctx.accessors), 0);
    ctx.drawCalls[tier] += prims.length;
    ctx.triangles[tier] += tris * instances;
  }
  for (const child of node.children ?? []) visitLodNode(ctx, child, tier);
  for (const lodIdx of node.extensions?.MSFT_lod?.ids ?? []) visitLodNode(ctx, lodIdx, tier);
};

const collectLodStats = (gltf: ParsedGltf): LodCtx => {
  const nodes = gltf.nodes ?? [];
  const explicitTiers = assignNodeTiers(nodes);
  const ctx: LodCtx = {
    nodes,
    meshes: gltf.meshes ?? [],
    accessors: gltf.accessors ?? [],
    explicitTiers,
    visited: new Set(),
    drawCalls: [0, 0, 0],
    triangles: [0, 0, 0],
    hasLod: [false, false, false],
    skinned: false,
  };
  const roots = gltf.scenes?.[gltf.scene ?? 0]?.nodes ?? nodes.map((_, i) => i);
  for (const rootIdx of roots) visitLodNode(ctx, rootIdx, explicitTiers.get(rootIdx) ?? 0);
  nodes.forEach((_, i) => {
    if (!ctx.visited.has(i) && explicitTiers.has(i)) visitLodNode(ctx, i, explicitTiers.get(i)!);
  });
  return ctx;
};

/** Inspect a compiled GLB byte buffer and return draw calls, triangles, LODs, and VRAM. */
export const inspectGlbPerformance = (
  bytes: Uint8Array,
  options?: GlbPerformanceOptions,
): GlbPerformanceMetrics => {
  const { gltf, binChunk } = parseGlbContainer(bytes);
  const stats = collectLodStats(gltf);
  return {
    glbBytes: bytes.byteLength,
    drawCalls: stats.drawCalls[0]!,
    triangles: stats.triangles[0]!,
    lod1Triangles: stats.triangles[1]!,
    lod2Triangles: stats.triangles[2]!,
    lod2DrawCalls: stats.drawCalls[2]!,
    hasLod1: stats.hasLod[1]!,
    hasLod2: stats.hasLod[2]!,
    skinned: stats.skinned,
    textureCount: gltf.textures ? gltf.textures.length : (gltf.images?.length ?? 0),
    estimatedVramBytes: computeEstimatedVramBytes(gltf, binChunk, options),
    extensionsUsed: [...(gltf.extensionsUsed ?? [])],
  };
};

const BUDGET_SPECS: Readonly<Record<GlbPerformanceKind, Omit<GlbPerformanceBudget, 'kind'>>> = {
  creature: {
    maxDrawCalls: 4,
    maxTriangles: 1500,
    maxGlbBytes: 64 * 1024,
    maxLod1Ratio: 0.55,
    requiredLod2DrawCalls: 1,
  },
  prop: {
    maxDrawCalls: 4,
    maxTriangles: 1500,
    maxGlbBytes: 64 * 1024,
    maxLod1Ratio: 0.55,
    requiredLod2DrawCalls: 1,
  },
  structure: {
    maxDrawCalls: 18,
    maxTriangles: 18000,
    maxGlbBytes: 350 * 1024,
    maxLod1Ratio: 0.25,
    requiredLod2DrawCalls: 1,
  },
  compound: {
    maxDrawCalls: 28,
    maxTriangles: 45000,
    maxGlbBytes: 1.1 * 1024 * 1024,
    maxLod1Ratio: 0.25,
    requiredLod2DrawCalls: 1,
  },
};

const budgetForKind = (kind: GlbPerformanceKind, skinned: boolean): GlbPerformanceBudget => {
  const spec = BUDGET_SPECS[kind];
  const maxDrawCalls = (kind === 'creature' || kind === 'prop') && skinned ? 2 : spec.maxDrawCalls;
  return { kind, ...spec, maxDrawCalls };
};

const checkLodViolations = (
  m: GlbPerformanceMetrics,
  b: GlbPerformanceBudget,
  kind: GlbPerformanceKind,
): GlbPerformanceViolation[] => {
  const out: GlbPerformanceViolation[] = [];
  if (m.hasLod1) {
    const ratio = m.triangles > 0 ? m.lod1Triangles / m.triangles : m.lod1Triangles > 0 ? 1 : 0;
    if (ratio > b.maxLod1Ratio) {
      out.push({
        metric: 'lod1Ratio',
        actual: Math.round(ratio * 1000) / 1000,
        limit: b.maxLod1Ratio,
        message: `LOD1 ratio ${ratio.toFixed(3)} exceeds ${b.maxLod1Ratio} for ${kind}.`,
      });
    }
  }
  if (m.hasLod2 && m.lod2DrawCalls !== b.requiredLod2DrawCalls) {
    out.push({
      metric: 'lod2DrawCalls',
      actual: m.lod2DrawCalls,
      limit: b.requiredLod2DrawCalls,
      message: `LOD2 drawCalls ${m.lod2DrawCalls} must equal ${b.requiredLod2DrawCalls}.`,
    });
  }
  return out;
};

/** Evaluate a GLB byte buffer against Ashfox tiered runtime performance budgets. */
export const evaluateGlbPerformance = (
  bytes: Uint8Array,
  kind: GlbPerformanceKind,
  options?: GlbPerformanceOptions,
): GlbPerformanceReport => {
  const m = inspectGlbPerformance(bytes, options);
  const b = budgetForKind(kind, m.skinned);
  const checks: ReadonlyArray<readonly [GlbPerformanceViolation['metric'], number, number]> = [
    ['drawCalls', m.drawCalls, b.maxDrawCalls],
    ['triangles', m.triangles, b.maxTriangles],
    ['glbBytes', m.glbBytes, b.maxGlbBytes],
  ];
  const violations: GlbPerformanceViolation[] = checks
    .filter(([, actual, limit]) => actual > limit)
    .map(([metric, actual, limit]) => ({
      metric,
      actual,
      limit,
      message: `${metric} ${actual} exceeds ${limit} for ${kind}.`,
    }));
  violations.push(...checkLodViolations(m, b, kind));
  return { kind, passed: violations.length === 0, metrics: m, budget: b, violations };
};
