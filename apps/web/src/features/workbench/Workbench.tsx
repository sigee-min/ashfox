'use client';

import type { ExportAdapterInput } from '@ashfox/engine-core';

import { agentCommandProtocol } from '../agent/agentCommandProtocol';
import { useProjectFileActions } from '../files/actions';
import { BottomWorkspace } from './components/BottomWorkspace';
import { CreationStatusRail } from './components/CreationStatusRail';
import { ViewportWorkspace } from './components/ViewportWorkspace';
import { WorkbenchHeader } from './components/WorkbenchHeader';
import { WorkbenchToolbar } from './components/WorkbenchToolbar';
import {
  useWorkbenchAgentController
} from './controller/agent';
import {
  useWorkbenchProjectSession
} from './controller/project';
import {
  useWorkbenchViewController
} from './controller/view';
import {
  useWorkbenchShortcuts
} from './hooks/shortcuts';
import {
  useAgentAssetPresentation
} from './hooks/assets';

export function Workbench() {
  const project = useWorkbenchProjectSession();
  const view = useWorkbenchViewController({
    document: project.document,
    initialSelectionId: project.initialSelectionId,
    initialClipId: project.initialClipId
  });
  const files = useProjectFileActions({
    project: project.project,
    assets: project.assets,
    onLoad: project.replaceProject,
    operationLease: project.operationLease
  });
  useWorkbenchShortcuts({
    onTogglePlayback: view.togglePlayback
  });

  const presentation = useAgentAssetPresentation({
    project: project.project,
    report: project.report,
    visualReviews: project.visualReviews,
    storageStatus: project.storageStatus
  });

  const agent = useWorkbenchAgentController({
    project: project.project,
    projectGeneration: project.storage.generation,
    assets: project.assets,
    activity: project.history.activity,
    visualReviews: project.visualReviews,
    onRecordVisualReview: project.recordVisualReview,
    commandOutcomes: project.history.commandOutcomes,
    selectedNodeId: view.selectedNodeId,
    report: project.report,
    dispatch: project.dispatchProject,
    operationLease: project.operationLease,
    selectNode: view.selectNode,
    prepareView: view.prepareAgentView,
    setPlayhead: view.setPlayhead,
    setPlaying: view.setPlaying,
    capture: files.capture
  });

  return (
    <main
      className="workbench-shell"
      data-agent-command-port={agent.status}
      data-ashfox-agent-manifest={agentCommandProtocol.href}
      data-ashfox-revision={project.document.revision}
      data-ashfox-file-operation={files.operation.phase}
      data-ashfox-file-kind={files.operation.kind ?? ''}
      data-ashfox-file-operation-id={files.operation.operationId}
      onDragOver={(event) => event.preventDefault()}
      onDrop={files.drop}
    >
      <WorkbenchHeader
        document={project.document}
        fileOperation={files.operation}
        artifactFile={files.artifactFile}
        environment={view.environment}
        cameraMode={view.cameraCommand.mode}
        captureFile={files.captureFile}
        exportAvailability={presentation.exportAvailability}
        onOpen={files.open}
        onSave={files.save}
        onExport={(adapter: ExportAdapterInput) => {
          void files.exportTarget(adapter);
        }}
        onCapture={files.captureGif}
        onCancelFileOperation={files.cancel}
      />
      <CreationStatusRail status={presentation.status} />
      <WorkbenchToolbar
        cameraMode={view.cameraCommand.mode}
        onSetCamera={view.setCamera}
      />
      <ViewportWorkspace
        viewportDocument={agent.viewportDocument}
        assets={project.assets}
        viewportOptions={view.viewportOptions}
        environment={view.environment}
        cameraCommand={view.cameraCommand}
        viewportStats={view.viewportStats}
        activeClipId={view.activeClipId}
        playhead={view.playhead}
        playing={view.playing}
        presentationNonce={agent.presentationNonce}
        onEnvironmentChange={view.setEnvironment}
        agentStatus={agent.status}
        onStats={view.setViewportStats}
        onPresented={agent.onPresented}
      />
      <BottomWorkspace
        document={project.document}
        activeClipId={view.activeClipId}
        activeClip={view.activeClip}
        playhead={view.playhead}
        playing={view.playing}
        onActiveClipChange={view.changeActiveClip}
        onTogglePlayback={view.togglePlayback}
        onSeek={view.setPlayhead}
        onSelectNode={view.selectNode}
      />
    </main>
  );
}
