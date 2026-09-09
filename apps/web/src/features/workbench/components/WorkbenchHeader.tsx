import { useEffect, useRef, useState } from 'react';

import {
  type ExportAdapterInput,
  type ProjectDocument
} from '@ashfox/engine-core';

import type { ArtifactFile } from '../../files/artifactFile';
import type { FileOperationState } from '../../files/fileOperationState';
import { useArtifactUrl } from '../../files/useArtifactUrl';
import type { GifCaptureFile } from '../../capture/gifCaptureFile';
import type { GifCaptureRequest } from '../../capture/gifCaptureRequest';
import { Icon } from '../Icon';
import type { CameraMode } from '@ashfox/render-core/cameraPresets';
import type { ViewportEnvironmentId } from '@ashfox/render-core/viewportEnvironment';
import { BrandLogo } from './BrandLogo';
import { CaptureMenu } from './CaptureMenu';
import { ExportMenu } from './ExportMenu';
import { HeaderFileActions } from './header/HeaderFileActions';
import type {
  HeaderMenu,
  OpenHeaderMenu
} from './header/headerMenu';
import type {
  ExportAvailabilityViewModel
} from '../exportAvailability';

interface WorkbenchHeaderProps {
  document: ProjectDocument;
  fileOperation: FileOperationState<ArtifactFile>;
  artifactFile: ArtifactFile | null;
  environment: ViewportEnvironmentId;
  cameraMode: CameraMode;
  captureFile: GifCaptureFile | null;
  exportAvailability: ExportAvailabilityViewModel;
  onOpen: (file: File) => void;
  onSave: () => void;
  onExport: (adapter: ExportAdapterInput) => void;
  onCapture: (request: GifCaptureRequest) => void;
  onCancelFileOperation: () => void;
}

export function WorkbenchHeader({
  document,
  fileOperation,
  artifactFile,
  environment,
  cameraMode,
  captureFile,
  exportAvailability,
  onOpen,
  onSave,
  onExport,
  onCapture,
  onCancelFileOperation
}: WorkbenchHeaderProps) {
  const [activeMenu, setActiveMenu] = useState<HeaderMenu>(null);
  const openInputRef = useRef<HTMLInputElement>(null);
  const artifactAnchorRef = useRef<HTMLAnchorElement>(null);
  const artifactUrl = useArtifactUrl(artifactFile);
  const fileBusy = fileOperation.phase === 'running';

  useEffect(() => {
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') setActiveMenu(null);
    };
    window.addEventListener('keydown', closeOnEscape);
    return () => window.removeEventListener('keydown', closeOnEscape);
  }, []);

  const toggleMenu = (menu: OpenHeaderMenu): void => {
    setActiveMenu((current) => current === menu ? null : menu);
  };

  return (
    <header className="app-header">
      <div className="brand-mark" aria-label="ashfox">
        <BrandLogo />
        <span>ashfox</span>
      </div>
      <div className="header-divider" />
      <div className="project-path" aria-label="Current project">
        <span className="muted">Projects</span>
        <Icon name="chevron" />
        <strong>{document.name}</strong>
      </div>
      <div className="header-spacer" />
      <HeaderFileActions
        activeMenu={activeMenu}
        fileOperation={fileOperation}
        artifactFile={artifactFile}
        artifactUrl={artifactUrl}
        exportAvailability={exportAvailability}
        openInputRef={openInputRef}
        artifactAnchorRef={artifactAnchorRef}
        onToggleMenu={toggleMenu}
        onOpen={onOpen}
        onSave={onSave}
      />
      <span
        className="file-notice"
        aria-live="polite"
        data-ashfox-file-message
      >
        {fileOperation.message}
      </span>
      {activeMenu === 'export' ? (
        <ExportMenu
          document={document}
          busy={fileBusy}
          availability={exportAvailability}
          onExport={(adapter) => {
            onExport(adapter);
            setActiveMenu(null);
          }}
        />
      ) : null}
      {activeMenu === 'capture' ? (
        <CaptureMenu
          document={document}
          environment={environment}
          cameraMode={cameraMode}
          operation={fileOperation}
          captureFile={captureFile}
          blockedReason={exportAvailability.allowed
            ? null
            : exportAvailability.message}
          onCapture={onCapture}
          onCancel={onCancelFileOperation}
          onDownload={() => artifactAnchorRef.current?.click()}
          canDownload={artifactUrl !== null}
        />
      ) : null}
    </header>
  );
}
