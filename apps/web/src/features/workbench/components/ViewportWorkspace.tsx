import type {
  ProjectDocument
} from '@ashfox/engine-core';

import type {
  ProjectAssets
} from '@ashfox/render-core/assets';
import type {
  ViewportEnvironmentId
} from '@ashfox/render-core/viewportEnvironment';
import type {
  AgentCommandPortStatus
} from '../../agent/AgentCommandPort';
import { Icon } from '../Icon';
import { presentAgentConnection } from '../presentation/connection';
import { Viewport } from '../Viewport';
import type {
  CameraCommand,
  ViewportOptions,
  ViewportPresentationFrame,
  ViewportStats
} from '../viewport/viewportTypes';
import { ViewportEnvironmentToggle } from './viewport/Environment';

interface ViewportWorkspaceProps {
  readonly viewportDocument: Readonly<ProjectDocument>;
  readonly assets: ProjectAssets;
  readonly viewportOptions: ViewportOptions;
  readonly environment: ViewportEnvironmentId;
  readonly cameraCommand: CameraCommand;
  readonly viewportStats: ViewportStats;
  readonly activeClipId: string | null;
  readonly playhead: number;
  readonly playing: boolean;
  readonly presentationNonce: number;
  readonly agentStatus: AgentCommandPortStatus;
  readonly onEnvironmentChange: (environment: ViewportEnvironmentId) => void;
  readonly onStats: (stats: ViewportStats) => void;
  readonly onPresented: (frame: ViewportPresentationFrame) => void;
}

const ignoreSelection = (): void => undefined;

export function ViewportWorkspace({
  viewportDocument,
  assets,
  viewportOptions,
  environment,
  cameraCommand,
  viewportStats,
  activeClipId,
  playhead,
  playing,
  presentationNonce,
  agentStatus,
  onEnvironmentChange,
  onStats,
  onPresented
}: ViewportWorkspaceProps) {
  return (
    <section className="workspace-grid">
      <section className="viewport-panel">
        <Viewport
          document={viewportDocument}
          assets={assets}
          options={viewportOptions}
          environment={environment}
          cameraCommand={cameraCommand}
          activeClipId={activeClipId}
          playhead={playhead}
          playing={playing}
          presentationNonce={presentationNonce}
          onSelectNode={ignoreSelection}
          onStats={onStats}
          onPresented={onPresented}
        />
        {Object.keys(viewportDocument.scene.nodes).length === 0 ? (
          <section className="empty-creation-guide" aria-label="Create your first asset">
            <span className={`agent-connection is-${agentStatus}`}>
              {presentAgentConnection(agentStatus)}
            </span>
            <h1>Describe what you want in chat</h1>
            <p>
              The AI writes, validates, compiles, and reviews the asset. You
              only need to watch the result and ask for changes.
            </p>
            <ol>
              <li><strong>1</strong><span>Prompt in chat</span></li>
              <li><strong>2</strong><span>Watch the build</span></li>
              <li><strong>3</strong><span>Export or capture</span></li>
            </ol>
          </section>
        ) : null}
        <div className="viewport-top-left">
          <div className="view-chip">
            <Icon name="camera" />
            {cameraCommand.mode}
          </div>
        </div>
        <div className="viewport-top-right">
          <div className="render-stats">
            <span>{viewportStats.triangles.toLocaleString()} tris</span>
            <span>{viewportStats.calls} draws</span>
          </div>
          <ViewportEnvironmentToggle
            value={environment}
            onChange={onEnvironmentChange}
          />
        </div>
      </section>
    </section>
  );
}
