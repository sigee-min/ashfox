import type { EntityId } from '../model';

export const INVARIANT_SEVERITIES = ['error', 'warning', 'info'] as const;
export type InvariantSeverity = (typeof INVARIANT_SEVERITIES)[number];

export type InvariantCode =
  | 'document.schema_version'
  | 'document.unknown_property'
  | 'document.required_value'
  | 'document.invalid_timestamp'
  | 'document.invalid_setting'
  | 'identity.key_mismatch'
  | 'identity.duplicate'
  | 'scene.root_duplicate'
  | 'scene.root_missing'
  | 'scene.root_parent'
  | 'scene.parent_missing'
  | 'scene.parent_not_bone'
  | 'scene.parent_cycle'
  | 'scene.root_membership'
  | 'scene.invalid_kind'
  | 'value.not_finite'
  | 'value.invalid_scale'
  | 'cube.invalid_bounds'
  | 'cube.invalid_face'
  | 'cube.texture_missing'
  | 'cube.fully_occluded'
  | 'plane.invalid_size'
  | 'plane.invalid_sidedness'
  | 'plane.invalid_coverage'
  | 'plane.invalid_face'
  | 'plane.texture_missing'
  | 'texture.invalid_dimensions'
  | 'texture.invalid_blob'
  | 'texture.invalid_atlas_mode'
  | 'texture.invalid_raster'
  | 'animation.invalid_timing'
  | 'animation.target_missing'
  | 'animation.key_order'
  | 'animation.key_out_of_range'
  | 'animation.invalid_value'
  | 'animation.invalid_loop'
  | 'animation.invalid_effect'
  | 'animation.channel_duplicate'
  | 'animation.name_duplicate'
  | 'format.invalid_namespace'
  | 'format.invalid_resource_path'
  | 'format.invalid_identifier'
  | 'format.unsupported_data'
  | 'format.unbaked_transform'
  | 'format.coordinate_overflow'
  | 'format.rotation_unsupported'
  | 'format.texture_missing'
  | 'format.texture_binding_missing'
  | 'format.texture_key_duplicate'
  | 'format.texture_path_duplicate'
  | 'format.texture_type_unsupported'
  | 'format.uv_missing';

export interface InvariantFinding {
  code: InvariantCode;
  severity: InvariantSeverity;
  message: string;
  path: string;
  entityIds?: readonly EntityId[];
  assetIds?: readonly string[];
  clipIds?: readonly string[];
  fix?: string;
}

export interface ValidationReport {
  valid: boolean;
  findings: readonly InvariantFinding[];
}

export type FindingSink = (finding: InvariantFinding) => void;
export type IdRegistrar = (id: string, path: string) => void;

export class ProjectInvariantError extends Error {
  readonly report: ValidationReport;

  constructor(report: ValidationReport) {
    super(
      `Project document violates ${report.findings.filter((finding) => finding.severity === 'error').length} invariant(s).`,
    );
    this.name = 'ProjectInvariantError';
    this.report = report;
  }
}
