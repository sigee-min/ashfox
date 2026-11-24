import type { EditorPort } from '../../../ports/editor';
import type { ProjectSession, SessionState } from '../../../session';
import { normalizeMeshUvPolicy } from '../../../domain/mesh/autoUv';
import {
  MODEL_MESH_EXISTS,
  MODEL_MESH_FACE_UV_AUTO_ONLY,
  MODEL_MESH_ID_EXISTS,
  MODEL_MESH_ID_OR_NAME_REQUIRED,
  MODEL_MESH_NAME_REQUIRED,
  MODEL_MESH_NAME_REQUIRED_FIX,
  MODEL_MESH_NOT_FOUND,
} from '../../../shared/messages';
import { buildIdNameMismatchMessage } from '../../../shared/targetMessages';
import {
  ensureIdAvailable,
  ensureNameAvailable,
  ensureRenameAvailable,
  resolveEntityId,
} from '../../crudChecks';
import { withActiveAndRevision } from '../../guards';
import { fail, ok, type UsecaseResult } from '../../result';
import { resolveTargets } from '../../targetSelectors';
import { resolveMeshTarget } from '../../targetResolvers';
import { ensureNonBlankFields } from '../validators';
import { resolveMeshBone, resolveMeshBoneUpdate } from './bone';
import type {
  AddMeshPayload,
  DeleteMeshPayload,
  MeshServiceDeps,
  UpdateMeshPayload,
} from './contract';
import {
  hasCompleteFaceUv,
  hasFaceUvInput,
  stripUvFromFaces,
  validateMeshGeometry,
} from './geometry';
import { autoMapMesh } from './uv';

export class MeshService {
  private readonly session: ProjectSession;
  private readonly editor: EditorPort;
  private readonly getSnapshot: () => SessionState;
  private readonly ensureActive: MeshServiceDeps['ensureActive'];
  private readonly ensureRevisionMatch: MeshServiceDeps['ensureRevisionMatch'];

  constructor(deps: MeshServiceDeps) {
    this.session = deps.session;
    this.editor = deps.editor;
    this.getSnapshot = deps.getSnapshot;
    this.ensureActive = deps.ensureActive;
    this.ensureRevisionMatch = deps.ensureRevisionMatch;
  }

  addMesh(payload: AddMeshPayload): UsecaseResult<{ id: string; name: string }> {
    return withActiveAndRevision(
      this.ensureActive,
      this.ensureRevisionMatch,
      payload.ifRevision,
      () => this.add(payload),
    );
  }

  updateMesh(payload: UpdateMeshPayload): UsecaseResult<{ id: string; name: string }> {
    return withActiveAndRevision(
      this.ensureActive,
      this.ensureRevisionMatch,
      payload.ifRevision,
      () => this.update(payload),
    );
  }

  deleteMesh(payload: DeleteMeshPayload): UsecaseResult<{
    id: string;
    name: string;
    deleted: Array<{ id?: string; name: string }>;
  }> {
    return withActiveAndRevision(
      this.ensureActive,
      this.ensureRevisionMatch,
      payload.ifRevision,
      () => this.delete(payload),
    );
  }

  private add(payload: AddMeshPayload): UsecaseResult<{ id: string; name: string }> {
    const snapshot = this.getSnapshot();
    if (!payload.name) {
      return fail({
        code: 'invalid_payload',
        message: MODEL_MESH_NAME_REQUIRED,
        fix: MODEL_MESH_NAME_REQUIRED_FIX,
      });
    }
    const blankError = ensureNonBlankFields([
      [payload.name, 'Mesh name'],
      [payload.bone, 'Mesh bone'],
      [payload.boneId, 'Mesh boneId'],
    ]);
    if (blankError) return fail(blankError);
    if (hasFaceUvInput(payload.faces)) {
      return fail({ code: 'invalid_payload', message: MODEL_MESH_FACE_UV_AUTO_ONLY });
    }
    const geometryError = validateMeshGeometry(payload.vertices, payload.faces);
    if (geometryError) return fail(geometryError);

    const meshes = snapshot.meshes ?? [];
    const nameError = ensureNameAvailable(meshes, payload.name, MODEL_MESH_EXISTS);
    if (nameError) return fail(nameError);
    const id = resolveEntityId(undefined, payload.id, 'mesh');
    const idError = ensureIdAvailable(meshes, id, MODEL_MESH_ID_EXISTS);
    if (idError) return fail(idError);

    const bone = resolveMeshBone(snapshot, payload);
    if (!bone.ok) return fail(bone.error);
    const mapped = autoMapMesh(
      this.editor,
      snapshot,
      payload.vertices,
      payload.faces,
      payload.uvPolicy,
    );
    const mesh = {
      id,
      name: payload.name,
      bone: bone.value,
      origin: payload.origin,
      rotation: payload.rotation,
      visibility: payload.visibility,
      vertices: payload.vertices,
      faces: mapped.faces,
    };
    const editorError = this.editor.addMesh(mesh);
    if (editorError) return fail(editorError);
    this.session.addMesh({ ...mesh, uvPolicy: mapped.policy });
    return ok({ id, name: payload.name });
  }

