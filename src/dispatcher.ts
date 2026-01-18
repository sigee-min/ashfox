import {
  Dispatcher,
  ProjectDiff,
  ProjectState,
  ProjectStateDetail,
  RenderPreviewResult,
  ToolError,
  ToolName,
  ToolPayloadMap,
  ToolResultMap,
  ToolResponse,
  ToolErrorCode
} from './types';
import { ProjectSession } from './session';
import { Capabilities } from './types';
import { ConsoleLogger } from './logging';
import { BlockbenchEditor } from './adapters/blockbench/BlockbenchEditor';
import { BlockbenchFormats } from './adapters/blockbench/BlockbenchFormats';
import { BlockbenchSnapshot } from './adapters/blockbench/BlockbenchSnapshot';
import { BlockbenchExport } from './adapters/blockbench/BlockbenchExport';
import { ToolService } from './usecases/ToolService';
import { UsecaseResult } from './usecases/result';
import { buildRenderPreviewContent, buildRenderPreviewStructured } from './mcp/content';
import { readBlockbenchGlobals } from './types/blockbench';

const respondOk = <T>(data: T): ToolResponse<T> => ({ ok: true, data });
const respondError = <T>(error: ToolError): ToolResponse<T> => ({ ok: false, error });
const respondErrorSimple = (
  code: ToolErrorCode,
  message: string,
  details?: Record<string, unknown>
): ToolResponse<unknown> => respondError({ code, message, details });

export class ToolDispatcherImpl implements Dispatcher {
  private readonly service: ToolService;
  private readonly includeStateByDefault: () => boolean;
  private readonly includeDiffByDefault: () => boolean;

  constructor(
    session: ProjectSession,
    capabilities: Capabilities,
    service?: ToolService,
    options?: { includeStateByDefault?: boolean | (() => boolean); includeDiffByDefault?: boolean | (() => boolean) }
  ) {
    if (service) {
      this.service = service;
    } else {
      const log = new ConsoleLogger('bbmcp-dispatcher', 'info');
      const editor = new BlockbenchEditor(log);
      const formats = new BlockbenchFormats();
      const snapshot = new BlockbenchSnapshot(log);
      const exporter = new BlockbenchExport(log);
      this.service = new ToolService({
        session,
        capabilities,
        editor,
        formats,
        snapshot,
        exporter,
        policies: { snapshotPolicy: 'hybrid', rigMergeStrategy: 'skip_existing', exportPolicy: 'strict' }
      });
    }
    const flag = options?.includeStateByDefault;
    this.includeStateByDefault = typeof flag === 'function' ? flag : () => Boolean(flag);
    const diffFlag = options?.includeDiffByDefault;
    this.includeDiffByDefault = typeof diffFlag === 'function' ? diffFlag : () => Boolean(diffFlag);
  }

