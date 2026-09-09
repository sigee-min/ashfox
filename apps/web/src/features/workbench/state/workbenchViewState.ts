import type {
  CameraCommand,
  ViewportOptions
} from '../viewport/viewportTypes';
import type {
  ViewportEnvironmentId
} from '@ashfox/render-core/viewportEnvironment';

export type WorkbenchOverlay = 'scene' | 'inspector' | null;
export type BottomWorkspaceMode = 'animation' | 'activity';

export interface WorkbenchViewState {
  preferredNodeId: string | null;
  preferredClipId: string | null;
  viewportOptions: ViewportOptions;
  environment: ViewportEnvironmentId;
  cameraCommand: CameraCommand;
  activeOverlay: WorkbenchOverlay;
  bottomMode: BottomWorkspaceMode;
}

export type WorkbenchViewAction =
  | { type: 'node.select'; nodeId: string | null }
  | { type: 'clip.select'; clipId: string | null }
  | { type: 'viewport.toggle'; option: keyof ViewportOptions }
  | { type: 'environment.set'; environment: ViewportEnvironmentId }
  | { type: 'camera.set'; mode: CameraCommand['mode'] }
  | { type: 'overlay.set'; overlay: WorkbenchOverlay }
  | { type: 'bottom.set'; mode: BottomWorkspaceMode };

export const createWorkbenchViewState = (
  preferredNodeId: string | null,
  preferredClipId: string | null
): WorkbenchViewState => ({
  preferredNodeId,
  preferredClipId,
  viewportOptions: {
    showGrid: true,
    showSkeleton: false,
    showWireframe: false
  },
  environment: 'studio',
  cameraCommand: {
    mode: 'perspective',
    nonce: 0
  },
  activeOverlay: null,
  bottomMode: 'animation'
});

export const workbenchViewReducer = (
  state: WorkbenchViewState,
  action: WorkbenchViewAction
): WorkbenchViewState => {
  switch (action.type) {
    case 'node.select':
      return { ...state, preferredNodeId: action.nodeId };
    case 'clip.select':
      return { ...state, preferredClipId: action.clipId };
    case 'viewport.toggle':
      return {
        ...state,
        viewportOptions: {
          ...state.viewportOptions,
          [action.option]: !state.viewportOptions[action.option]
        }
      };
    case 'environment.set':
      return { ...state, environment: action.environment };
    case 'camera.set':
      return {
        ...state,
        cameraCommand: {
          mode: action.mode,
          nonce: state.cameraCommand.nonce + 1
        }
      };
    case 'overlay.set':
      return { ...state, activeOverlay: action.overlay };
    case 'bottom.set':
      return { ...state, bottomMode: action.mode };
  }
};
