import type {
  FormatKind,
  ToolError,
  ToolResponse,
} from '@ashfox/blockbench-contracts/types/internal';
import { err } from '../shared/tooling/toolResponse';
import { PROJECT_NO_ACTIVE } from '../shared/messages';
import type { SessionState } from './types';
import { resolveAnimationTimePolicy } from '../domain/animation/timePolicy';
import { sessionStateCloner, type SessionStateCloner } from './clone';

const createEmptyState = (policy = resolveAnimationTimePolicy()): SessionState => ({
  id: null,
  format: null,
  formatId: null,
  name: null,
  dirty: undefined,
  uvPixelsPerBlock: undefined,
  bones: [],
  cubes: [],
  meshes: [],
  textures: [],
  animations: [],
  animationsStatus: 'available',
  animationTimePolicy: { ...policy },
});

export class SessionStateStore {
  private state: SessionState = createEmptyState();

  constructor(private readonly cloner: SessionStateCloner = sessionStateCloner) {}

  create(
    format: FormatKind,
    name: string,
    formatId?: string | null,
  ): ToolResponse<{ id: string; format: FormatKind; name: string }> {
    const id = `${Date.now()}`;
    const animationTimePolicy = { ...this.state.animationTimePolicy };
    this.state = {
      id,
      format,
      formatId: formatId ?? null,
      name,
      dirty: undefined,
      uvPixelsPerBlock: undefined,
      bones: [],
      cubes: [],
      meshes: [],
      textures: [],
      animations: [],
      animationsStatus: 'available',
      animationTimePolicy,
    };
    return { ok: true, data: { id, format, name } };
  }

  attach(
    snapshot: SessionState,
  ): ToolResponse<{ id: string; format: FormatKind; name: string | null }> {
    if (!snapshot.format) {
      return err<{ id: string; format: FormatKind; name: string | null }>(
        'invalid_state',
        PROJECT_NO_ACTIVE,
      );
    }
    const cloned = this.cloner.state(snapshot);
    const id = cloned.id ?? `${Date.now()}`;
    const format = snapshot.format;
    const name = cloned.name ?? null;
    const animationTimePolicy = resolveAnimationTimePolicy(
      cloned.animationTimePolicy ?? this.state.animationTimePolicy,
    );
    this.state = {
      id,
      format,
      formatId: cloned.formatId ?? null,
      name,
      dirty: cloned.dirty,
      uvPixelsPerBlock: cloned.uvPixelsPerBlock,
      bones: cloned.bones,
      cubes: cloned.cubes,
      meshes: cloned.meshes ?? [],
      textures: cloned.textures,
      animations: cloned.animations,
      animationsStatus: cloned.animationsStatus ?? 'available',
      animationTimePolicy,
    };
    return { ok: true, data: { id, format, name } };
  }

  reset(): ToolResponse<{ ok: true }> {
    this.state = createEmptyState(this.state.animationTimePolicy);
    return { ok: true, data: { ok: true } };
  }

  snapshot(): SessionState {
    return this.cloner.state(this.state);
  }

  ensureActive(): ToolError | null {
    if (!this.state.id || !this.state.format) {
      return {
        code: 'invalid_state',
        message: PROJECT_NO_ACTIVE,
        details: { reason: 'no_active_project' },
      };
    }
    return null;
  }

  getState(): SessionState {
    return this.state;
  }

  setAnimationTimePolicy(policy?: Partial<typeof this.state.animationTimePolicy>) {
    if (!policy) return;
    this.state.animationTimePolicy = resolveAnimationTimePolicy({
      ...this.state.animationTimePolicy,
      ...policy,
    });
  }

  setUvPixelsPerBlock(value?: number) {
    this.state.uvPixelsPerBlock = value;
  }
}
