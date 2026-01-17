import {
  Capabilities,
  ExportPayload,
  FormatKind,
  ProjectDiff,
  ProjectInfo,
  ProjectState,
  ProjectStateDetail,
  RenderPreviewPayload,
  RenderPreviewResult,
  ToolError
} from '../types';
import { ProjectSession, SessionState } from '../session';
import { EditorPort, TextureSource } from '../ports/editor';
import { FormatPort } from '../ports/formats';
import { SnapshotPort } from '../ports/snapshot';
import { ExportPort } from '../ports/exporter';
import { buildRigTemplate } from '../templates';
import { buildInternalExport } from '../domain/exporters';
import { validateSnapshot } from '../domain/validation';
import { ok, fail, UsecaseResult } from './result';
import { resolveFormatId, FormatOverrides, matchesFormatKind } from '../domain/format';
import { mergeSnapshots } from '../domain/snapshot';
import { diffSnapshots } from '../domain/diff';
import { mergeRigParts, RigMergeStrategy } from '../domain/rig';

const FORMAT_OVERRIDE_HINT = 'Set Format ID override in Settings (bbmcp).';

function withFormatOverrideHint(message: string) {
  return `${message} ${FORMAT_OVERRIDE_HINT}`;
}

export interface ToolServiceDeps {
  session: ProjectSession;
  capabilities: Capabilities;
  editor: EditorPort;
  formats: FormatPort;
  snapshot: SnapshotPort;
  exporter: ExportPort;
  policies?: ToolPolicies;
}

export class ToolService {
  private readonly session: ProjectSession;
  private readonly capabilities: Capabilities;
  private readonly editor: EditorPort;
  private readonly formats: FormatPort;
  private readonly snapshotPort: SnapshotPort;
  private readonly exporter: ExportPort;
  private readonly policies: ToolPolicies;
  private readonly snapshotCache = new Map<string, SessionState>();
  private readonly snapshotOrder: string[] = [];
  private readonly snapshotCacheLimit = 5;
  private revisionBypassDepth = 0;

  constructor(deps: ToolServiceDeps) {
    this.session = deps.session;
    this.capabilities = deps.capabilities;
    this.editor = deps.editor;
    this.formats = deps.formats;
    this.snapshotPort = deps.snapshot;
    this.exporter = deps.exporter;
    this.policies = deps.policies ?? {};
  }

  listCapabilities(): Capabilities {
    return this.capabilities;
  }

  isRevisionRequired(): boolean {
    return Boolean(this.policies.requireRevision);
  }

  runWithoutRevisionGuard<T>(fn: () => T): T {
    this.revisionBypassDepth += 1;
    try {
      return fn();
    } finally {
      this.revisionBypassDepth = Math.max(0, this.revisionBypassDepth - 1);
    }
  }

  listProjects(): UsecaseResult<{ projects: ProjectInfo[] }> {
    const live = this.snapshotPort.readSnapshot();
    if (!live) return ok({ projects: [] });
    const normalized = this.normalizeSnapshot(live);
    const info = this.toProjectInfo(normalized);
    return ok({ projects: info ? [info] : [] });
  }

  getProjectState(payload: { detail?: ProjectStateDetail }): UsecaseResult<{ project: ProjectState }> {
    const detail: ProjectStateDetail = payload.detail ?? 'summary';
    const snapshot = this.getSnapshot(this.policies.snapshotPolicy ?? 'hybrid');
    const normalized = this.normalizeSnapshot(snapshot);
    const info = this.toProjectInfo(normalized);
    const active = Boolean(info);
    const project = this.buildProjectState(normalized, detail, active);
    this.rememberSnapshot(normalized, project.revision);
    return ok({ project });
  }

  getProjectDiff(payload: { sinceRevision: string; detail?: ProjectStateDetail }): UsecaseResult<{ diff: ProjectDiff }> {
    const detail: ProjectStateDetail = payload.detail ?? 'summary';
    const snapshot = this.getSnapshot(this.policies.snapshotPolicy ?? 'hybrid');
    const normalized = this.normalizeSnapshot(snapshot);
    const info = this.toProjectInfo(normalized);
    if (!info) {
      return fail({ code: 'invalid_state', message: 'No active project.' });
    }
    const currentRevision = hashSnapshot(normalized);
    const previous = this.snapshotCache.get(payload.sinceRevision);
    const baseMissing = !previous;
    const emptyBase = {
      ...normalized,
      bones: [],
      cubes: [],
      textures: [],
      animations: [],
      animationsStatus: normalized.animationsStatus
    };
    const diffResult = diffSnapshots(previous ?? emptyBase, normalized, detail === 'full');
    const diff: ProjectDiff = {
      sinceRevision: payload.sinceRevision,
      currentRevision,
      baseMissing: baseMissing || undefined,
      counts: diffResult.counts
    };
    if (detail === 'full' && diffResult.sets) {
      diff.bones = diffResult.sets.bones;
      diff.cubes = diffResult.sets.cubes;
      diff.textures = diffResult.sets.textures;
      diff.animations = diffResult.sets.animations;
    }
    this.rememberSnapshot(normalized, currentRevision);
    return ok({ diff });
  }

  selectProject(payload: { id?: string }): UsecaseResult<{ id: string; format: FormatKind; name: string | null; formatId?: string | null }> {
    const live = this.snapshotPort.readSnapshot();
    if (!live) {
      return fail({ code: 'invalid_state', message: 'No active project.' });
    }
    const normalized = this.normalizeSnapshot(live);
    const info = this.toProjectInfo(normalized);
    if (!info) {
      return fail({ code: 'invalid_state', message: 'No active project.' });
    }
    if (payload.id && payload.id !== info.id) {
      return fail({ code: 'invalid_payload', message: `Project not found: ${payload.id}` });
    }
    if (!normalized.format) {
      return fail({ code: 'invalid_state', message: 'Active project format is unknown.' });
    }
    normalized.id = info.id;
    const attachRes = this.session.attach(normalized);
    if (!attachRes.ok) return fail(attachRes.error);
    return ok({
      id: attachRes.data.id,
      format: normalized.format,
      name: normalized.name ?? null,
      formatId: normalized.formatId ?? null
    });
  }

