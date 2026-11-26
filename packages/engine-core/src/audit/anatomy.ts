import { dot3, sub3 } from '../math/vec3';
import type { Vec3 } from '../model/identity';
import { ramp } from './contract';
import type { AuditObb, AuditSceneGeometry } from './geometry';

export interface AuditAnatomyReport {
  readonly structuralObbs: readonly AuditObb[];
  readonly microSpeckCount: number;
  readonly solidPlaneCount: number;
  readonly taperAndArticulationScore: number;
  readonly overlapPenalty: number;
}

export const isMicroSpeck = (obb: AuditObb, totalVolume: number): boolean =>
  !obb.isPlane && totalVolume > 0 && obb.volume < 0.0018 * totalVolume;

const groupVolumesScore = (group: readonly AuditObb[]): number => {
  if (group.length < 2) return 0;
  const vols = group.map((o) => Math.max(0.01, o.volume));
  const taperRatio = Math.max(...vols) / Math.min(...vols);
  const angledBonus = group.some((o) => o.angled || o.isPlane) ? 0.35 : 0;
  return Math.min(1, 0.65 * ramp(taperRatio, 1.25, 2.2) + angledBonus);
};

const evaluateTaperAndArticulation = (
  scene: AuditSceneGeometry,
  structural: readonly AuditObb[],
): number => {
  if (structural.length < 2) return 0;
  const groups = new Map<string, AuditObb[]>();
  for (const obb of structural) {
    const key = obb.parentId ?? 'root';
    const list = groups.get(key);
    if (list) list.push(obb);
    else groups.set(key, [obb]);
  }
  const multiGroups = [...groups.values()].filter((g) => g.length >= 2);
  const meanGroupTaper =
    multiGroups.length > 0
      ? multiGroups.reduce((s, g) => s + groupVolumesScore(g), 0) / multiGroups.length
      : 0;
  const volSet = new Set(structural.map((o) => Math.round(o.volume * 10)));
  const sizeDiversity = ramp(volSet.size / structural.length, 0.3, 0.78);
  const depthRichness = ramp(scene.maxBoneDepth, 1, 4);
  return 0.4 * meanGroupTaper + 0.3 * depthRichness + 0.3 * sizeDiversity;
};

const pointInsideObb = (pt: Vec3, target: AuditObb): boolean => {
  const d = sub3(pt, target.center);
  const margin = 0.02;
  return (
    Math.abs(dot3(d, target.ax)) < target.half[0] - margin &&
    Math.abs(dot3(d, target.ay)) < target.half[1] - margin &&
    Math.abs(dot3(d, target.az)) < target.half[2] - margin
  );
};

const cubeContainmentRatio = (small: AuditObb, large: AuditObb): number => {
  const steps = [-0.65, 0, 0.65] as const;
  let inside = 0;
  for (const sx of steps) {
    for (const sy of steps) {
      for (const sz of steps) {
        const pt: Vec3 = [
          small.center[0] +
            sx * small.half[0] * small.ax[0] +
            sy * small.half[1] * small.ay[0] +
            sz * small.half[2] * small.az[0],
          small.center[1] +
            sx * small.half[0] * small.ax[1] +
            sy * small.half[1] * small.ay[1] +
            sz * small.half[2] * small.az[1],
          small.center[2] +
            sx * small.half[0] * small.ax[2] +
            sy * small.half[1] * small.ay[2] +
            sz * small.half[2] * small.az[2],
        ];
        if (pointInsideObb(pt, large)) inside += 1;
      }
    }
  }
  return inside / 27;
};

const aabbOverlap1D = (aMin: number, aMax: number, bMin: number, bMax: number): number =>
  Math.max(0, Math.min(aMax, bMax) - Math.max(aMin, bMin));

const hasZFightingPair = (a: AuditObb, b: AuditObb): boolean => {
  if (a.angled || b.angled) return false;
  for (let axis = 0; axis < 3; axis += 1) {
    const gapSameMin = Math.abs(a.aabbMin[axis]! - b.aabbMin[axis]!);
    const gapSameMax = Math.abs(a.aabbMax[axis]! - b.aabbMax[axis]!);
    if (gapSameMin >= 0.02 && gapSameMax >= 0.02) continue;
    const o1 = (axis + 1) % 3;
    const o2 = (axis + 2) % 3;
    const areaOverlap =
      aabbOverlap1D(a.aabbMin[o1]!, a.aabbMax[o1]!, b.aabbMin[o1]!, b.aabbMax[o1]!) *
      aabbOverlap1D(a.aabbMin[o2]!, a.aabbMax[o2]!, b.aabbMin[o2]!, b.aabbMax[o2]!);
    const minFaceArea = Math.min(
      (a.aabbMax[o1]! - a.aabbMin[o1]!) * (a.aabbMax[o2]! - a.aabbMin[o2]!),
      (b.aabbMax[o1]! - b.aabbMin[o1]!) * (b.aabbMax[o2]! - b.aabbMin[o2]!),
    );
    if (minFaceArea > 0.1 && areaOverlap / minFaceArea > 0.5) return true;
  }
  return false;
};

const aabbsDisjoint = (a: AuditObb, b: AuditObb, tol: number): boolean =>
  a.aabbMax[0] < b.aabbMin[0] - tol ||
  b.aabbMax[0] < a.aabbMin[0] - tol ||
  a.aabbMax[1] < b.aabbMin[1] - tol ||
  b.aabbMax[1] < a.aabbMin[1] - tol ||
  a.aabbMax[2] < b.aabbMin[2] - tol ||
  b.aabbMax[2] < a.aabbMin[2] - tol;

const overlapKind = (
  a: AuditObb,
  b: AuditObb,
): { readonly severe: boolean; readonly zFight: boolean } => {
  if (aabbsDisjoint(a, b, 0.02)) return { severe: false, zFight: false };
  const small = a.volume <= b.volume ? a : b;
  const large = a.volume <= b.volume ? b : a;
  return {
    severe: cubeContainmentRatio(small, large) > 0.25,
    zFight: hasZFightingPair(a, b),
  };
};

const computeOverlapPenalty = (structural: readonly AuditObb[]): number => {
  const cubes = structural.filter((o) => !o.isPlane && o.opaque);
  let severeCount = 0;
  let zFightCount = 0;
  for (let i = 0; i < cubes.length; i += 1) {
    for (let j = i + 1; j < cubes.length; j += 1) {
      const pair = overlapKind(cubes[i]!, cubes[j]!);
      if (pair.severe) severeCount += 1;
      if (pair.zFight) zFightCount += 1;
    }
  }
  const intersectPenalty = ramp(severeCount, 0, 2.5) * 0.65;
  const zFightPenalty = ramp(zFightCount, 0, 2) * 0.35;
  return Math.min(1, intersectPenalty + zFightPenalty);
};

export const analyzeAnatomy = (scene: AuditSceneGeometry): AuditAnatomyReport => {
  const totalVol = scene.obbs.reduce((s, o) => s + (o.isPlane ? 0 : o.volume), 0);
  const structural = scene.obbs.filter((o) => !isMicroSpeck(o, totalVol));
  const used = structural.length > 0 ? structural : scene.obbs;
  const microSpeckCount = Math.max(0, scene.obbs.length - structural.length);
  const solidPlaneCount = used.filter((o) => o.solidPlane).length;
  return {
    structuralObbs: used,
    microSpeckCount,
    solidPlaneCount,
    taperAndArticulationScore: evaluateTaperAndArticulation(scene, used),
    overlapPenalty: computeOverlapPenalty(used),
  };
};
