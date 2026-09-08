import type {
  AnimationClip,
  ProjectDocument
} from '@ashfox/engine-core';

import { Icon } from '../Icon';
import { AnimationTimeline } from './AnimationTimeline';

interface BottomWorkspaceProps {
  readonly document: ProjectDocument;
  readonly activeClipId: string | null;
  readonly activeClip: AnimationClip | undefined;
  readonly playhead: number;
  readonly playing: boolean;
  readonly onActiveClipChange: (clipId: string | null) => void;
  readonly onTogglePlayback: () => void;
  readonly onSeek: (timeSeconds: number) => void;
  readonly onSelectNode: (nodeId: string) => void;
}

const formatTime = (value: number): string => value.toFixed(2);

export function BottomWorkspace({
  document,
  activeClipId,
  activeClip,
  playhead,
  playing,
  onActiveClipChange,
  onTogglePlayback,
  onSeek,
  onSelectNode
}: BottomWorkspaceProps) {
  const duration = activeClip?.durationSeconds ?? 0;

  return (
    <section className="timeline-panel observer-timeline" aria-label="Motion playback">
      <div className="timeline-sidebar">
        <div className="motion-view-heading">
          <Icon name="play" />
          <strong>Motion</strong>
        </div>
        <div className="timeline-controls">
          <button
            type="button"
            className="play-button"
            aria-label={playing ? 'Pause animation' : 'Play animation'}
            disabled={!activeClip}
            onClick={onTogglePlayback}
          >
            <Icon name={playing ? 'pause' : 'play'} />
          </button>
          <select
            aria-label="Animation clip"
            value={activeClipId ?? ''}
            onChange={(event) =>
              onActiveClipChange(event.target.value || null)
            }
            disabled={Object.keys(document.animations).length === 0}
          >
            <option value="">Rest pose</option>
            {Object.values(document.animations).map((clip) => (
              <option key={clip.id} value={clip.id}>{clip.name}</option>
            ))}
          </select>
        </div>
        <div className="timeline-time">
          <strong>{formatTime(playhead)}</strong>
          <span>/ {formatTime(duration)}s</span>
          <kbd>{activeClip?.fps ?? 0} fps</kbd>
        </div>
      </div>
      <AnimationTimeline
        document={document}
        activeClip={activeClip}
        playhead={playhead}
        onSeek={onSeek}
        onSelectNode={onSelectNode}
      />
    </section>
  );
}
