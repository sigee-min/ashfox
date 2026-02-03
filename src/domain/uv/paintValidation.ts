import { CUBE_FACE_DIRECTIONS } from '../model';
import type { Limits } from '../model';
import type { DomainResult } from '../result';
import type { UvPaintMessages } from './paintTypes';
import { isFiniteNumber, isRecord } from '../guards';

const VALID_FACES: ReadonlySet<string> = new Set<string>(CUBE_FACE_DIRECTIONS);

export const validateUvPaintSpec = (
  value: unknown,
  limits: Limits,
  label: string,
  messages: UvPaintMessages
): DomainResult<unknown> => {
  if (!isRecord(value)) {
    return err('invalid_payload', messages.objectRequired(label));
  }
  if (value.scope !== undefined && !['faces', 'rects', 'bounds'].includes(String(value.scope))) {
    return err('invalid_payload', messages.scopeInvalid(label));
  }
  if (value.mapping !== undefined && !['stretch', 'tile'].includes(String(value.mapping))) {
    return err('invalid_payload', messages.mappingInvalid(label));
  }
  if (value.padding !== undefined && (!isFiniteNumber(value.padding) || value.padding < 0)) {
    return err('invalid_payload', messages.paddingInvalid(label));
  }
  if (value.anchor !== undefined) {
    if (!Array.isArray(value.anchor) || value.anchor.length !== 2) {
      return err('invalid_payload', messages.anchorFormat(label));
    }
    if (!isFiniteNumber(value.anchor[0]) || !isFiniteNumber(value.anchor[1])) {
      return err('invalid_payload', messages.anchorNumbers(label));
    }
  }
  if (value.source !== undefined) {
    if (!isRecord(value.source)) {
      return err('invalid_payload', messages.sourceObject(label));
    }
    const width = value.source.width;
    const height = value.source.height;
    if (!isFiniteNumber(width) || !isFiniteNumber(height)) {
      return err('invalid_payload', messages.sourceRequired(label));
    }
    if (!Number.isInteger(width) || !Number.isInteger(height) || width <= 0 || height <= 0) {
      return err('invalid_payload', messages.sourcePositive(label));
    }
    if (width > limits.maxTextureSize || height > limits.maxTextureSize) {
      return err('invalid_payload', messages.sourceExceedsMax(limits.maxTextureSize, label));
    }
  }
  if (value.target !== undefined) {
    if (!isRecord(value.target)) {
      return err('invalid_payload', messages.targetObject(label));
    }
    if (value.target.cubeIds !== undefined) {
      if (!Array.isArray(value.target.cubeIds) || value.target.cubeIds.length === 0) {
        return err('invalid_payload', messages.targetCubeIdsRequired(label));
      }
      if (!value.target.cubeIds.every((id: unknown) => typeof id === 'string')) {
        return err('invalid_payload', messages.targetCubeIdsString(label));
      }
    }
    if (value.target.cubeNames !== undefined) {
      if (!Array.isArray(value.target.cubeNames) || value.target.cubeNames.length === 0) {
        return err('invalid_payload', messages.targetCubeNamesRequired(label));
      }
      if (!value.target.cubeNames.every((name: unknown) => typeof name === 'string')) {
        return err('invalid_payload', messages.targetCubeNamesString(label));
      }
    }
    if (value.target.faces !== undefined) {
      if (!Array.isArray(value.target.faces) || value.target.faces.length === 0) {
        return err('invalid_payload', messages.targetFacesRequired(label));
      }
      if (!value.target.faces.every((face: unknown) => typeof face === 'string' && VALID_FACES.has(face))) {
        return err('invalid_payload', messages.targetFacesInvalid(label));
      }
    }
  }
  return { ok: true, data: { valid: true } };
};

const err = <T = never>(code: 'invalid_payload' | 'invalid_state', message: string): DomainResult<T> => ({
  ok: false,
  error: { code, message }
});
