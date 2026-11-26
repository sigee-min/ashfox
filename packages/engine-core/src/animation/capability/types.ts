import type { ExportFormatProfile } from '../../model/exportFormat';

export type AnimationPreviewIssueCode =
  | 'molang'
  | 'easing'
  | 'split_value'
  | 'entity_rotation'
  | 'start_delay'
  | 'loop_delay'
  | 'animation_time_update'
  | 'blend_weight'
  | 'override_previous_animation'
  | 'sound_trigger'
  | 'particle_trigger'
  | 'timeline_trigger';

export interface AnimationPreviewIssue {
  code: AnimationPreviewIssueCode;
  clipId?: string;
  channelId?: string;
  triggerId?: string;
  keyframeId?: string;
}

export type AnimationExportTarget = ExportFormatProfile['id'];

export type AnimationExportIssueCode =
  | 'animations_unsupported'
  | 'channels_missing'
  | 'channel_keys_missing'
  | 'molang'
  | 'easing'
  | 'split_value'
  | 'entity_rotation'
  | 'start_delay'
  | 'loop_delay'
  | 'animation_time_update'
  | 'blend_weight'
  | 'override_previous_animation'
  | 'sound_trigger'
  | 'particle_trigger'
  | 'timeline_trigger'
  | 'mixed_interpolation'
  | 'timestamp_collision'
  | 'geckolib_multi_value';

export interface AnimationExportIssue {
  code: AnimationExportIssueCode;
  targetId: AnimationExportTarget;
  clipId: string;
  path: string;
  message: string;
  channelId?: string;
  triggerId?: string;
  keyframeId?: string;
}

export type AnimationExportAdaptationDisposition = 'omitted' | 'converted';

export type AnimationExportAdaptationCode =
  | 'animations_unsupported'
  | 'channels_missing'
  | 'channel_keys_missing'
  | 'start_delay'
  | 'loop_delay'
  | 'animation_time_update'
  | 'blend_weight'
  | 'override_previous_animation'
  | 'sound_trigger'
  | 'particle_trigger'
  | 'timeline_trigger';

export interface AnimationExportAdaptation {
  disposition: AnimationExportAdaptationDisposition;
  code: AnimationExportAdaptationCode;
  targetId: AnimationExportTarget;
  clipId: string;
  path: string;
  message: string;
  channelId?: string;
  triggerId?: string;
  keyframeId?: string;
}

export interface ClipAnimationCapability {
  clipId: string;
  previewable: boolean;
  exportable: boolean;
  previewIssues: readonly AnimationPreviewIssue[];
  exportIssues: readonly AnimationExportIssue[];
  exportAdaptations: readonly AnimationExportAdaptation[];
}

export interface ProjectAnimationCapabilityReport {
  targetId: AnimationExportTarget;
  previewable: boolean;
  exportable: boolean;
  clips: readonly ClipAnimationCapability[];
}
