import type { GltfAccessor, GltfBufferView } from './contract';

export interface GltfBinaryState {
  bufferViews: GltfBufferView[];
  accessors: GltfAccessor[];
  usesMeshQuantization: boolean;
}

export interface GltfVertexAccessors {
  position: number;
  normal: number;
  uv?: number;
  joints?: number;
  weights?: number;
}

const align4 = (value: number): number => (value + 3) & ~3;
const normalizedShort = (value: number): number =>
  Math.round(Math.max(-1, Math.min(1, value)) * 32767);
const normalizedUnsignedShort = (value: number): number =>
  Math.round(Math.max(0, Math.min(1, value)) * 65535);
const fitsNormalizedSigned = (values: readonly number[]): boolean =>
  values.every((value) => Number.isFinite(value) && Math.abs(value) <= 1);
const fitsNormalizedUnsigned = (values: readonly number[]): boolean =>
  values.every((value) => Number.isFinite(value) && value >= 0 && value <= 1);

interface VertexLayout {
  positionOffset: number;
  normalOffset: number;
  uvOffset?: number;
  jointOffset?: number;
  weightOffset?: number;
  stride: number;
  quantizedPosition: boolean;
  quantizedNormal: boolean;
  quantizedUv: boolean;
  jointComponentType: 5121 | 5123;
}

const alignTo = (value: number, alignment: number): number =>
  Math.ceil(value / alignment) * alignment;

const vertexLayout = (
  positions: readonly number[],
  normals: readonly number[],
  uvs: readonly number[] | undefined,
  joints: readonly number[] | undefined,
  quantize: boolean
): VertexLayout => {
  const quantizedPosition = quantize && fitsNormalizedSigned(positions);
  const quantizedNormal = quantize && fitsNormalizedSigned(normals);
  const quantizedUv = quantize && uvs !== undefined && fitsNormalizedUnsigned(uvs);
  const positionSize = quantizedPosition ? 6 : 12;
  const normalOffset = align4(positionSize);
  const normalSize = quantizedNormal ? 6 : 12;
  const uvOffset = uvs ? align4(normalOffset + normalSize) : undefined;
  const uvSize = uvs ? (quantizedUv ? 4 : 8) : 0;
  const attributeEnd = uvs && uvOffset !== undefined
    ? uvOffset + uvSize
    : normalOffset + normalSize;
  const jointComponentType = joints?.some((joint) => joint > 255)
    ? 5123 as const
    : 5121 as const;
  const jointSize = jointComponentType === 5123 ? 2 : 1;
  const jointOffset = joints
    ? alignTo(attributeEnd, jointSize)
    : undefined;
  const weightOffset = jointOffset === undefined
    ? undefined
    : jointOffset + jointSize * 4;
  const end = weightOffset === undefined
    ? attributeEnd
    : weightOffset + 4;
  return {
    positionOffset: 0,
    normalOffset,
    ...(uvOffset === undefined ? {} : { uvOffset }),
    ...(jointOffset === undefined ? {} : { jointOffset }),
    ...(weightOffset === undefined ? {} : { weightOffset }),
    stride: align4(end),
    quantizedPosition,
    quantizedNormal,
    quantizedUv,
    jointComponentType
  };
};

export class GltfBinaryWriter {
  constructor(private readonly quantize = true) {}
  private bytes: number[] = [];
  readonly state: GltfBinaryState = {
    bufferViews: [],
    accessors: [],
    usesMeshQuantization: false
  };

  get byteLength(): number {
    return this.bytes.length;
  }

