import type { ToolError } from '../../types';
import type { SessionState } from '../../session';
import type { CubeFaceDirection, EditorPort, FaceUvMap } from '../../ports/editor';
import { withActiveAndRevision } from '../guards';
import { ok, fail, type UsecaseResult } from '../result';
import { validateUvBounds } from '../../domain/uv/bounds';
import { validateUvAssignments } from '../../domain/uv/assignments';
import {
  MODEL_CUBE_NOT_FOUND,
  TEXTURE_FACE_UV_BOUNDS_FIX,
  TEXTURE_FACE_UV_FACES_FIX,
  TEXTURE_FACE_UV_TARGET_FIX
} from '../../shared/messages';
import { buildUvAssignmentMessages, buildUvBoundsMessages } from '../../shared/messages';

const uvAssignmentMessages = buildUvAssignmentMessages();
const uvBoundsMessages = buildUvBoundsMessages();

export interface TextureUvDeps {
  editor: EditorPort;
  getSnapshot: () => SessionState;
  ensureActive: () => ToolError | null;
  ensureRevisionMatch: (ifRevision?: string) => ToolError | null;
}

export class TextureUvService {
  private readonly editor: EditorPort;
  private readonly getSnapshot: () => SessionState;
  private readonly ensureActive: () => ToolError | null;
  private readonly ensureRevisionMatch: (ifRevision?: string) => ToolError | null;

  constructor(deps: TextureUvDeps) {
    this.editor = deps.editor;
    this.getSnapshot = deps.getSnapshot;
    this.ensureActive = deps.ensureActive;
    this.ensureRevisionMatch = deps.ensureRevisionMatch;
  }

  setFaceUv(payload: {
    cubeId?: string;
    cubeName?: string;
    faces: FaceUvMap;
    ifRevision?: string;
  }): UsecaseResult<{ cubeId?: string; cubeName: string; faces: CubeFaceDirection[] }> {
    return withActiveAndRevision(
      this.ensureActive,
      this.ensureRevisionMatch,
      payload.ifRevision,
      () => {
        const assignmentRes = validateUvAssignments(
          [{ cubeId: payload.cubeId, cubeName: payload.cubeName, faces: payload.faces }],
          uvAssignmentMessages
        );
        if (!assignmentRes.ok) {
          const reason = assignmentRes.error.details?.reason;
          if (reason === 'target_required' || reason === 'cube_ids_string_array' || reason === 'cube_names_string_array') {
            return fail({
              ...assignmentRes.error,
              fix: TEXTURE_FACE_UV_TARGET_FIX
            });
          }
          if (reason === 'faces_required' || reason === 'faces_non_empty') {
            return fail({
              ...assignmentRes.error,
              fix: TEXTURE_FACE_UV_FACES_FIX
            });
          }
          return fail(assignmentRes.error);
        }
        const snapshot = this.getSnapshot();
        const target = snapshot.cubes.find((cube) => cube.id === payload.cubeId || cube.name === payload.cubeName);
        if (!target) {
          return fail({
            code: 'invalid_payload',
            message: MODEL_CUBE_NOT_FOUND(payload.cubeId ?? payload.cubeName ?? 'unknown')
          });
        }
        const faces: CubeFaceDirection[] = [];
        const normalized: FaceUvMap = {};
        const faceEntries = Object.entries(payload.faces ?? {});
        for (const [faceKey, uv] of faceEntries) {
          const [x1, y1, x2, y2] = uv as [number, number, number, number];
          const boundsErr = this.ensureFaceUvWithinResolution([x1, y1, x2, y2]);
          if (boundsErr) return fail(boundsErr);
          normalized[faceKey as CubeFaceDirection] = [x1, y1, x2, y2];
          faces.push(faceKey as CubeFaceDirection);
        }
        const err = this.editor.setFaceUv({
          cubeId: target.id ?? payload.cubeId,
          cubeName: target.name,
          faces: normalized
        });
        if (err) return fail(err);
        return ok({ cubeId: target.id ?? payload.cubeId, cubeName: target.name, faces });
      }
    );
  }

  private ensureFaceUvWithinResolution(uv: [number, number, number, number]): ToolError | null {
    const resolution = this.editor.getProjectTextureResolution();
    if (!resolution) return null;
    const boundsErr = validateUvBounds(uv, resolution, { uv, textureResolution: resolution }, uvBoundsMessages);
    if (!boundsErr) return null;
    if (boundsErr.ok) return null;
    const reason = boundsErr.error.details?.reason;
    if (reason === 'out_of_bounds') {
      return {
        ...boundsErr.error,
        fix: TEXTURE_FACE_UV_BOUNDS_FIX
      };
    }
    return boundsErr.error;
  }
}