  createProject(
    format: Capabilities['formats'][number]['format'],
    name: string,
    options?: { confirmDiscard?: boolean; dialog?: Record<string, unknown>; confirmDialog?: boolean; ifRevision?: string }
  ): UsecaseResult<{ id: string; format: string; name: string }> {
    const revisionErr = this.ensureRevisionMatch(options?.ifRevision);
    if (revisionErr) {
      return fail(revisionErr);
    }
    const capability = this.capabilities.formats.find((f) => f.format === format);
      if (!capability || !capability.enabled) {
        return fail({
          code: 'unsupported_format',
          message: `Unsupported format: ${format}`,
          fix: 'Use list_capabilities to pick an enabled format.'
        });
      }
      if (!name) {
        return fail({
          code: 'invalid_payload',
          message: 'Project name is required',
          fix: 'Provide a non-empty project name.'
        });
      }
      const formatId = resolveFormatId(format, this.formats.listFormats(), this.policies.formatOverrides);
      if (!formatId) {
        return fail({
          code: 'unsupported_format',
          message: withFormatOverrideHint(`No matching format ID for ${format}`),
          fix: 'Set a format ID override in settings or choose another format.'
        });
      }
    const { ifRevision: _ifRevision, ...editorOptions } = options ?? {};
    const effectiveConfirmDiscard = editorOptions.confirmDiscard ?? this.policies.autoDiscardUnsaved;
    const nextOptions =
      effectiveConfirmDiscard === undefined
        ? editorOptions
        : { ...editorOptions, confirmDiscard: effectiveConfirmDiscard };
    const err = this.editor.createProject(name, formatId, format, nextOptions);
    if (err) return fail(err);
    const result = this.session.create(format, name, formatId);
    if (!result.ok) {
      return fail(result.error);
    }
    return ok(result.data);
  }

  resetProject(payload?: { ifRevision?: string }): UsecaseResult<{ ok: true }> {
    const revisionErr = this.ensureRevisionMatch(payload?.ifRevision);
    if (revisionErr) return fail(revisionErr);
    const result = this.session.reset();
    return ok(result.data);
  }

  importTexture(payload: {
    id?: string;
    name: string;
    dataUri?: string;
    path?: string;
    ifRevision?: string;
  }): UsecaseResult<{ id: string; name: string; path?: string }> {
    const activeErr = this.ensureActive();
    if (activeErr) return fail(activeErr);
    const revisionErr = this.ensureRevisionMatch(payload.ifRevision);
    if (revisionErr) return fail(revisionErr);
    if (!payload.name) {
      return fail({ code: 'invalid_payload', message: 'Texture name is required' });
    }
    const snapshot = this.getSnapshot(this.policies.snapshotPolicy ?? 'hybrid');
    const nameConflict = snapshot.textures.some((t) => t.name === payload.name);
    if (nameConflict) {
      return fail({ code: 'invalid_payload', message: `Texture already exists: ${payload.name}` });
    }
    const id = payload.id ?? createId('tex');
    const idConflict = snapshot.textures.some((t) => t.id && t.id === id);
    if (idConflict) {
      return fail({ code: 'invalid_payload', message: `Texture id already exists: ${id}` });
    }
    const err = this.editor.importTexture({ id, name: payload.name, dataUri: payload.dataUri, path: payload.path });
    if (err) return fail(err);
    const match = this.editor
      .listTextures()
      .find((t) => (t.id && t.id === id) || t.name === payload.name);
    this.session.addTexture({
      id,
      name: payload.name,
      path: payload.path,
      width: match?.width,
      height: match?.height
    });
    return ok({ id, name: payload.name, path: payload.path });
  }

  updateTexture(payload: {
    id?: string;
    name?: string;
    newName?: string;
    dataUri?: string;
    path?: string;
    ifRevision?: string;
  }): UsecaseResult<{ id: string; name: string }> {
    const activeErr = this.ensureActive();
    if (activeErr) return fail(activeErr);
    const revisionErr = this.ensureRevisionMatch(payload.ifRevision);
    if (revisionErr) return fail(revisionErr);
    const snapshot = this.getSnapshot(this.policies.snapshotPolicy ?? 'hybrid');
      if (!payload.id && !payload.name) {
        return fail({
          code: 'invalid_payload',
          message: 'Texture id or name is required',
          fix: 'Provide id or name for the texture.'
        });
      }
    const target = resolveTextureTarget(snapshot.textures, payload.id, payload.name);
    if (!target) {
      const label = payload.id ?? payload.name ?? 'unknown';
      return fail({ code: 'invalid_payload', message: `Texture not found: ${label}` });
    }
    const targetName = target.name;
    const targetId = target.id ?? payload.id ?? createId('tex');
    if (payload.newName && payload.newName !== targetName) {
      const conflict = snapshot.textures.some((t) => t.name === payload.newName && t.name !== targetName);
      if (conflict) {
        return fail({ code: 'invalid_payload', message: `Texture already exists: ${payload.newName}` });
      }
    }
    const err = this.editor.updateTexture({
      id: targetId,
      name: targetName,
      newName: payload.newName,
      dataUri: payload.dataUri,
      path: payload.path
    });
    if (err) return fail(err);
    const effectiveName = payload.newName ?? targetName;
    const match = this.editor
      .listTextures()
      .find((t) => (t.id && t.id === targetId) || t.name === effectiveName);
    this.session.updateTexture(targetName, {
      id: targetId,
      newName: payload.newName,
      path: payload.path,
      width: match?.width,
      height: match?.height
    });
    return ok({ id: targetId, name: effectiveName });
  }

  deleteTexture(payload: { id?: string; name?: string; ifRevision?: string }): UsecaseResult<{ id: string; name: string }> {
    const activeErr = this.ensureActive();
    if (activeErr) return fail(activeErr);
    const revisionErr = this.ensureRevisionMatch(payload.ifRevision);
    if (revisionErr) return fail(revisionErr);
    const snapshot = this.getSnapshot(this.policies.snapshotPolicy ?? 'hybrid');
    if (!payload.id && !payload.name) {
      return fail({ code: 'invalid_payload', message: 'Texture id or name is required' });
    }
    const target = resolveTextureTarget(snapshot.textures, payload.id, payload.name);
    if (!target) {
      const label = payload.id ?? payload.name ?? 'unknown';
      return fail({ code: 'invalid_payload', message: `Texture not found: ${label}` });
    }
    const err = this.editor.deleteTexture({ id: target.id ?? payload.id, name: target.name });
    if (err) return fail(err);
    this.session.removeTextures([target.name]);
    return ok({ id: target.id ?? payload.id ?? target.name, name: target.name });
  }

