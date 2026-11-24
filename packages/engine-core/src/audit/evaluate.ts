import { deepFreeze } from '../immutable';
import type { AssetQualityProfile, CompiledModel } from '../model/compiled';
import {
  DEFAULT_AUDIT_THRESHOLD,
  type AuditDeduction,
  type AuditGateResult,
  type AuditModelInput,
  type AuditOptions,
  type AuditProfileSource,
  type AuditReport,
  type QualityGrade,
} from './contract';
import { analyzeSceneGeometry, type AuditSceneGeometry } from './geometry';
import { evaluateHardGates, summarizeTelemetry } from './hardGates';
import { evaluateFormPillar } from './pillarForm';
import { evaluateRigPillar } from './pillarRig';
import { evaluateTexturePillar } from './pillarTexture';
import { analyzeRasterStats } from './rasterStats';

const resolveProfile = (
  model: CompiledModel,
  scene: AuditSceneGeometry,
  override?: AssetQualityProfile,
): { readonly profile: AssetQualityProfile; readonly source: AuditProfileSource } => {
  if (override !== undefined) return { profile: override, source: 'override' };
  if (model.profile !== undefined) return { profile: model.profile, source: 'authored' };
  const clipCount = Object.keys(model.animations).length;
  if (scene.boneCount >= 3 && clipCount > 0) return { profile: 'creature', source: 'inferred' };
  if (scene.obbs.length >= 3) return { profile: 'prop', source: 'inferred' };
  return { profile: 'block', source: 'inferred' };
};

const gradeFor = (allGates: boolean, score: number, passed: boolean): QualityGrade => {
  if (!allGates || score < 50) return 'fail';
  if (!passed || score < DEFAULT_AUDIT_THRESHOLD) return 'needs_work';
  return score >= 85 ? 'excellent' : 'pass';
};

const buildTopDeductions = (
  gates: readonly AuditGateResult[],
  pillarDeductions: readonly AuditDeduction[],
): readonly AuditDeduction[] => {
  const gateDeductions: AuditDeduction[] = gates
    .filter((g) => !g.passed)
    .map((g) => ({
      metricId: `gate.${g.id}`,
      pillar: 'gate' as const,
      lostPoints: 100,
      summary: g.message,
      targets: g.targets,
      fix: g.fix,
    }));
  const sorted = [...pillarDeductions].sort(
    (a, b) =>
      b.lostPoints - a.lostPoints ||
      (a.metricId < b.metricId ? -1 : a.metricId > b.metricId ? 1 : 0),
  );
  return [...gateDeductions, ...sorted].slice(0, 5);
};

/** Evaluate quantitative model + pre/post texture quality purely on CPU. */
export const evaluateAssetQuality = (
  input: AuditModelInput,
  options: AuditOptions = {},
): AuditReport => {
  const scene = analyzeSceneGeometry(input.model.scene, input.model.textures);
  const { profile, source: profileSource } = resolveProfile(input.model, scene, options.profile);
  const threshold = options.threshold ?? DEFAULT_AUDIT_THRESHOLD;
  const raster = analyzeRasterStats(scene, input.model.textures);
  const telemetryAvailable = input.telemetry !== undefined;
  const telemetry = summarizeTelemetry(input.telemetry, input.model.forward);
  const hardGates = evaluateHardGates(profile, scene, raster, telemetry, telemetryAvailable);
  const form = evaluateFormPillar(profile, scene);
  const texture = evaluateTexturePillar(profile, telemetry, telemetryAvailable, raster);
  const rig = evaluateRigPillar(profile, input.model, scene, telemetry, telemetryAvailable, raster);
  const rawScore = form.pillar.score + texture.pillar.score + rig.pillar.score;
  const score = Math.max(0, Math.min(100, Math.round(rawScore)));
  const allGatesPassed = hardGates.every((g) => g.passed);
  const passed = allGatesPassed && score >= threshold;
  return deepFreeze({
    schemaVersion: 1 as const,
    profile,
    profileSource,
    threshold,
    passed,
    score,
    grade: gradeFor(allGatesPassed, score, passed),
    hardGates,
    pillars: [form.pillar, texture.pillar, rig.pillar],
    topDeductions: buildTopDeductions(hardGates, [
      ...form.deductions,
      ...texture.deductions,
      ...rig.deductions,
    ]),
    telemetryAvailable,
  });
};
