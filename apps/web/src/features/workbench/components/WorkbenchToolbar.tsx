import type {
  CameraCommand
} from '../viewport/viewportTypes';

interface WorkbenchToolbarProps {
  readonly cameraMode: CameraCommand['mode'];
  readonly onSetCamera: (mode: CameraCommand['mode']) => void;
}

export function WorkbenchToolbar({
  cameraMode,
  onSetCamera
}: WorkbenchToolbarProps) {
  return (
    <div className="tool-strip observer-toolbar">
      <span className="view-label">View</span>
      <div className="camera-presets" aria-label="Camera presets">
        {(
          [
            ['perspective', 'Perspective'],
            ['front', 'Front'],
            ['left', 'Left'],
            ['right', 'Right'],
            ['top', 'Top']
          ] as const
        ).map(([mode, label]) => (
          <button
            type="button"
            className={cameraMode === mode ? 'is-active' : ''}
            key={mode}
            title={`${label} camera`}
            aria-label={`${label} camera`}
            onClick={() => onSetCamera(mode)}
          >
            {label}
          </button>
        ))}
      </div>
    </div>
  );
}
