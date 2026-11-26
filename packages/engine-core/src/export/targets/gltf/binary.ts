import type { GltfAccessor, GltfBufferView } from './contract';
import {
  assertValidInterleavedInputs,
  computeVertexLayout,
  type VertexLayout,
} from './vertexLayout';

export interface GltfBinaryState {
  bufferViews: GltfBufferView[];
  accessors: GltfAccessor[];
  usesMeshQuantization: boolean;
}

export interface GltfVertexAccessors {
  position: number;
  normal: number;
  uv?: number;
  color?: number;
  joints?: number;
  weights?: number;
}

const align4 = (value: number): number => (value + 3) & ~3;
const normalizedByte = (value: number): number =>
  Math.round(Math.max(-1, Math.min(1, value)) * 127);
const normalizedShort = (value: number): number =>
  Math.round(Math.max(-1, Math.min(1, value)) * 32767);
const normalizedUnsignedShort = (value: number): number =>
  Math.round(Math.max(0, Math.min(1, value)) * 65535);

const writePositionComponent = (
  view: DataView,
  offset: number,
  value: number,
  quantized: boolean,
): void => {
  if (quantized) {
    view.setInt16(offset, normalizedShort(value), true);
  } else {
    view.setFloat32(offset, value, true);
  }
};

const writeNormalComponent = (
  view: DataView,
  offset: number,
  value: number,
  quantized: boolean,
): void => {
  if (quantized) {
    view.setInt8(offset, normalizedByte(value));
  } else {
    view.setFloat32(offset, value, true);
  }
};

const writeVertexUv = (
  view: DataView,
  base: number,
  vertex: number,
  uvs: readonly number[],
  layout: VertexLayout,
): void => {
  if (layout.uvOffset === undefined) return;
  const stride = layout.quantizedUv ? 2 : 4;
  for (let component = 0; component < 2; component += 1) {
    const uv = uvs[vertex * 2 + component]!;
    const offset = base + layout.uvOffset + component * stride;
    if (layout.quantizedUv) {
      view.setUint16(offset, normalizedUnsignedShort(uv), true);
    } else {
      view.setFloat32(offset, uv, true);
    }
  }
};

const writeVertexSkin = (
  view: DataView,
  base: number,
  jointIndex: number,
  layout: VertexLayout,
): void => {
  if (layout.jointOffset === undefined || layout.weightOffset === undefined) return;
  for (let component = 0; component < 4; component += 1) {
    const joint = component === 0 ? jointIndex : 0;
    if (layout.jointComponentType === 5123) {
      view.setUint16(base + layout.jointOffset + component * 2, joint, true);
    } else {
      view.setUint8(base + layout.jointOffset + component, joint);
    }
    view.setUint8(base + layout.weightOffset + component, component === 0 ? 255 : 0);
  }
};

const writeVertexColor = (
  view: DataView,
  base: number,
  vertex: number,
  colors: readonly number[],
  layout: VertexLayout,
): void => {
  if (layout.colorOffset === undefined) return;
  const count = layout.colorComponentCount;
  for (let component = 0; component < count; component += 1) {
    const channel = Math.round(Math.max(0, Math.min(1, colors[vertex * count + component]!)) * 255);
    view.setUint8(base + layout.colorOffset + component, channel);
  }
};

const encodeInterleavedVertices = (
  count: number,
  layout: VertexLayout,
  positions: readonly number[],
  normals: readonly number[],
  uvs: readonly number[] | undefined,
  joints: readonly number[] | undefined,
  colors: readonly number[] | undefined,
): Uint8Array => {
  const bytes = new Uint8Array(count * layout.stride);
  const view = new DataView(bytes.buffer);
  const posSize = layout.quantizedPosition ? 2 : 4;
  const normSize = layout.quantizedNormal ? 1 : 4;
  for (let vertex = 0; vertex < count; vertex += 1) {
    const base = vertex * layout.stride;
    for (let component = 0; component < 3; component += 1) {
      writePositionComponent(
        view,
        base + component * posSize,
        positions[vertex * 3 + component]!,
        layout.quantizedPosition,
      );
      writeNormalComponent(
        view,
        base + layout.normalOffset + component * normSize,
        normals[vertex * 3 + component]!,
        layout.quantizedNormal,
      );
    }
    if (uvs) writeVertexUv(view, base, vertex, uvs, layout);
    if (colors) writeVertexColor(view, base, vertex, colors, layout);
    if (joints) writeVertexSkin(view, base, joints[vertex]!, layout);
  }
  return bytes;
};