  readTexture(payload: { id?: string; name?: string }): UsecaseResult<TextureSource> {
    const activeErr = this.ensureActive();
    if (activeErr) return fail(activeErr);
    if (!payload.id && !payload.name) {
      return fail({ code: 'invalid_payload', message: 'Texture id or name is required' });
    }
    const res = this.editor.readTexture({ id: payload.id, name: payload.name });
    if (res.error) return fail(res.error);
    return ok(res.result!);
  }

  addBone(payload: {
    id?: string;
    name: string;
    parent?: string;
    parentId?: string;
    pivot: [number, number, number];
    rotation?: [number, number, number];
    scale?: [number, number, number];
    ifRevision?: string;
  }): UsecaseResult<{ id: string; name: string }> {
    const activeErr = this.ensureActive();
    if (activeErr) return fail(activeErr);
    const revisionErr = this.ensureRevisionMatch(payload.ifRevision);
    if (revisionErr) return fail(revisionErr);
    const snapshot = this.getSnapshot(this.policies.snapshotPolicy ?? 'hybrid');
      if (!payload.name) {
        return fail({
          code: 'invalid_payload',
          message: 'Bone name is required',
          fix: 'Provide a non-empty bone name.'
        });
      }
    const parentName = payload.parentId
      ? resolveBoneNameById(snapshot.bones, payload.parentId)
      : payload.parent;
    if (payload.parentId && !parentName) {
      return fail({ code: 'invalid_payload', message: `Parent bone not found: ${payload.parentId}` });
    }
    const existing = snapshot.bones.find((b) => b.name === payload.name);
    if (existing) {
      return fail({ code: 'invalid_payload', message: `Bone already exists: ${payload.name}` });
    }
    const id = payload.id ?? createId('bone');
    const idConflict = snapshot.bones.some((b) => b.id && b.id === id);
    if (idConflict) {
      return fail({ code: 'invalid_payload', message: `Bone id already exists: ${id}` });
    }
    const err = this.editor.addBone({
      id,
      name: payload.name,
      parent: parentName,
      pivot: payload.pivot,
      rotation: payload.rotation,
      scale: payload.scale
    });
    if (err) return fail(err);
    this.session.addBone({
      id,
      name: payload.name,
      parent: parentName,
      pivot: payload.pivot,
      rotation: payload.rotation,
      scale: payload.scale
    });
    return ok({ id, name: payload.name });
  }

  updateBone(payload: {
    id?: string;
    name?: string;
    newName?: string;
    parent?: string;
    parentId?: string;
    parentRoot?: boolean;
    pivot?: [number, number, number];
    rotation?: [number, number, number];
    scale?: [number, number, number];
    ifRevision?: string;
  }): UsecaseResult<{ id: string; name: string }> {
    const activeErr = this.ensureActive();
    if (activeErr) return fail(activeErr);
    const revisionErr = this.ensureRevisionMatch(payload.ifRevision);
    if (revisionErr) return fail(revisionErr);
    const snapshot = this.getSnapshot(this.policies.snapshotPolicy ?? 'hybrid');
    if (!payload.id && !payload.name) {
      return fail({ code: 'invalid_payload', message: 'Bone id or name is required' });
    }
    const target = resolveBoneTarget(snapshot.bones, payload.id, payload.name);
    if (!target) {
      const label = payload.id ?? payload.name ?? 'unknown';
      return fail({ code: 'invalid_payload', message: `Bone not found: ${label}` });
    }
    const targetName = target.name;
    const targetId = target.id ?? payload.id ?? createId('bone');
    if (payload.newName && payload.newName !== targetName) {
      const conflict = snapshot.bones.some((b) => b.name === payload.newName && b.name !== targetName);
      if (conflict) {
        return fail({ code: 'invalid_payload', message: `Bone already exists: ${payload.newName}` });
      }
    }
    const parentUpdate =
      payload.parentRoot
        ? null
        : payload.parentId
          ? resolveBoneNameById(snapshot.bones, payload.parentId)
          : payload.parent !== undefined
            ? payload.parent
            : undefined;
    if (payload.parentId && !parentUpdate) {
      return fail({ code: 'invalid_payload', message: `Parent bone not found: ${payload.parentId}` });
    }
    if (typeof parentUpdate === 'string') {
      if (parentUpdate === targetName) {
        return fail({ code: 'invalid_payload', message: 'Bone cannot be parented to itself' });
      }
      const parentExists = snapshot.bones.some((b) => b.name === parentUpdate);
      if (!parentExists) {
        return fail({ code: 'invalid_payload', message: `Parent bone not found: ${parentUpdate}` });
      }
      if (isDescendantBone(snapshot.bones, targetName, parentUpdate)) {
        return fail({ code: 'invalid_payload', message: 'Bone cannot be parented to its descendant' });
      }
    }
    const parentForEditor = typeof parentUpdate === 'string' ? parentUpdate : undefined;
    const err = this.editor.updateBone({
      id: targetId,
      name: targetName,
      newName: payload.newName,
      parent: payload.parentRoot ? undefined : parentForEditor,
      parentRoot: payload.parentRoot,
      pivot: payload.pivot,
      rotation: payload.rotation,
      scale: payload.scale
    });
    if (err) return fail(err);
    this.session.updateBone(targetName, {
      id: targetId,
      newName: payload.newName,
      parent: parentUpdate,
      pivot: payload.pivot,
      rotation: payload.rotation,
      scale: payload.scale
    });
    return ok({ id: targetId, name: payload.newName ?? targetName });
  }

