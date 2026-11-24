import {
  FormatKind,
  FORMAT_KINDS,
  ProjectInfo,
  ProjectState,
  ProjectStateDetail,
} from '@ashfox/blockbench-contracts/types/internal';
import { FormatPort } from '../../ports/formats';
import { FormatOverrides, matchesFormatKind } from '../formats';
import { SessionState } from '../../session';
import {
  cloneTrackedAnimation,
  cloneTrackedBone,
  cloneTrackedCube,
  cloneTrackedMesh,
  cloneTrackedTexture,
} from './snapshotClone';

export class ProjectStateBuilder {
  private readonly formats: FormatPort;
  private readonly overrides?: FormatOverrides;

  constructor(formats: FormatPort, overrides?: FormatOverrides) {
    this.formats = formats;
    this.overrides = overrides;
  }

  normalize(snapshot: SessionState): SessionState {
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
      const match = FORMAT_KINDS.find((kind) => matchesFormatKind(kind, normalized.formatId));
      if (match) normalized.format = match;
    }
    return normalized;
  }

  toProjectInfo(snapshot: SessionState): ProjectInfo | null {
    const hasData =
      snapshot.format ||
      snapshot.formatId ||
      snapshot.name ||
      snapshot.bones.length > 0 ||
      snapshot.cubes.length > 0 ||
      (snapshot.meshes?.length ?? 0) > 0 ||
      snapshot.textures.length > 0 ||
      snapshot.animations.length > 0;
    if (!hasData) return null;
    return {
      id: snapshot.id ?? 'active',
      name: snapshot.name ?? null,
      format: snapshot.format ?? null,
      formatId: snapshot.formatId ?? null,
    };
  }

  buildProjectState(
    snapshot: SessionState,
    detail: ProjectStateDetail,
    active: boolean,
    revision: string,
  ): ProjectState {
    const counts = {
      bones: snapshot.bones.length,
      cubes: snapshot.cubes.length,
      meshes: snapshot.meshes?.length ?? 0,
      meshVertices: (snapshot.meshes ?? []).reduce((acc, mesh) => acc + mesh.vertices.length, 0),
      meshFaces: (snapshot.meshes ?? []).reduce((acc, mesh) => acc + mesh.faces.length, 0),
      textures: snapshot.textures.length,
      animations: snapshot.animations.length,
    };
    return {
      id: active ? (snapshot.id ?? 'active') : 'none',
      active,
      name: snapshot.name ?? null,
      format: snapshot.format ?? null,
      formatId: snapshot.formatId ?? null,
      revision,
      ...(snapshot.dirty !== undefined ? { dirty: snapshot.dirty } : {}),
      ...(snapshot.uvPixelsPerBlock !== undefined
        ? { uvPixelsPerBlock: snapshot.uvPixelsPerBlock }
        : {}),
      counts,
      ...(snapshot.textures.length > 0
        ? { textures: snapshot.textures.map(cloneTrackedTexture) }
        : {}),
      ...(detail === 'full'
        ? {
            bones: snapshot.bones.map(cloneTrackedBone),
            cubes: snapshot.cubes.map(cloneTrackedCube),
            ...(snapshot.meshes !== undefined
              ? { meshes: snapshot.meshes.map(cloneTrackedMesh) }
              : {}),
            animations: snapshot.animations.map(cloneTrackedAnimation),
          }
        : {}),
    };
  }

  matchOverrideKind(formatId: string | null): FormatKind | null {
    if (!formatId) return null;
    const overrides = this.overrides;
    if (!overrides) return null;
    const entries = Object.entries(overrides) as Array<[FormatKind, string]>;
    const match = entries.find(([, id]) => id === formatId);
    return match ? match[0] : null;
  }
}