  private update(payload: UpdateMeshPayload): UsecaseResult<{ id: string; name: string }> {
    const snapshot = this.getSnapshot();
    const blankError = ensureNonBlankFields([
      [payload.id, 'Mesh id'],
      [payload.name, 'Mesh name'],
      [payload.newName, 'Mesh newName'],
      [payload.bone, 'Mesh bone'],
      [payload.boneId, 'Mesh boneId'],
    ]);
    if (blankError) return fail(blankError);
    if (hasFaceUvInput(payload.faces)) {
      return fail({ code: 'invalid_payload', message: MODEL_MESH_FACE_UV_AUTO_ONLY });
    }

    const meshes = snapshot.meshes ?? [];
    const resolved = resolveMeshTarget(meshes, payload.id, payload.name);
    if (resolved.error) return fail(resolved.error);
    const target = resolved.target!;
    const targetId = resolveEntityId(target.id, payload.id, 'mesh');
    const renameError = ensureRenameAvailable(
      meshes,
      payload.newName,
      target.name,
      MODEL_MESH_EXISTS,
    );
    if (renameError) return fail(renameError);

    const bone = resolveMeshBoneUpdate(snapshot, payload);
    if (!bone.ok) return fail(bone.error);
    const nextVertices = payload.vertices ?? target.vertices;
    const faceGeometry = stripUvFromFaces(payload.faces ?? target.faces)!;
    const geometryError = validateMeshGeometry(nextVertices, faceGeometry);
    if (geometryError) return fail(geometryError);
    const remap = Boolean(
      payload.vertices || payload.faces || payload.uvPolicy || !hasCompleteFaceUv(target.faces),
    );
    const mapped = remap
      ? autoMapMesh(
          this.editor,
          snapshot,
          nextVertices,
          faceGeometry,
          payload.uvPolicy ?? target.uvPolicy,
        )
      : null;
    const faces = mapped?.faces ?? target.faces;
    const uvPolicy = mapped?.policy ?? normalizeMeshUvPolicy(payload.uvPolicy ?? target.uvPolicy);
    const editorError = this.editor.updateMesh({
      id: targetId,
      name: target.name,
      newName: payload.newName,
      bone: payload.boneRoot ? null : typeof bone.value === 'string' ? bone.value : undefined,
      boneRoot: payload.boneRoot,
      origin: payload.origin,
      rotation: payload.rotation,
      visibility: payload.visibility,
      vertices: payload.vertices,
      faces: remap ? faces : undefined,
    });
    if (editorError) return fail(editorError);
    this.session.updateMesh(target.name, {
      id: targetId,
      newName: payload.newName,
      bone: bone.value,
      origin: payload.origin,
      rotation: payload.rotation,
      visibility: payload.visibility,
      uvPolicy,
      ...(payload.vertices ? { vertices: payload.vertices } : {}),
      ...(remap ? { faces } : {}),
    });
    return ok({ id: targetId, name: payload.newName ?? target.name });
  }

  private delete(payload: DeleteMeshPayload): UsecaseResult<{
    id: string;
    name: string;
    deleted: Array<{ id?: string; name: string }>;
  }> {
    const meshes = this.getSnapshot().meshes ?? [];
    const resolved = resolveTargets(
      meshes,
      payload,
      { id: 'Mesh id', name: 'Mesh name' },
      { message: MODEL_MESH_ID_OR_NAME_REQUIRED },
      {
        required: { message: MODEL_MESH_ID_OR_NAME_REQUIRED },
        mismatch: {
          kind: 'Mesh',
          plural: 'meshes',
          message: buildIdNameMismatchMessage,
        },
        notFound: MODEL_MESH_NOT_FOUND,
      },
    );
    if (!resolved.ok) return fail(resolved.error);
    for (const target of resolved.value) {
      const error = this.editor.deleteMesh({
        id: target.id ?? undefined,
        name: target.name,
      });
      if (error) return fail(error);
    }
    this.session.removeMeshes(new Set(resolved.value.map((target) => target.name)));
    const deleted = resolved.value.map((target) => ({
      id: target.id ?? undefined,
      name: target.name,
    }));
    const primary = deleted[0] ?? {
      id: resolved.value[0]?.id ?? undefined,
      name: resolved.value[0]?.name ?? 'unknown',
    };
    return ok({
      id: primary.id ?? primary.name,
      name: primary.name,
      deleted,
    });
  }
}