  deleteBone(payload: {
    id?: string;
    name?: string;
    ifRevision?: string;
  }): UsecaseResult<{ id: string; name: string; removedBones: number; removedCubes: number }> {
    const activeErr = this.ensureActive();
    if (activeErr) return fail(activeErr);
    const revisionErr = this.ensureRevisionMatch(payload.ifRevision);
    if (revisionErr) return fail(revisionErr);
    const snapshot = this.getSnapshot(this.policies.snapshotPolicy ?? 'hybrid');
    if (!payload.id && !payload.name) {
      return fail({ code: 'invalid_payload', message: 'Bone id or name is required' });
    }
    const target = resolveBoneTarget(snapshot.bones, payload.id, payload.name);
    if (!target) {
      const label = payload.id ?? payload.name ?? 'unknown';
      return fail({ code: 'invalid_payload', message: `Bone not found: ${label}` });
    }
    const descendants = collectDescendantBones(snapshot.bones, target.name);
    const boneSet = new Set<string>([target.name, ...descendants]);
    const err = this.editor.deleteBone({ id: target.id ?? payload.id, name: target.name });
    if (err) return fail(err);
    const removed = this.session.removeBones(boneSet);
    return ok({
      id: target.id ?? payload.id ?? target.name,
      name: target.name,
      removedBones: removed.removedBones,
      removedCubes: removed.removedCubes
    });
  }