export class GltfBinaryWriter {
  constructor(private readonly quantize = true) {}
  private readonly chunks: { readonly offset: number; readonly bytes: Uint8Array }[] = [];
  private totalLength = 0;
  readonly state: GltfBinaryState = {
    bufferViews: [],
    accessors: [],
    usesMeshQuantization: false,
  };

  get isQuantized(): boolean {
    return this.quantize;
  }

  get byteLength(): number {
    return this.totalLength;
  }

  addFloatAccessor(
    values: readonly number[],
    componentCount: 1 | 2 | 3 | 4,
    includeBounds: boolean,
    target?: 34962,
  ): number {
    const bytes = new Uint8Array(values.length * 4);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < values.length; index += 1) {
      view.setFloat32(index * 4, values[index]!, true);
    }
    const bufferView = this.append(bytes, target);
    const count = values.length / componentCount;
    const accessor: GltfAccessor = {
      bufferView,
      componentType: 5126,
      count,
      type:
        componentCount === 1
          ? 'SCALAR'
          : componentCount === 2
            ? 'VEC2'
            : componentCount === 3
              ? 'VEC3'
              : 'VEC4',
      ...(includeBounds ? this.bounds(values, componentCount) : {}),
    };
    return this.addAccessor(accessor);
  }

  addNormalizedShortAccessor(values: readonly number[], componentCount: 4): number {
    if (
      values.length % componentCount !== 0 ||
      values.some((value) => !Number.isFinite(value) || Math.abs(value) > 1.000001)
    ) {
      throw new Error('Normalized glTF VEC4 values must be finite and in range.');
    }
    const bytes = new Uint8Array(values.length * 2);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < values.length; index += 1) {
      view.setInt16(index * 2, normalizedShort(values[index]!), true);
    }
    const bufferView = this.append(bytes);
    return this.addAccessor({
      bufferView,
      componentType: 5122,
      normalized: true,
      count: values.length / componentCount,
      type: 'VEC4',
    });
  }

  addFloatMatrixAccessor(values: readonly number[]): number {
    if (values.length % 16 !== 0 || values.some((value) => !Number.isFinite(value))) {
      throw new Error('glTF MAT4 values must be finite 4 × 4 matrices.');
    }
    const bytes = new Uint8Array(values.length * 4);
    const view = new DataView(bytes.buffer);
    for (let index = 0; index < values.length; index += 1) {
      view.setFloat32(index * 4, values[index]!, true);
    }
    return this.addAccessor({
      bufferView: this.append(bytes),
      componentType: 5126,
      count: values.length / 16,
      type: 'MAT4',
    });
  }

  addInterleavedVertexAccessors(
    positions: readonly number[],
    normals: readonly number[],
    uvs?: readonly number[],
    joints?: readonly number[],
    colors?: readonly number[],
  ): GltfVertexAccessors {
    const count = assertValidInterleavedInputs(positions, normals, uvs, joints, colors);
    const layout = computeVertexLayout(positions, normals, uvs, joints, colors, this.quantize);
    const bytes = encodeInterleavedVertices(count, layout, positions, normals, uvs, joints, colors);
    this.state.usesMeshQuantization ||=
      layout.quantizedPosition || layout.quantizedNormal || layout.quantizedUv;
    const bufferView = this.append(bytes, 34962, layout.stride);
    const encodedPositions = layout.quantizedPosition ? positions.map(normalizedShort) : positions;
    return this.createInterleavedAccessors(
      bufferView,
      count,
      layout,
      encodedPositions,
      uvs !== undefined,
      joints !== undefined,
      colors !== undefined,
    );
  }

  private createInterleavedAccessors(
    bufferView: number,
    count: number,
    layout: VertexLayout,
    encodedPositions: readonly number[],
    hasUvs: boolean,
    hasJoints: boolean,
    hasColors: boolean,
  ): GltfVertexAccessors {
    const position = this.addAccessor({
      bufferView,
      byteOffset: layout.positionOffset,
      componentType: layout.quantizedPosition ? 5122 : 5126,
      ...(layout.quantizedPosition ? { normalized: true } : {}),
      count,
      type: 'VEC3',
      ...this.bounds(encodedPositions, 3),
    });
    const normal = this.addAccessor({
      bufferView,
      byteOffset: layout.normalOffset,
      componentType: layout.quantizedNormal ? 5120 : 5126,
      ...(layout.quantizedNormal ? { normalized: true } : {}),
      count,
      type: 'VEC3',
    });
    const result: GltfVertexAccessors = { position, normal };
    if (hasUvs && layout.uvOffset !== undefined) {
      result.uv = this.addAccessor({
        bufferView,
        byteOffset: layout.uvOffset,
        componentType: layout.quantizedUv ? 5123 : 5126,
        ...(layout.quantizedUv ? { normalized: true } : {}),
        count,
        type: 'VEC2',
      });
    }
    if (hasColors && layout.colorOffset !== undefined) {
      result.color = this.addAccessor({
        bufferView,
        byteOffset: layout.colorOffset,
        componentType: 5121,
        normalized: true,
        count,
        type: layout.colorComponentCount === 4 ? 'VEC4' : 'VEC3',
      });
    }
    if (hasJoints) this.appendSkinAccessors(result, bufferView, count, layout);
    return result;
  }

  private appendSkinAccessors(
    result: GltfVertexAccessors,
    bufferView: number,
    count: number,
    layout: VertexLayout,
  ): void {
    if (layout.jointOffset === undefined || layout.weightOffset === undefined) return;
    result.joints = this.addAccessor({
      bufferView,
      byteOffset: layout.jointOffset,
      componentType: layout.jointComponentType,
      count,
      type: 'VEC4',
    });
    result.weights = this.addAccessor({
      bufferView,
      byteOffset: layout.weightOffset,
      componentType: 5121,
      normalized: true,
      count,
      type: 'VEC4',
    });
  }

  addIndexAccessor(values: readonly number[], target: 34963 = 34963): number {
    const useUint32 = values.some((value) => value > 65535);
    const bytes = new Uint8Array(values.length * (useUint32 ? 4 : 2));
    const view = new DataView(bytes.buffer);
    if (useUint32) {
      for (let index = 0; index < values.length; index += 1) {
        view.setUint32(index * 4, values[index]!, true);
      }
    } else {
      for (let index = 0; index < values.length; index += 1) {
        view.setUint16(index * 2, values[index]!, true);
      }
    }
    const bufferView = this.append(bytes, target);
    return this.addAccessor({
      bufferView,
      componentType: useUint32 ? 5125 : 5123,
      count: values.length,
      type: 'SCALAR',
    });
  }

  addBufferView(bytes: Uint8Array): number {
    return this.append(bytes);
  }

  toUint8Array(): Uint8Array {
    const result = new Uint8Array(this.totalLength);
    for (let index = 0; index < this.chunks.length; index += 1) {
      const chunk = this.chunks[index]!;
      result.set(chunk.bytes, chunk.offset);
    }
    return result;
  }

  private addAccessor(accessor: GltfAccessor): number {
    this.state.accessors.push(accessor);
    return this.state.accessors.length - 1;
  }

  private bounds(
    values: readonly number[],
    componentCount: 1 | 2 | 3 | 4,
  ): Pick<GltfAccessor, 'min' | 'max'> {
    if (values.length === 0) return {};
    const min = new Array<number>(componentCount).fill(Number.POSITIVE_INFINITY);
    const max = new Array<number>(componentCount).fill(Number.NEGATIVE_INFINITY);
    for (let index = 0; index < values.length; index += componentCount) {
      for (let component = 0; component < componentCount; component += 1) {
        const value = values[index + component]!;
        min[component] = Math.min(min[component]!, value);
        max[component] = Math.max(max[component]!, value);
      }
    }
    return { min, max };
  }

  private append(bytes: Uint8Array, target?: 34962 | 34963, byteStride?: number): number {
    const byteOffset = align4(this.totalLength);
    if (bytes.byteLength > 0) {
      this.chunks.push({ offset: byteOffset, bytes });
    }
    this.totalLength = byteOffset + bytes.byteLength;
    this.state.bufferViews.push({
      buffer: 0,
      byteOffset,
      byteLength: bytes.byteLength,
      ...(byteStride === undefined ? {} : { byteStride }),
      ...(target ? { target } : {}),
    });
    return this.state.bufferViews.length - 1;
  }
}
