import type { FormatKind, ToolError, ToolResponse } from '../types';
import { err } from '../shared/tooling/toolResponse';
import { PROJECT_NO_ACTIVE } from '../shared/messages';
import type { ProjectMeta, SessionState } from './types';
import { cloneAnimations, cloneProjectMeta } from './clone';

const createEmptyState = (): SessionState => ({
  id: null,
  format: null,
  formatId: null,
  name: null,
  dirty: undefined,
  meta: undefined,
  bones: [],
  cubes: [],
  textures: [],
  animations: [],
  animationsStatus: 'available'
});

export class SessionStateStore {
  private state: SessionState = createEmptyState();

  create(format: FormatKind, name: string, formatId?: string | null): ToolResponse<{ id: string; format: FormatKind; name: string }> {
    const id = `${Date.now()}`;
    this.state = {
      id,
      format,
      formatId: formatId ?? null,
      name,
      dirty: undefined,
      meta: undefined,
      bones: [],
      cubes: [],
      textures: [],
      animations: [],
      animationsStatus: 'available'
    };
    return { ok: true, data: { id, format, name } };
  }

  attach(snapshot: SessionState): ToolResponse<{ id: string; format: FormatKind; name: string | null }> {
    if (!snapshot.format) {
      return err<{ id: string; format: FormatKind; name: string | null }>('invalid_state', PROJECT_NO_ACTIVE);
    }
    const id = snapshot.id ?? `${Date.now()}`;
    const format = snapshot.format;
    const name = snapshot.name ?? null;
    this.state = {
      id,
      format,
      formatId: snapshot.formatId ?? null,
      name,
      dirty: snapshot.dirty,
      meta: cloneProjectMeta(snapshot.meta),
      bones: [...snapshot.bones],
      cubes: [...snapshot.cubes],
      textures: [...snapshot.textures],
      animations: cloneAnimations(snapshot.animations),
      animationsStatus: snapshot.animationsStatus ?? 'available'
    };
    return { ok: true, data: { id, format, name } };
  }

  reset(): ToolResponse<{ ok: true }> {
    this.state = createEmptyState();
    return { ok: true, data: { ok: true } };
  }

  snapshot(): SessionState {
    return {
      ...this.state,
      meta: cloneProjectMeta(this.state.meta),
      bones: [...this.state.bones],
      cubes: [...this.state.cubes],
      textures: [...this.state.textures],
      animations: cloneAnimations(this.state.animations),
      animationsStatus: this.state.animationsStatus
    };
  }

  ensureActive(): ToolError | null {
    if (!this.state.id || !this.state.format) {
      return { code: 'invalid_state', message: PROJECT_NO_ACTIVE, details: { reason: 'no_active_project' } };
    }
    return null;
  }

  updateMeta(meta: ProjectMeta) {
    this.state.meta = {
      ...(this.state.meta ?? {}),
      ...cloneProjectMeta(meta)
    };
  }

  getState(): SessionState {
    return this.state;
  }
}