  addCube(payload: {
    id?: string;
    name: string;
    from: [number, number, number];
    to: [number, number, number];
    bone?: string;
    boneId?: string;
    uv?: [number, number];
    inflate?: number;
    mirror?: boolean;
    ifRevision?: string;
  }): UsecaseResult<{ id: string; name: string }> {
    const activeErr = this.ensureActive();
    if (activeErr) return fail(activeErr);
    const revisionErr = this.ensureRevisionMatch(payload.ifRevision);
    if (revisionErr) return fail(revisionErr);
    const snapshot = this.getSnapshot(this.policies.snapshotPolicy ?? 'hybrid');
      if (!payload.name) {
        return fail({
          code: 'invalid_payload',
          message: 'Cube name is required',
          fix: 'Provide a non-empty cube name.'
        });
      }
      if (!payload.bone && !payload.boneId) {
        return fail({
          code: 'invalid_payload',
          message: 'Cube bone is required',
          fix: 'Provide bone or boneId to attach the cube.'
        });
      }
    const resolvedBone =
      payload.boneId ? resolveBoneNameById(snapshot.bones, payload.boneId) : payload.bone;
    if (!resolvedBone) {
      const label = payload.boneId ?? payload.bone;
      return fail({ code: 'invalid_payload', message: `Bone not found: ${label}` });
    }
    const boneExists = snapshot.bones.some((b) => b.name === resolvedBone);
    if (!boneExists) {
      return fail({ code: 'invalid_payload', message: `Bone not found: ${resolvedBone}` });
    }
    const existing = snapshot.cubes.find((c) => c.name === payload.name);
    if (existing) {
      return fail({ code: 'invalid_payload', message: `Cube already exists: ${payload.name}` });
    }
    const limitErr = this.ensureCubeLimit(1);
    if (limitErr) return fail(limitErr);
    const id = payload.id ?? createId('cube');
    const idConflict = snapshot.cubes.some((c) => c.id && c.id === id);
    if (idConflict) {
      return fail({ code: 'invalid_payload', message: `Cube id already exists: ${id}` });
    }
    const err = this.editor.addCube({
      id,
      name: payload.name,
      from: payload.from,
      to: payload.to,
      bone: resolvedBone,
      uv: payload.uv,
      inflate: payload.inflate,
      mirror: payload.mirror
    });
    if (err) return fail(err);
    this.session.addCube({
      id,
      name: payload.name,
      from: payload.from,
      to: payload.to,
      bone: resolvedBone,
      uv: payload.uv,
      inflate: payload.inflate,
      mirror: payload.mirror
    });
    return ok({ id, name: payload.name });
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
    uv?: [number, number];
    inflate?: number;
    mirror?: boolean;
    ifRevision?: string;
  }): UsecaseResult<{ id: string; name: string }> {
    const activeErr = this.ensureActive();
    if (activeErr) return fail(activeErr);
    const revisionErr = this.ensureRevisionMatch(payload.ifRevision);
    if (revisionErr) return fail(revisionErr);
    const snapshot = this.getSnapshot(this.policies.snapshotPolicy ?? 'hybrid');
    if (!payload.id && !payload.name) {
      return fail({ code: 'invalid_payload', message: 'Cube id or name is required' });
    }
    const target = resolveCubeTarget(snapshot.cubes, payload.id, payload.name);
    if (!target) {
      const label = payload.id ?? payload.name ?? 'unknown';
      return fail({ code: 'invalid_payload', message: `Cube not found: ${label}` });
    }
    const targetName = target.name;
    const targetId = target.id ?? payload.id ?? createId('cube');
    if (payload.newName && payload.newName !== targetName) {
      const conflict = snapshot.cubes.some((c) => c.name === payload.newName && c.name !== targetName);
      if (conflict) {
        return fail({ code: 'invalid_payload', message: `Cube already exists: ${payload.newName}` });
      }
    }
    const boneUpdate = payload.boneRoot
      ? 'root'
      : payload.boneId
        ? resolveBoneNameById(snapshot.bones, payload.boneId)
        : payload.bone !== undefined
          ? payload.bone
          : undefined;
    if (payload.boneId && !boneUpdate) {
      return fail({ code: 'invalid_payload', message: `Bone not found: ${payload.boneId}` });
    }
    if (typeof boneUpdate === 'string' && boneUpdate !== 'root') {
      const boneExists = snapshot.bones.some((b) => b.name === boneUpdate);
      if (!boneExists) {
        return fail({ code: 'invalid_payload', message: `Bone not found: ${boneUpdate}` });
      }
    }
    const err = this.editor.updateCube({
      id: targetId,
      name: targetName,
      newName: payload.newName,
      bone: payload.boneRoot ? undefined : typeof boneUpdate === 'string' ? boneUpdate : undefined,
      boneRoot: payload.boneRoot,
      from: payload.from,
      to: payload.to,
      uv: payload.uv,
      inflate: payload.inflate,
      mirror: payload.mirror
    });
    if (err) return fail(err);
    if (boneUpdate === 'root' && !snapshot.bones.some((b) => b.name === 'root')) {
      this.session.addBone({ id: createId('bone'), name: 'root', pivot: [0, 0, 0] });
    }
    this.session.updateCube(targetName, {
      id: targetId,
      newName: payload.newName,
      bone: boneUpdate,
      from: payload.from,
      to: payload.to,
      uv: payload.uv,
      inflate: payload.inflate,
      mirror: payload.mirror
    });
    return ok({ id: targetId, name: payload.newName ?? targetName });
  }

  deleteCube(payload: { id?: string; name?: string; ifRevision?: string }): UsecaseResult<{ id: string; name: string }> {
    const activeErr = this.ensureActive();
    if (activeErr) return fail(activeErr);
    const revisionErr = this.ensureRevisionMatch(payload.ifRevision);
    if (revisionErr) return fail(revisionErr);
    const snapshot = this.getSnapshot(this.policies.snapshotPolicy ?? 'hybrid');
    if (!payload.id && !payload.name) {
      return fail({ code: 'invalid_payload', message: 'Cube id or name is required' });
    }
    const target = resolveCubeTarget(snapshot.cubes, payload.id, payload.name);
    if (!target) {
      const label = payload.id ?? payload.name ?? 'unknown';
      return fail({ code: 'invalid_payload', message: `Cube not found: ${label}` });
    }
    const err = this.editor.deleteCube({ id: target.id ?? payload.id, name: target.name });
    if (err) return fail(err);
    this.session.removeCubes([target.name]);
    return ok({ id: target.id ?? payload.id ?? target.name, name: target.name });
  }

  applyRigTemplate(payload: { templateId: string; ifRevision?: string }): UsecaseResult<{ templateId: string }> {
    const activeErr = this.ensureActive();
    if (activeErr) return fail(activeErr);
    const revisionErr = this.ensureRevisionMatch(payload.ifRevision);
    if (revisionErr) return fail(revisionErr);
    const templateId = payload.templateId;
    if (!['empty', 'biped', 'quadruped', 'block_entity'].includes(templateId)) {
      return fail({ code: 'invalid_payload', message: `Unknown template: ${templateId}` });
    }
    const templateParts = buildRigTemplate(templateId as any, []);
    const cubeParts = templateParts.filter((part) => !isZeroSize(part.size));
    const limitErr = this.ensureCubeLimit(cubeParts.length);
    if (limitErr) return fail(limitErr);
    const snapshot = this.getSnapshot(this.policies.snapshotPolicy ?? 'hybrid');
    const existing = new Set(snapshot.bones.map((b) => b.name));
    let partsToAdd = templateParts;
    try {
      const merged = mergeRigParts(templateParts, existing, this.policies.rigMergeStrategy ?? 'skip_existing');
      partsToAdd = merged.parts;
    } catch (err) {
      const message = err instanceof Error ? err.message : 'rig template merge failed';
      return fail({ code: 'invalid_payload', message });
    }

    for (const part of partsToAdd) {
      const boneRes = this.addBone({
        name: part.id,
        parent: part.parent,
        pivot: part.pivot ?? [0, 0, 0]
      });
      if (!boneRes.ok) return boneRes;
      if (!isZeroSize(part.size)) {
        const from: [number, number, number] = [...part.offset];
        const to: [number, number, number] = [
          part.offset[0] + part.size[0],
          part.offset[1] + part.size[1],
          part.offset[2] + part.size[2]
        ];
        const cubeRes = this.addCube({
          name: part.id,
          from,
          to,
          bone: part.id,
          uv: part.uv,
          inflate: part.inflate,
          mirror: part.mirror
        });
        if (!cubeRes.ok) return cubeRes;
      }
    }
    return ok({ templateId });
  }

  createAnimationClip(payload: {
    id?: string;
    name: string;
    length: number;
    loop: boolean;
    fps: number;
    ifRevision?: string;
  }): UsecaseResult<{ id: string; name: string }> {
    const activeErr = this.ensureActive();
    if (activeErr) return fail(activeErr);
    const revisionErr = this.ensureRevisionMatch(payload.ifRevision);
    if (revisionErr) return fail(revisionErr);
    const format = this.session.snapshot().format;
    const capability = this.capabilities.formats.find((f) => f.format === format);
    if (!capability || !capability.animations) {
      return fail({ code: 'unsupported_format', message: 'Animations are not supported for this format' });
    }
    if (!payload.name) {
      return fail({ code: 'invalid_payload', message: 'Animation name is required' });
    }
    if (!Number.isFinite(payload.length) || payload.length <= 0) {
      return fail({ code: 'invalid_payload', message: 'Animation length must be > 0' });
    }
    if (!Number.isFinite(payload.fps) || payload.fps <= 0) {
      return fail({ code: 'invalid_payload', message: 'Animation fps must be > 0' });
    }
    if (payload.length > this.capabilities.limits.maxAnimationSeconds) {
      return fail({
        code: 'invalid_payload',
        message: `Animation length exceeds max ${this.capabilities.limits.maxAnimationSeconds} seconds`
      });
    }
    const snapshot = this.getSnapshot(this.policies.snapshotPolicy ?? 'hybrid');
    const nameConflict = snapshot.animations.some((a) => a.name === payload.name);
    if (nameConflict) {
      return fail({ code: 'invalid_payload', message: `Animation clip already exists: ${payload.name}` });
    }
    const id = payload.id ?? createId('anim');
    const idConflict = snapshot.animations.some((a) => a.id && a.id === id);
    if (idConflict) {
      return fail({ code: 'invalid_payload', message: `Animation id already exists: ${id}` });
    }
    const err = this.editor.createAnimation({
      id,
      name: payload.name,
      length: payload.length,
      loop: payload.loop,
      fps: payload.fps
    });
    if (err) return fail(err);
    this.session.addAnimation({
      id,
      name: payload.name,
      length: payload.length,
      loop: payload.loop,
      fps: payload.fps,
      channels: []
    });
    return ok({ id, name: payload.name });
  }

  updateAnimationClip(payload: {
    id?: string;
    name?: string;
    newName?: string;
    length?: number;
    loop?: boolean;
    fps?: number;
    ifRevision?: string;
  }): UsecaseResult<{ id: string; name: string }> {
    const activeErr = this.ensureActive();
    if (activeErr) return fail(activeErr);
    const revisionErr = this.ensureRevisionMatch(payload.ifRevision);
    if (revisionErr) return fail(revisionErr);
    const format = this.session.snapshot().format;
    const capability = this.capabilities.formats.find((f) => f.format === format);
    if (!capability || !capability.animations) {
      return fail({ code: 'unsupported_format', message: 'Animations are not supported for this format' });
    }
    const snapshot = this.getSnapshot(this.policies.snapshotPolicy ?? 'hybrid');
    if (!payload.id && !payload.name) {
      return fail({ code: 'invalid_payload', message: 'Animation clip id or name is required' });
    }
    const target = resolveAnimationTarget(snapshot.animations, payload.id, payload.name);
    if (!target) {
      const label = payload.id ?? payload.name ?? 'unknown';
      return fail({ code: 'invalid_payload', message: `Animation clip not found: ${label}` });
    }
    const targetName = target.name;
    const targetId = target.id ?? payload.id ?? createId('anim');
    if (payload.newName && payload.newName !== targetName) {
      const conflict = snapshot.animations.some((a) => a.name === payload.newName && a.name !== targetName);
      if (conflict) {
        return fail({ code: 'invalid_payload', message: `Animation clip already exists: ${payload.newName}` });
      }
    }
    if (payload.length !== undefined) {
      if (!Number.isFinite(payload.length) || payload.length <= 0) {
        return fail({ code: 'invalid_payload', message: 'Animation length must be > 0' });
      }
      if (payload.length > this.capabilities.limits.maxAnimationSeconds) {
        return fail({
          code: 'invalid_payload',
          message: `Animation length exceeds max ${this.capabilities.limits.maxAnimationSeconds} seconds`
        });
      }
    }
    if (payload.fps !== undefined && (!Number.isFinite(payload.fps) || payload.fps <= 0)) {
      return fail({ code: 'invalid_payload', message: 'Animation fps must be > 0' });
    }
    const err = this.editor.updateAnimation({
      id: targetId,
      name: targetName,
      newName: payload.newName,
      length: payload.length,
      loop: payload.loop,
      fps: payload.fps
    });
    if (err) return fail(err);
    this.session.updateAnimation(targetName, {
      id: targetId,
      newName: payload.newName,
      length: payload.length,
      loop: payload.loop,
      fps: payload.fps
    });
    return ok({ id: targetId, name: payload.newName ?? targetName });
  }

  deleteAnimationClip(payload: { id?: string; name?: string; ifRevision?: string }): UsecaseResult<{ id: string; name: string }> {
    const activeErr = this.ensureActive();
    if (activeErr) return fail(activeErr);
    const revisionErr = this.ensureRevisionMatch(payload.ifRevision);
    if (revisionErr) return fail(revisionErr);
    const format = this.session.snapshot().format;
    const capability = this.capabilities.formats.find((f) => f.format === format);
    if (!capability || !capability.animations) {
      return fail({ code: 'unsupported_format', message: 'Animations are not supported for this format' });
    }
    const snapshot = this.getSnapshot(this.policies.snapshotPolicy ?? 'hybrid');
    if (!payload.id && !payload.name) {
      return fail({ code: 'invalid_payload', message: 'Animation clip id or name is required' });
    }
    const target = resolveAnimationTarget(snapshot.animations, payload.id, payload.name);
    if (!target) {
      const label = payload.id ?? payload.name ?? 'unknown';
      return fail({ code: 'invalid_payload', message: `Animation clip not found: ${label}` });
    }
    const err = this.editor.deleteAnimation({ id: target.id ?? payload.id, name: target.name });
    if (err) return fail(err);
    this.session.removeAnimations([target.name]);
    return ok({ id: target.id ?? payload.id ?? target.name, name: target.name });
  }

  setKeyframes(payload: {
    clipId?: string;
    clip: string;
    bone: string;
    channel: 'rot' | 'pos' | 'scale';
    keys: { time: number; value: [number, number, number]; interp?: 'linear' | 'step' | 'catmullrom' }[];
    ifRevision?: string;
  }): UsecaseResult<{ clip: string; clipId?: string; bone: string }> {
    const activeErr = this.ensureActive();
    if (activeErr) return fail(activeErr);
    const revisionErr = this.ensureRevisionMatch(payload.ifRevision);
    if (revisionErr) return fail(revisionErr);
    const snapshot = this.getSnapshot(this.policies.snapshotPolicy ?? 'hybrid');
    const anim = resolveAnimationTarget(snapshot.animations, payload.clipId, payload.clip);
    if (!anim) {
      const label = payload.clipId ?? payload.clip;
      return fail({ code: 'invalid_payload', message: `Animation clip not found: ${label}` });
    }
    const err = this.editor.setKeyframes({
      clipId: anim.id,
      clip: anim.name,
      bone: payload.bone,
      channel: payload.channel,
      keys: payload.keys
    });
    if (err) return fail(err);
    this.session.upsertAnimationChannel(anim.name, {
      bone: payload.bone,
      channel: payload.channel,
      keys: payload.keys
    });
    return ok({ clip: anim.name, clipId: anim.id ?? undefined, bone: payload.bone });
  }

  exportModel(payload: ExportPayload): UsecaseResult<{ path: string }> {
    const activeErr = this.ensureActive();
    if (activeErr) return fail(activeErr);
    const exportPolicy = this.policies.exportPolicy ?? 'strict';
    const snapshot = this.getSnapshot(this.policies.snapshotPolicy ?? 'hybrid');
    const expectedFormat = exportFormatToCapability(payload.format);
    if (expectedFormat) {
      const formatCapability = this.capabilities.formats.find((f) => f.format === expectedFormat);
      if (!formatCapability || !formatCapability.enabled) {
        return fail({ code: 'unsupported_format', message: `Export format not enabled: ${expectedFormat}` });
      }
    }
    if (expectedFormat) {
      if (snapshot.format && snapshot.format !== expectedFormat) {
        return fail({ code: 'invalid_payload', message: 'Export format does not match active format' });
      }
      if (
        !snapshot.format &&
        snapshot.formatId &&
        !matchesFormatKind(expectedFormat, snapshot.formatId) &&
        this.matchOverrideKind(snapshot.formatId) !== expectedFormat
      ) {
        return fail({
          code: 'invalid_payload',
          message: withFormatOverrideHint('Export format does not match active format')
        });
      }
    }
    const formatId =
      snapshot.formatId ??
      (expectedFormat ? resolveFormatId(expectedFormat, this.formats.listFormats(), this.policies.formatOverrides) : null);
    if (!formatId) {
      return fail({ code: 'unsupported_format', message: withFormatOverrideHint('No matching format ID for export') });
    }
    const nativeErr = this.exporter.exportNative({ formatId, destPath: payload.destPath });
    if (!nativeErr) return ok({ path: payload.destPath });
    if (exportPolicy === 'strict') {
      return fail(nativeErr);
    }
    if (nativeErr.code !== 'not_implemented' && nativeErr.code !== 'unsupported_format') {
      return fail(nativeErr);
    }
    const bundle = buildInternalExport(payload.format, snapshot);
    const serialized = JSON.stringify(bundle.data, null, 2);
    const err = this.editor.writeFile(payload.destPath, serialized);
    if (err) return fail(err);
    return ok({ path: payload.destPath });
  }

  renderPreview(payload: RenderPreviewPayload): UsecaseResult<RenderPreviewResult> {
    const activeErr = this.ensureActive();
    if (activeErr) return fail(activeErr);
    const res = this.editor.renderPreview(payload);
    if (res.error) return fail(res.error);
    return ok(res.result!);
  }

  validate(): UsecaseResult<{ findings: { code: string; message: string; severity: 'error' | 'warning' | 'info' }[] }> {
    const activeErr = this.ensureActive();
    if (activeErr) return fail(activeErr);
    const snapshot = this.getSnapshot(this.policies.snapshotPolicy ?? 'hybrid');
    const textures = this.editor.listTextures();
    const findings = validateSnapshot(snapshot, { limits: this.capabilities.limits, textures });
    return ok({ findings });
  }

  private getSnapshot(policy: SnapshotPolicy) {
    const sessionSnapshot = this.session.snapshot();
    if (policy === 'session') return sessionSnapshot;
    const live = this.snapshotPort.readSnapshot();
    if (!live) {
      return this.normalizeSnapshot(sessionSnapshot);
    }
    const merged = policy === 'live' ? live : mergeSnapshots(sessionSnapshot, live);
    return this.normalizeSnapshot(merged);
  }

  private normalizeSnapshot(snapshot: SessionState): SessionState {
    const normalized = { ...snapshot };
    if (!normalized.formatId) {
      normalized.formatId = this.formats.getActiveFormatId();
    }
    if (!normalized.format && normalized.formatId) {
      const overrideKind = this.matchOverrideKind(normalized.formatId);
      if (overrideKind) {
        normalized.format = overrideKind;
        return normalized;
      }
      const kinds: FormatKind[] = ['animated_java', 'geckolib', 'vanilla'];
      const match = kinds.find((kind) => matchesFormatKind(kind, normalized.formatId));
      if (match) normalized.format = match;
    }
    return normalized;
  }

  private toProjectInfo(snapshot: SessionState): ProjectInfo | null {
    const hasData =
      snapshot.format ||
      snapshot.formatId ||
      snapshot.name ||
      snapshot.bones.length > 0 ||
      snapshot.cubes.length > 0 ||
      snapshot.textures.length > 0 ||
      snapshot.animations.length > 0;
    if (!hasData) return null;
    return {
      id: snapshot.id ?? 'active',
      name: snapshot.name ?? null,
      format: snapshot.format ?? null,
      formatId: snapshot.formatId ?? null
    };
  }

  private buildProjectState(snapshot: SessionState, detail: ProjectStateDetail, active: boolean): ProjectState {
    const normalized = snapshot;
    const counts = {
      bones: normalized.bones.length,
      cubes: normalized.cubes.length,
      textures: normalized.textures.length,
      animations: normalized.animations.length
    };
    const project: ProjectState = {
      id: active ? normalized.id ?? 'active' : 'none',
      active,
      name: normalized.name ?? null,
      format: normalized.format ?? null,
      formatId: normalized.formatId ?? null,
      dirty: normalized.dirty,
      revision: hashSnapshot(normalized),
      counts
    };
    if (detail === 'full') {
      project.bones = normalized.bones;
      project.cubes = normalized.cubes;
      project.textures = normalized.textures;
      project.animations = normalized.animations;
    }
    return project;
  }

  private rememberSnapshot(snapshot: SessionState, revision: string) {
    if (!revision) return;
    const cloned = cloneSnapshot(snapshot);
    if (!this.snapshotCache.has(revision)) {
      this.snapshotOrder.push(revision);
      if (this.snapshotOrder.length > this.snapshotCacheLimit) {
        const oldest = this.snapshotOrder.shift();
        if (oldest) this.snapshotCache.delete(oldest);
      }
    }
    this.snapshotCache.set(revision, cloned);
  }

  private ensureActive(): ToolError | null {
    const stateError = this.session.ensureActive();
    if (!stateError) return null;
    if (!this.policies.autoAttachActiveProject) {
      return {
        ...stateError,
        fix: 'Create a project (create_project) or select an active project before mutating.'
      };
    }
    const live = this.snapshotPort.readSnapshot();
    if (!live) {
      return {
        ...stateError,
        fix: 'Create a project (create_project) or select an active project before mutating.'
      };
    }
    const normalized = this.normalizeSnapshot(live);
    if (!this.toProjectInfo(normalized) || !normalized.format) {
      return {
        ...stateError,
        fix: 'Create a project (create_project) or select an active project before mutating.'
      };
    }
    const attachRes = this.session.attach(normalized);
    return attachRes.ok
      ? null
      : {
          ...attachRes.error,
          fix: 'Call get_project_state and retry, or create a new project.'
        };
  }

  private ensureRevisionMatch(expected?: string): ToolError | null {
    if (!this.policies.requireRevision) return null;
    if (this.revisionBypassDepth > 0) return null;
    const snapshot = this.getSnapshot(this.policies.snapshotPolicy ?? 'hybrid');
    const normalized = this.normalizeSnapshot(snapshot);
    const hasProject = Boolean(this.toProjectInfo(snapshot));
    const currentRevision = hashSnapshot(normalized);
    this.rememberSnapshot(normalized, currentRevision);
    if (!expected) {
      return {
        code: 'invalid_state',
        message: 'ifRevision is required. Call get_project_state before mutating.',
        fix: 'Call get_project_state and retry with ifRevision set to the returned revision.',
        details: { reason: 'missing_ifRevision', currentRevision, active: hasProject }
      };
    }
    if (currentRevision !== expected) {
      return {
        code: 'invalid_state',
        message: 'Project revision mismatch. Refresh project state before retrying.',
        fix: 'Call get_project_state and retry with the latest revision.',
        details: { expected, currentRevision }
      };
    }
    return null;
  }

  private ensureCubeLimit(increment: number): ToolError | null {
    const snapshot = this.getSnapshot(this.policies.snapshotPolicy ?? 'hybrid');
    const current = snapshot.cubes.length;
    const limit = this.capabilities.limits.maxCubes;
    if (current + increment > limit) {
      return { code: 'invalid_payload', message: `Cube limit exceeded (${limit})` };
    }
    return null;
  }

  private matchOverrideKind(formatId: string | null): FormatKind | null {
    if (!formatId) return null;
    const overrides = this.policies.formatOverrides;
    if (!overrides) return null;
    const entries = Object.entries(overrides) as Array<[FormatKind, string]>;
    const match = entries.find(([, id]) => id === formatId);
    return match ? match[0] : null;
  }
}

