import type { ToolError } from '../../types';
import type { Capabilities } from '../../types';
import type { EditorPort } from '../../ports/editor';
import type { ProjectSession, SessionState } from '../../session';
import { ok, fail, type UsecaseResult } from '../result';
import { withActiveAndRevision } from '../guards';
import { createId } from '../../shared/id';
import { resolveBoneTarget, resolveCubeTarget } from '../targetResolvers';
import { resolveBoneNameById } from '../../domain/sessionLookup';
import {
  MODEL_CUBE_BONE_REQUIRED,
  MODEL_CUBE_BONE_REQUIRED_FIX,
  MODEL_CUBE_EXISTS,
  MODEL_CUBE_ID_EXISTS,
  MODEL_CUBE_LIMIT_EXCEEDED,
  MODEL_CUBE_NAME_REQUIRED,
  MODEL_CUBE_NAME_REQUIRED_FIX,
  MODEL_BONE_NOT_FOUND
} from '../../shared/messages';
import { ensureNonBlankFields } from './validators';
import { ensureIdAvailable, ensureNameAvailable, ensureRenameAvailable, resolveEntityId } from '../crudChecks';

export interface CubeServiceDeps {
  session: ProjectSession;
  editor: EditorPort;
  capabilities: Capabilities;
  getSnapshot: () => SessionState;
  ensureActive: () => ToolError | null;
  ensureRevisionMatch: (ifRevision?: string) => ToolError | null;
}

export class CubeService {
  private readonly session: ProjectSession;
  private readonly editor: EditorPort;
  private readonly capabilities: Capabilities;
  private readonly getSnapshot: () => SessionState;
  private readonly ensureActive: () => ToolError | null;
  private readonly ensureRevisionMatch: (ifRevision?: string) => ToolError | null;

  constructor(deps: CubeServiceDeps) {
    this.session = deps.session;
    this.editor = deps.editor;
    this.capabilities = deps.capabilities;
    this.getSnapshot = deps.getSnapshot;
    this.ensureActive = deps.ensureActive;
    this.ensureRevisionMatch = deps.ensureRevisionMatch;
  }

  addCube(payload: {
    id?: string;
    name: string;
    from: [number, number, number];
    to: [number, number, number];
    bone?: string;
    boneId?: string;
    origin?: [number, number, number];
    rotation?: [number, number, number];
    inflate?: number;
    mirror?: boolean;
    visibility?: boolean;
    boxUv?: boolean;
    uvOffset?: [number, number];
    ifRevision?: string;
  }): UsecaseResult<{ id: string; name: string }> {
    return withActiveAndRevision(
      this.ensureActive,
      this.ensureRevisionMatch,
      payload.ifRevision,
      () => {
        const snapshot = this.getSnapshot();
        if (!payload.name) {
          return fail({
            code: 'invalid_payload',
            message: MODEL_CUBE_NAME_REQUIRED,
            fix: MODEL_CUBE_NAME_REQUIRED_FIX
          });
        }
        const blankErr = ensureNonBlankFields([
          [payload.name, 'Cube name'],
          [payload.bone, 'Cube bone'],
          [payload.boneId, 'Cube boneId']
        ]);
        if (blankErr) return fail(blankErr);
        const resolvedBone = resolveBoneTarget(snapshot.bones, payload.boneId, payload.bone, {
          idLabel: 'boneId',
          nameLabel: 'bone',
          required: { message: MODEL_CUBE_BONE_REQUIRED, fix: MODEL_CUBE_BONE_REQUIRED_FIX }
        });
        if (resolvedBone.error) return fail(resolvedBone.error);
        const resolvedBoneName = resolvedBone.target!.name;
        const nameErr = ensureNameAvailable(snapshot.cubes, payload.name, MODEL_CUBE_EXISTS);
        if (nameErr) return fail(nameErr);
        const limitErr = this.ensureCubeLimit(1);
        if (limitErr) return fail(limitErr);
        const id = resolveEntityId(undefined, payload.id, 'cube');
        const idErr = ensureIdAvailable(snapshot.cubes, id, MODEL_CUBE_ID_EXISTS);
        if (idErr) return fail(idErr);
        const err = this.editor.addCube({
          id,
          name: payload.name,
          from: payload.from,
          to: payload.to,
          bone: resolvedBoneName,
          origin: payload.origin,
          rotation: payload.rotation,
          inflate: payload.inflate,
          mirror: payload.mirror,
          visibility: payload.visibility,
          boxUv: payload.boxUv,
          uvOffset: payload.uvOffset
        });
        if (err) return fail(err);
        this.session.addCube({
          id,
          name: payload.name,
          from: payload.from,
          to: payload.to,
          bone: resolvedBoneName,
          origin: payload.origin,
          rotation: payload.rotation,
          inflate: payload.inflate,
          mirror: payload.mirror,
          visibility: payload.visibility,
          boxUv: payload.boxUv,
          uvOffset: payload.uvOffset
        });
        return ok({ id, name: payload.name });
      }
    );
  }