  addFloatAccessor(
    values: readonly number[],
    componentCount: 1 | 2 | 3 | 4,
    includeBounds: boolean,
    target?: 34962
  ): number {
    const bytes = new Uint8Array(values.length * 4);
    const view = new DataView(bytes.buffer);
    values.forEach((value, index) => {
      view.setFloat32(index * 4, value, true);
    });
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
              : 'VEC4'
    };
    if (includeBounds && count > 0) {
      const min = new Array<number>(componentCount).fill(Number.POSITIVE_INFINITY);
      const max = new Array<number>(componentCount).fill(Number.NEGATIVE_INFINITY);
      for (let index = 0; index < values.length; index += componentCount) {
        for (let component = 0; component < componentCount; component += 1) {
          const value = values[index + component];
          min[component] = Math.min(min[component], value);
          max[component] = Math.max(max[component], value);
        }
      }
      accessor.min = min;
      accessor.max = max;
    }
    this.state.accessors.push(accessor);
    return this.state.accessors.length - 1;
  }

  addNormalizedShortAccessor(
    values: readonly number[],
    componentCount: 4
  ): number {
    if (
      values.length % componentCount !== 0 ||
      values.some(
        (value) => !Number.isFinite(value) || Math.abs(value) > 1.000001
      )
    ) {
      throw new Error('Normalized glTF VEC4 values must be finite and in range.');
    }
    const bytes = new Uint8Array(values.length * 2);
    const view = new DataView(bytes.buffer);
    values.forEach((value, index) => {
      view.setInt16(index * 2, normalizedShort(value), true);
    });
    const bufferView = this.append(bytes);
    return this.addAccessor({
      bufferView,
      componentType: 5122,
      normalized: true,
      count: values.length / componentCount,
      type: 'VEC4'
    });
  }

  addFloatMatrixAccessor(values: readonly number[]): number {
    if (values.length % 16 !== 0 || values.some((value) => !Number.isFinite(value))) {
      throw new Error('glTF MAT4 values must be finite 4 × 4 matrices.');
    }
    const bytes = new Uint8Array(values.length * 4);
    const view = new DataView(bytes.buffer);
    values.forEach((value, index) => view.setFloat32(index * 4, value, true));
    return this.addAccessor({
      bufferView: this.append(bytes),
      componentType: 5126,
      count: values.length / 16,
      type: 'MAT4'
    });
  }

  addInterleavedVertexAccessors(
    positions: readonly number[],
    normals: readonly number[],
    uvs?: readonly number[],
    joints?: readonly number[]
  ): GltfVertexAccessors {
    if (positions.length % 3 !== 0 || normals.length !== positions.length) {
      throw new Error('glTF vertex positions and normals must be VEC3 pairs.');
    }
    const count = positions.length / 3;
    if (uvs && uvs.length !== count * 2) {
      throw new Error('glTF vertex UVs must match the position count.');
    }
    if (
      joints &&
      (
        joints.length !== count ||
        joints.some(
          (joint) =>
            !Number.isSafeInteger(joint) || joint < 0 || joint > 65535
        )
      )
    ) {
      throw new Error('glTF rigid joint indices must match the position count.');
    }
    const layout = vertexLayout(positions, normals, uvs, joints, this.quantize);
    const bytes = new Uint8Array(count * layout.stride);
    const view = new DataView(bytes.buffer);
    for (let vertex = 0; vertex < count; vertex += 1) {
      const base = vertex * layout.stride;
      for (let component = 0; component < 3; component += 1) {
        const position = positions[vertex * 3 + component];
        const normal = normals[vertex * 3 + component];
        if (layout.quantizedPosition) {
          view.setInt16(base + component * 2, normalizedShort(position), true);
        } else {
          view.setFloat32(base + component * 4, position, true);
        }
        if (layout.quantizedNormal) {
          view.setInt16(
            base + layout.normalOffset + component * 2,
            normalizedShort(normal),
            true
          );
        } else {
          view.setFloat32(
            base + layout.normalOffset + component * 4,
            normal,
            true
          );
        }
      }
      if (uvs && layout.uvOffset !== undefined) {
        for (let component = 0; component < 2; component += 1) {
          const uv = uvs[vertex * 2 + component];
          if (layout.quantizedUv) {
            view.setUint16(
              base + layout.uvOffset + component * 2,
              normalizedUnsignedShort(uv),
              true
            );
          } else {
            view.setFloat32(
              base + layout.uvOffset + component * 4,
              uv,
              true
            );
          }
        }
      }
      if (
        joints &&
        layout.jointOffset !== undefined &&
        layout.weightOffset !== undefined
      ) {
        for (let component = 0; component < 4; component += 1) {
          const joint = component === 0 ? joints[vertex] : 0;
          if (layout.jointComponentType === 5123) {
            view.setUint16(
              base + layout.jointOffset + component * 2,
              joint,
              true
            );
          } else {
            view.setUint8(base + layout.jointOffset + component, joint);
          }
          view.setUint8(
            base + layout.weightOffset + component,
            component === 0 ? 255 : 0
          );
        }
      }
    }
    this.state.usesMeshQuantization ||=
      layout.quantizedPosition || layout.quantizedNormal;
    const bufferView = this.append(bytes, 34962, layout.stride);
    const encodedPositions = layout.quantizedPosition
      ? positions.map(normalizedShort)
      : positions;
    const position = this.addAccessor({
      bufferView,
      byteOffset: layout.positionOffset,
      componentType: layout.quantizedPosition ? 5122 : 5126,
      ...(layout.quantizedPosition ? { normalized: true } : {}),
      count,
      type: 'VEC3',
      ...this.bounds(encodedPositions, 3)
    });
    const normal = this.addAccessor({
      bufferView,
      byteOffset: layout.normalOffset,
      componentType: layout.quantizedNormal ? 5122 : 5126,
      ...(layout.quantizedNormal ? { normalized: true } : {}),
      count,
      type: 'VEC3'
    });
    const uv = uvs && layout.uvOffset !== undefined
      ? this.addAccessor({
          bufferView,
          byteOffset: layout.uvOffset,
          componentType: layout.quantizedUv ? 5123 : 5126,
          ...(layout.quantizedUv ? { normalized: true } : {}),
          count,
          type: 'VEC2'
        })
      : undefined;
    const jointAccessor = joints && layout.jointOffset !== undefined
      ? this.addAccessor({
          bufferView,
          byteOffset: layout.jointOffset,
          componentType: layout.jointComponentType,
          count,
          type: 'VEC4'
        })
      : undefined;
    const weights = joints && layout.weightOffset !== undefined
      ? this.addAccessor({
          bufferView,
          byteOffset: layout.weightOffset,
          componentType: 5121,
          normalized: true,
          count,
          type: 'VEC4'
        })
      : undefined;
    return {
      position,
      normal,
      ...(uv === undefined ? {} : { uv }),
      ...(jointAccessor === undefined ? {} : { joints: jointAccessor }),
      ...(weights === undefined ? {} : { weights })
    };
  }

  addIndexAccessor(values: readonly number[], target: 34963 = 34963): number {
    const useUint32 = values.some((value) => value > 65535);
    const bytes = new Uint8Array(values.length * (useUint32 ? 4 : 2));
    const view = new DataView(bytes.buffer);
    values.forEach((value, index) => {
      if (useUint32) {
        view.setUint32(index * 4, value, true);
      } else {
        view.setUint16(index * 2, value, true);
      }
    });
    const bufferView = this.append(bytes, target);
    this.state.accessors.push({
      bufferView,
      componentType: useUint32 ? 5125 : 5123,
      count: values.length,
      type: 'SCALAR',
      ...this.bounds(values, 1)
    });
    return this.state.accessors.length - 1;
  }

  addBufferView(bytes: Uint8Array): number {
    return this.append(bytes);
  }

  toUint8Array(): Uint8Array {
    return Uint8Array.from(this.bytes);
  }

  private addAccessor(accessor: GltfAccessor): number {
    this.state.accessors.push(accessor);
    return this.state.accessors.length - 1;
  }

  private bounds(
    values: readonly number[],
    componentCount: 1 | 2 | 3 | 4
  ): Pick<GltfAccessor, 'min' | 'max'> {
    if (values.length === 0) return {};
    const min = new Array<number>(componentCount).fill(Number.POSITIVE_INFINITY);
    const max = new Array<number>(componentCount).fill(Number.NEGATIVE_INFINITY);
    for (let index = 0; index < values.length; index += componentCount) {
      for (let component = 0; component < componentCount; component += 1) {
        const value = values[index + component];
        min[component] = Math.min(min[component], value);
        max[component] = Math.max(max[component], value);
      }
    }
    return { min, max };
  }

  private append(
    bytes: Uint8Array,
    target?: 34962 | 34963,
    byteStride?: number
  ): number {
    const alignedOffset = align4(this.bytes.length);
    while (this.bytes.length < alignedOffset) this.bytes.push(0);
    const byteOffset = this.bytes.length;
    for (const byte of bytes) this.bytes.push(byte);
    this.state.bufferViews.push({
      buffer: 0,
      byteOffset,
      byteLength: bytes.byteLength,
      ...(byteStride === undefined ? {} : { byteStride }),
      ...(target ? { target } : {})
    });
    return this.state.bufferViews.length - 1;
  }
}