function hashSnapshot(snapshot: SessionState): string {
  const data = {
    id: snapshot.id ?? '',
    format: snapshot.format ?? '',
    formatId: snapshot.formatId ?? '',
    name: snapshot.name ?? '',
    dirty: snapshot.dirty ?? null,
    bones: snapshot.bones.map((b) => [
      b.id ?? '',
      b.name,
      b.parent ?? '',
      b.pivot,
      b.rotation ?? null,
      b.scale ?? null
    ]),
    cubes: snapshot.cubes.map((c) => [
      c.id ?? '',
      c.name,
      c.bone,
      c.from,
      c.to,
      c.uv ?? null,
      c.inflate ?? null,
      c.mirror ?? null
    ]),
    textures: snapshot.textures.map((t) => [t.id ?? '', t.name, t.path ?? '', t.width ?? 0, t.height ?? 0]),
    animations: snapshot.animations.map((a) => [
      a.id ?? '',
      a.name,
      a.length,
      a.loop,
      a.fps ?? null,
      a.channels?.length ?? 0
    ])
  };
  return hashString(JSON.stringify(data));
}

function hashString(value: string): string {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
}

function cloneSnapshot(snapshot: SessionState): SessionState {
  return {
    ...snapshot,
    bones: snapshot.bones.map((bone) => ({ ...bone })),
    cubes: snapshot.cubes.map((cube) => ({ ...cube })),
    textures: snapshot.textures.map((tex) => ({ ...tex })),
    animations: snapshot.animations.map((anim) => ({
      ...anim,
      channels: anim.channels ? anim.channels.map((ch) => ({ ...ch, keys: [...ch.keys] })) : undefined
    })),
    animationsStatus: snapshot.animationsStatus
  };
}

