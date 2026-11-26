import {
  DEFAULT_AUDIT_THRESHOLD,
  ramp,
  round2,
  type AuditQualityGrade,
} from '@ashfox/internal-contracts';
import type { AssetQualityProfile, CompiledModel } from '../model/compiled';
import type { AssetAuthoringTelemetry } from '../model/telemetry';

export type QualityGrade = AuditQualityGrade;
export type AuditProfileSource = 'authored' | 'override' | 'inferred';
export type AuditPillarId = 'form' | 'texture' | 'rig';

export type AuditGateId =
  | 'visible_geometry'
  | 'ground_contact'
  | 'no_disconnected_floating_parts'
  | 'no_buried_hidden_cubes'
  | 'texture_coverage_complete'
  | 'pre_grain_authored_floor'
  | 'anti_noise_coherence'
  | 'profile_structural_minimum';

export interface AuditGateResult {
  readonly id: AuditGateId;
  readonly passed: boolean;
  readonly message: string;
  readonly targets: readonly string[];
  readonly fix: string;
}

export interface AuditSubmetric {
  readonly id: string;
  readonly label: string;
  readonly score: number;
  readonly maxScore: number;
  readonly value: number;
  readonly target: number;
  readonly detail: string;
}

export interface AuditPillarReport {
  readonly id: AuditPillarId;
  readonly label: string;
  readonly score: number;
  readonly maxScore: number;
  readonly metrics: readonly AuditSubmetric[];
}

export interface AuditDeduction {
  readonly metricId: string;
  readonly pillar: AuditPillarId | 'gate';
  readonly lostPoints: number;
  readonly summary: string;
  readonly targets: readonly string[];
  readonly fix: string;
}

export interface AuditModelInput {
  readonly model: CompiledModel;
  readonly telemetry?: AssetAuthoringTelemetry;
}

export interface AuditOptions {
  readonly profile?: AssetQualityProfile;
  readonly threshold?: number;
}

export interface AuditReport {
  readonly schemaVersion: 1;
  readonly profile: AssetQualityProfile;
  readonly profileSource: AuditProfileSource;
  readonly threshold: number;
  readonly passed: boolean;
  readonly score: number;
  readonly grade: QualityGrade;
  readonly hardGates: readonly AuditGateResult[];
  readonly pillars: readonly AuditPillarReport[];
  readonly topDeductions: readonly AuditDeduction[];
  readonly telemetryAvailable: boolean;
}

export interface ProfileWeightSpec {
  readonly formMax: number;
  readonly textureMax: number;
  readonly rigMax: number;
  readonly parts: number;
  readonly angles: number;
  readonly silhouette: number;
  readonly balance: number;
  readonly preGrainCoverage: number;
  readonly roleDepth: number;
  readonly contactAo: number;
  readonly valueHierarchy: number;
  readonly coherenceAndFocus: number;
  readonly materialCraft: number;
  readonly rigAndMotion: number;
  readonly uvEfficiency: number;
}

export { DEFAULT_AUDIT_THRESHOLD, ramp, round2 };

export const PROFILE_WEIGHTS: Readonly<Record<AssetQualityProfile, ProfileWeightSpec>> = {
  creature: {
    formMax: 40,
    textureMax: 35,
    rigMax: 25,
    parts: 11,
    angles: 10,
    silhouette: 11,
    balance: 8,
    preGrainCoverage: 10,
    roleDepth: 6,
    contactAo: 6,
    valueHierarchy: 7,
    coherenceAndFocus: 6,
    materialCraft: 8,
    rigAndMotion: 12,
    uvEfficiency: 5,
  },
  prop: {
    formMax: 40,
    textureMax: 40,
    rigMax: 20,
    parts: 11,
    angles: 9,
    silhouette: 12,
    balance: 8,
    preGrainCoverage: 12,
    roleDepth: 7,
    contactAo: 7,
    valueHierarchy: 8,
    coherenceAndFocus: 6,
    materialCraft: 10,
    rigAndMotion: 4,
    uvEfficiency: 6,
  },
  block: {
    formMax: 20,
    textureMax: 60,
    rigMax: 20,
    parts: 5,
    angles: 3,
    silhouette: 6,
    balance: 6,
    preGrainCoverage: 17,
    roleDepth: 12,
    contactAo: 10,
    valueHierarchy: 12,
    coherenceAndFocus: 9,
    materialCraft: 12,
    rigAndMotion: 4,
    uvEfficiency: 4,
  },
};
