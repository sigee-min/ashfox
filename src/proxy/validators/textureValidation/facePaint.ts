import {
  FACE_PAINT_ANCHOR_INVALID,
  FACE_PAINT_CUBE_IDS_ARRAY,
  FACE_PAINT_CUBE_NAMES_ARRAY,
  FACE_PAINT_ENTRY_REQUIRED,
  FACE_PAINT_FACES_INVALID,
  FACE_PAINT_MAPPING_INVALID,
  FACE_PAINT_MATERIAL_REQUIRED,
  FACE_PAINT_MATERIAL_STRING,
  FACE_PAINT_MUST_BE_ARRAY,
  FACE_PAINT_PALETTE_INVALID,
  FACE_PAINT_PADDING_INVALID,
  FACE_PAINT_SCOPE_INVALID,
  FACE_PAINT_SEED_INVALID
} from '../../../shared/messages';
import { UV_PAINT_MAPPINGS, UV_PAINT_SCOPES } from '../../../shared/texturePolicy';
import { isRecord } from '../../../domain/guards';
import { FACE_DIRECTION_SET, validationOk } from '../common';
import { errWithCode } from '../../response';
import type { ToolResponse } from '../../../types';

export const validateFacePaintEntries = (entries: unknown): ToolResponse<void> => {
  if (!Array.isArray(entries)) {
    return errWithCode('invalid_payload', FACE_PAINT_MUST_BE_ARRAY);
  }
  for (const entry of entries) {
    if (!isRecord(entry)) {
      return errWithCode('invalid_payload', FACE_PAINT_ENTRY_REQUIRED);
    }
    if (entry.material === undefined || entry.material === null) {
      return errWithCode('invalid_payload', FACE_PAINT_MATERIAL_REQUIRED);
    }
    if (typeof entry.material !== 'string') {
      return errWithCode('invalid_payload', FACE_PAINT_MATERIAL_STRING);
    }
    if (entry.material.trim().length === 0) {
      return errWithCode('invalid_payload', FACE_PAINT_MATERIAL_REQUIRED);
    }
    if (entry.palette !== undefined) {
      if (!Array.isArray(entry.palette) || entry.palette.some((color: unknown) => typeof color !== 'string')) {
        return errWithCode('invalid_payload', FACE_PAINT_PALETTE_INVALID);
      }
    }
    if (entry.seed !== undefined && (!Number.isFinite(entry.seed) || typeof entry.seed !== 'number')) {
      return errWithCode('invalid_payload', FACE_PAINT_SEED_INVALID);
    }
    if (entry.cubeIds !== undefined) {
      if (!Array.isArray(entry.cubeIds) || entry.cubeIds.some((id: unknown) => typeof id !== 'string')) {
        return errWithCode('invalid_payload', FACE_PAINT_CUBE_IDS_ARRAY);
      }
    }
    if (entry.cubeNames !== undefined) {
      if (!Array.isArray(entry.cubeNames) || entry.cubeNames.some((name: unknown) => typeof name !== 'string')) {
        return errWithCode('invalid_payload', FACE_PAINT_CUBE_NAMES_ARRAY);
      }
    }
    if (entry.faces !== undefined) {
      if (
        !Array.isArray(entry.faces) ||
        entry.faces.some((face: unknown) => typeof face !== 'string' || !FACE_DIRECTION_SET.has(face))
      ) {
        return errWithCode('invalid_payload', FACE_PAINT_FACES_INVALID);
      }
    }
    if (entry.scope !== undefined) {
      if (typeof entry.scope !== 'string' || !UV_PAINT_SCOPES.some((value) => value === entry.scope)) {
        return errWithCode('invalid_payload', FACE_PAINT_SCOPE_INVALID);
      }
    }
    if (entry.mapping !== undefined) {
      if (typeof entry.mapping !== 'string' || !UV_PAINT_MAPPINGS.some((value) => value === entry.mapping)) {
        return errWithCode('invalid_payload', FACE_PAINT_MAPPING_INVALID);
      }
    }
    if (entry.padding !== undefined) {
      if (typeof entry.padding !== 'number' || !Number.isFinite(entry.padding) || entry.padding < 0) {
        return errWithCode('invalid_payload', FACE_PAINT_PADDING_INVALID);
      }
    }
    if (entry.anchor !== undefined) {
      if (
        !Array.isArray(entry.anchor) ||
        entry.anchor.length !== 2 ||
        !Number.isFinite(entry.anchor[0]) ||
        !Number.isFinite(entry.anchor[1])
      ) {
        return errWithCode('invalid_payload', FACE_PAINT_ANCHOR_INVALID);
      }
    }
  }
  return validationOk();
};