function resolveBoneNameById(bones: SessionState['bones'], id: string): string | null {
  const match = bones.find((bone) => bone.id === id);
  return match?.name ?? null;
}

function resolveBoneTarget(bones: SessionState['bones'], id?: string, name?: string) {
  if (id) {
    return bones.find((bone) => bone.id === id) ?? null;
  }
  if (name) {
    return bones.find((bone) => bone.name === name) ?? null;
  }
  return null;
}

function resolveCubeTarget(cubes: SessionState['cubes'], id?: string, name?: string) {
  if (id) {
    return cubes.find((cube) => cube.id === id) ?? null;
  }
  if (name) {
    return cubes.find((cube) => cube.name === name) ?? null;
  }
  return null;
}

function resolveTextureTarget(textures: SessionState['textures'], id?: string, name?: string) {
  if (id) {
    return textures.find((tex) => tex.id === id) ?? null;
  }
  if (name) {
    return textures.find((tex) => tex.name === name) ?? null;
  }
  return null;
}

function resolveAnimationTarget(animations: SessionState['animations'], id?: string, name?: string) {
  if (id) {
    return animations.find((anim) => anim.id === id) ?? null;
  }
  if (name) {
    return animations.find((anim) => anim.name === name) ?? null;
  }
  return null;
}