  handle<TName extends ToolName>(
    name: TName,
    payload: ToolPayloadMap[TName]
  ): ToolResponse<ToolResultMap[TName]> {
    try {
      switch (name) {
        case 'list_capabilities':
          return respondOk(this.service.listCapabilities()) as ToolResponse<ToolResultMap[TName]>;
        case 'reload_plugin':
          return this.handleReloadPlugin() as ToolResponse<ToolResultMap[TName]>;
        case 'get_project_state':
          return toToolResponse(this.service.getProjectState(payload)) as ToolResponse<ToolResultMap[TName]>;
        case 'get_project_diff':
          return toToolResponse(this.service.getProjectDiff(payload)) as ToolResponse<ToolResultMap[TName]>;
        case 'list_projects':
          return toToolResponse(this.service.listProjects()) as ToolResponse<ToolResultMap[TName]>;
        case 'select_project':
          return this.attachState(payload, this.handleSelectProject(payload)) as ToolResponse<ToolResultMap[TName]>;
        case 'create_project':
          return this.attachState(payload, this.handleCreateProject(payload)) as ToolResponse<ToolResultMap[TName]>;
        case 'reset_project':
          return this.attachState(payload, this.handleResetProject(payload)) as ToolResponse<ToolResultMap[TName]>;
        case 'import_texture':
          return this.attachState(
            payload,
            toToolResponse(this.service.importTexture(payload))
          ) as ToolResponse<ToolResultMap[TName]>;
        case 'update_texture':
          return this.attachState(
            payload,
            toToolResponse(this.service.updateTexture(payload))
          ) as ToolResponse<ToolResultMap[TName]>;
        case 'delete_texture':
          return this.attachState(
            payload,
            toToolResponse(this.service.deleteTexture(payload))
          ) as ToolResponse<ToolResultMap[TName]>;
        case 'add_bone':
          return this.attachState(
            payload,
            toToolResponse(this.service.addBone(payload))
          ) as ToolResponse<ToolResultMap[TName]>;
        case 'update_bone':
          return this.attachState(
            payload,
            toToolResponse(this.service.updateBone(payload))
          ) as ToolResponse<ToolResultMap[TName]>;
        case 'delete_bone':
          return this.attachState(
            payload,
            toToolResponse(this.service.deleteBone(payload))
          ) as ToolResponse<ToolResultMap[TName]>;
        case 'add_cube':
          return this.attachState(
            payload,
            toToolResponse(this.service.addCube(payload))
          ) as ToolResponse<ToolResultMap[TName]>;
        case 'update_cube':
          return this.attachState(
            payload,
            toToolResponse(this.service.updateCube(payload))
          ) as ToolResponse<ToolResultMap[TName]>;
        case 'delete_cube':
          return this.attachState(
            payload,
            toToolResponse(this.service.deleteCube(payload))
          ) as ToolResponse<ToolResultMap[TName]>;
        case 'apply_rig_template':
          return this.attachState(
            payload,
            toToolResponse(this.service.applyRigTemplate(payload))
          ) as ToolResponse<ToolResultMap[TName]>;
        case 'create_animation_clip':
          return this.attachState(
            payload,
            toToolResponse(this.service.createAnimationClip(payload))
          ) as ToolResponse<ToolResultMap[TName]>;
        case 'update_animation_clip':
          return this.attachState(
            payload,
            toToolResponse(this.service.updateAnimationClip(payload))
          ) as ToolResponse<ToolResultMap[TName]>;
        case 'delete_animation_clip':
          return this.attachState(
            payload,
            toToolResponse(this.service.deleteAnimationClip(payload))
          ) as ToolResponse<ToolResultMap[TName]>;
        case 'set_keyframes':
          return this.attachState(
            payload,
            toToolResponse(this.service.setKeyframes(payload))
          ) as ToolResponse<ToolResultMap[TName]>;
        case 'export':
          return this.attachState(
            payload,
            toToolResponse(this.service.exportModel(payload))
          ) as ToolResponse<ToolResultMap[TName]>;
        case 'render_preview':
          return attachRenderPreviewContent(
            this.attachState(payload, toToolResponse(this.service.renderPreview(payload)))
          ) as ToolResponse<ToolResultMap[TName]>;
        case 'validate':
          return this.attachState(
            payload,
            toToolResponse(this.service.validate())
          ) as ToolResponse<ToolResultMap[TName]>;
        default:
          return respondErrorSimple('unknown', `Unknown tool ${String(name)}`) as ToolResponse<ToolResultMap[TName]>;
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'unknown error';
      return respondErrorSimple('unknown', message) as ToolResponse<ToolResultMap[TName]>;
    }
  }

  private handleCreateProject(payload: ToolPayloadMap['create_project']) {
    const hasOptions =
      payload.confirmDiscard !== undefined ||
      payload.dialog !== undefined ||
      payload.confirmDialog !== undefined ||
      payload.ifRevision !== undefined;
    const result = this.service.createProject(
      payload.format,
      payload.name,
      hasOptions
        ? {
            confirmDiscard: payload.confirmDiscard,
            dialog: payload.dialog,
            confirmDialog: payload.confirmDialog,
            ifRevision: payload.ifRevision
          }
        : undefined
    );
    if (result.ok) {
      const bb = readBlockbenchGlobals().Blockbench;
      bb?.dispatchEvent?.('new_project', { name: payload.name, format: payload.format });
      bb?.showQuickMessage?.(`bbmcp project created: ${payload.name} (${payload.format})`, 1200);
    }
    return toToolResponse(result);
  }

  private handleSelectProject(payload: ToolPayloadMap['select_project']) {
    const result = this.service.selectProject(payload);
    if (result.ok) {
      const bb = readBlockbenchGlobals().Blockbench;
      const label = result.value.name ?? 'current';
      bb?.showQuickMessage?.(`bbmcp attached to project: ${label}`, 1200);
    }
    return toToolResponse(result);
  }

  private handleResetProject(payload: ToolPayloadMap['reset_project']) {
    const result = this.service.resetProject(payload);
    return toToolResponse(result);
  }

  private handleReloadPlugin(): ToolResponse<{ ok: true }> {
    const globals = readBlockbenchGlobals();
    const plugins = globals.Plugins;
    const blockbench = globals.Blockbench;
    if (typeof plugins?.devReload !== 'function') {
      return respondErrorSimple('not_implemented', 'Plugin reload is not available in this build.');
    }
    setTimeout(() => {
      try {
        plugins.devReload();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.error('[bbmcp] plugin reload failed', message);
      }
    }, 50);
    blockbench?.showQuickMessage?.('bbmcp reload requested', 1200);
    return respondOk({ ok: true });
  }

  private attachState<
    TPayload extends { includeState?: boolean; includeDiff?: boolean; diffDetail?: ProjectStateDetail; ifRevision?: string },
    TResult
  >(
    payload: TPayload,
    response: ToolResponse<TResult>
  ): ToolResponse<TResult & { state?: ProjectState | null; diff?: ProjectDiff | null }> {
    const shouldIncludeState = payload?.includeState ?? this.includeStateByDefault();
    const shouldIncludeDiff = payload?.includeDiff ?? this.includeDiffByDefault();
    const shouldIncludeRevision = true;
    if (!shouldIncludeState && !shouldIncludeDiff && !shouldIncludeRevision) {
      return response as ToolResponse<TResult & { state?: ProjectState | null; diff?: ProjectDiff | null }>;
    }
    const state = this.service.getProjectState({ detail: 'summary' });
    const project = state.ok ? state.value.project : null;
    const revision = project?.revision;
    let diffValue: ProjectDiff | null | undefined;
    if (shouldIncludeDiff) {
      if (payload?.ifRevision) {
        const diff = this.service.getProjectDiff({
          sinceRevision: payload.ifRevision,
          detail: payload.diffDetail ?? 'summary'
        });
        diffValue = diff.ok ? diff.value.diff : null;
      } else {
        diffValue = null;
      }
    }
    if (response.ok) {
      return {
        ok: true,
        ...(response.content ? { content: response.content } : {}),
        ...(response.structuredContent ? { structuredContent: response.structuredContent } : {}),
        data: {
          ...(response.data as Record<string, unknown>),
          ...(shouldIncludeRevision && revision ? { revision } : {}),
          ...(shouldIncludeState ? { state: project } : {}),
          ...(shouldIncludeDiff ? { diff: diffValue ?? null } : {})
        }
      };
    }
    const details: Record<string, unknown> = { ...(response.error.details ?? {}) };
    if (shouldIncludeRevision && revision) {
      details.revision = revision;
    }
    if (shouldIncludeState) {
      details.state = project;
    }
    if (shouldIncludeDiff) {
      details.diff = diffValue ?? null;
    }
    return {
      ok: false,
      ...(response.content ? { content: response.content } : {}),
      ...(response.structuredContent ? { structuredContent: response.structuredContent } : {}),
      error: { ...response.error, details }
    };
  }
}

function toToolResponse<T>(result: UsecaseResult<T>): ToolResponse<T> {
  if (result.ok) return respondOk(result.value);
  return respondError(result.error);
}

function attachRenderPreviewContent(
  response: ToolResponse<RenderPreviewResult>
): ToolResponse<RenderPreviewResult> {
  if (!response.ok) return response;
  const content = buildRenderPreviewContent(response.data);
  const structuredContent = buildRenderPreviewStructured(response.data);
  if (!content.length) {
    return { ...response, structuredContent };
  }
  return { ...response, content, structuredContent };
}