  updateCube(payload: {
    id?: string;
    name?: string;
    newName?: string;
    bone?: string;
    boneId?: string;
    boneRoot?: boolean;
    from?: [number, number, number];
    to?: [number, number, number];
    origin?: [number, number, number];
    rotation?: [number, number, number];
    inflate?: number;
    mirror?: boolean;
    visibility?: boolean;
    boxUv?: boolean;
    uvOffset?: [number, number];
    ifRevision?: string;
  }): UsecaseResult<{ id: string; name: string }> {
    return withActiveAndRevision(
      this.ensureActive,
      this.ensureRevisionMatch,
      payload.ifRevision,
      () => {
        const snapshot = this.getSnapshot();
        const blankErr = ensureNonBlankFields([
          [payload.id, 'Cube id'],
          [payload.name, 'Cube name'],
          [payload.newName, 'Cube newName'],
          [payload.bone, 'Cube bone'],
          [payload.boneId, 'Cube boneId']
        ]);
        if (blankErr) return fail(blankErr);
        const resolved = resolveCubeTarget(snapshot.cubes, payload.id, payload.name);
        if (resolved.error) return fail(resolved.error);
        const target = resolved.target!;
        const targetName = target.name;
        const targetId = resolveEntityId(target.id, payload.id, 'cube');
        const renameErr = ensureRenameAvailable(snapshot.cubes, payload.newName, targetName, MODEL_CUBE_EXISTS);
        if (renameErr) return fail(renameErr);
        const boneRes = this.resolveCubeBoneUpdate(snapshot, {
          boneRoot: payload.boneRoot,
          boneId: payload.boneId,
          bone: payload.bone
        });
        if (!boneRes.ok) return fail(boneRes.error);
        const boneUpdate = boneRes.value;
        const err = this.editor.updateCube({
          id: targetId,
          name: targetName,
          newName: payload.newName,
          bone: payload.boneRoot ? undefined : typeof boneUpdate === 'string' ? boneUpdate : undefined,
          boneRoot: payload.boneRoot,
          from: payload.from,
          to: payload.to,
          origin: payload.origin,
          rotation: payload.rotation,
          inflate: payload.inflate,
          mirror: payload.mirror,
          visibility: payload.visibility,
          boxUv: payload.boxUv,
          uvOffset: payload.uvOffset
        });
        if (err) return fail(err);
        if (boneUpdate === 'root' && !snapshot.bones.some((b) => b.name === 'root')) {
          this.session.addBone({ id: createId('bone'), name: 'root', pivot: [0, 0, 0] });
        }
        this.session.updateCube(targetName, {
          id: targetId,
          newName: payload.newName,
          bone: typeof boneUpdate === 'string' ? boneUpdate : undefined,
          from: payload.from,
          to: payload.to,
          origin: payload.origin,
          rotation: payload.rotation,
          inflate: payload.inflate,
          mirror: payload.mirror,
          visibility: payload.visibility,
          boxUv: payload.boxUv,
          uvOffset: payload.uvOffset
        });
        return ok({ id: targetId, name: payload.newName ?? targetName });
      }
    );
  }

  deleteCube(payload: { id?: string; name?: string; ifRevision?: string }): UsecaseResult<{ id: string; name: string }> {
    return withActiveAndRevision(
      this.ensureActive,
      this.ensureRevisionMatch,
      payload.ifRevision,
      () => {
        const snapshot = this.getSnapshot();
        const blankErr = ensureNonBlankFields([
          [payload.id, 'Cube id'],
          [payload.name, 'Cube name']
        ]);
        if (blankErr) return fail(blankErr);
        const resolved = resolveCubeTarget(snapshot.cubes, payload.id, payload.name);
        if (resolved.error) return fail(resolved.error);
        const target = resolved.target!;
        const err = this.editor.deleteCube({ id: target.id ?? payload.id, name: target.name });
        if (err) return fail(err);
        this.session.removeCubes([target.name]);
        return ok({ id: target.id ?? payload.id ?? target.name, name: target.name });
      }
    );
  }

  private ensureCubeLimit(increment: number): ToolError | null {
    const snapshot = this.getSnapshot();
    const current = snapshot.cubes.length;
    const limit = this.capabilities.limits.maxCubes;
    if (current + increment > limit) {
      return { code: 'invalid_payload', message: MODEL_CUBE_LIMIT_EXCEEDED(limit) };
    }
    return null;
  }

  private resolveCubeBoneUpdate(
    snapshot: SessionState,
    payload: { boneRoot?: boolean; boneId?: string; bone?: string }
  ): UsecaseResult<string | 'root' | undefined> {
    const boneUpdateRaw = payload.boneRoot
      ? 'root'
      : payload.boneId
        ? resolveBoneNameById(snapshot.bones, payload.boneId)
        : payload.bone !== undefined
          ? payload.bone
          : undefined;
    if (payload.boneId && !boneUpdateRaw) {
      return fail({ code: 'invalid_payload', message: MODEL_BONE_NOT_FOUND(payload.boneId) });
    }
    const boneUpdate = boneUpdateRaw ?? undefined;
    if (typeof boneUpdate === 'string' && boneUpdate !== 'root') {
      const boneExists = snapshot.bones.some((b) => b.name === boneUpdate);
      if (!boneExists) {
        return fail({ code: 'invalid_payload', message: MODEL_BONE_NOT_FOUND(boneUpdate) });
      }
    }
    return ok(boneUpdate);
  }
}