function collectDescendantBones(bones: SessionState['bones'], rootName: string): string[] {
  const childrenMap = new Map<string, string[]>();
  bones.forEach((bone) => {
    if (!bone.parent) return;
    const list = childrenMap.get(bone.parent) ?? [];
    list.push(bone.name);
    childrenMap.set(bone.parent, list);
  });
  const result: string[] = [];
  const queue = [...(childrenMap.get(rootName) ?? [])];
  while (queue.length > 0) {
    const next = queue.shift()!;
    result.push(next);
    const children = childrenMap.get(next);
    if (children && children.length > 0) {
      queue.push(...children);
    }
  }
  return result;
}

function isDescendantBone(bones: SessionState['bones'], rootName: string, candidateParent: string): boolean {
  const descendants = collectDescendantBones(bones, rootName);
  return descendants.includes(candidateParent);
}

function isZeroSize(size: [number, number, number]) {
  return size[0] === 0 && size[1] === 0 && size[2] === 0;
}

let idCounter = 0;

function createId(prefix: string): string {
  const cryptoApi = (globalThis as any).crypto;
  const uuid = cryptoApi?.randomUUID?.();
  if (uuid) return `${prefix}_${uuid}`;
  idCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${idCounter}`;
}

function exportFormatToCapability(format: ExportPayload['format']): FormatKind | null {
  switch (format) {
    case 'vanilla_json':
      return 'vanilla';
    case 'gecko_geo_anim':
      return 'geckolib';
    case 'animated_java':
      return 'animated_java';
    default:
      return null;
  }
}

export type SnapshotPolicy = 'session' | 'live' | 'hybrid';

export interface ToolPolicies {
  formatOverrides?: FormatOverrides;
  snapshotPolicy?: SnapshotPolicy;
  rigMergeStrategy?: RigMergeStrategy;
  exportPolicy?: ExportPolicy;
  autoDiscardUnsaved?: boolean;
  autoAttachActiveProject?: boolean;
  autoIncludeState?: boolean;
  requireRevision?: boolean;
}

export type ExportPolicy = 'strict' | 'best_effort';
