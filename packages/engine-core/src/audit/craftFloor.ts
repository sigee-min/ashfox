import { isExpressionVariantNode, expressionSlotPlacement } from '../model/expression';
import type { AssetQualityProfile, CompiledModel } from '../model/compiled';
import type { BoneNode } from '../model/scene';
import type { AuditDeduction } from './contract';
import { findBadPbrHeadroomCharts } from './craftPbr';
import type { AuditObb, AuditSceneGeometry } from './geometry';

export type CraftCheckId =
  | 'craft.primitiveAppropriateness'
  | 'craft.eyePlacement'
  | 'craft.wingedProportions'
  | 'craft.limbCoherence'
  | 'craft.pbrHeadroom'
  | 'craft.silhouetteLayers';

export interface CraftFloorCheck {
  readonly id: CraftCheckId;
  readonly passed: boolean;
  readonly blocking: boolean;
  readonly lostPoints: number;
  readonly summary: string;
  readonly targets: readonly string[];
  readonly fix: string;
}

export interface CraftFloorReport {
  readonly checks: readonly CraftFloorCheck[];
  readonly formPenalty: number;
  readonly texturePenalty: number;
  readonly blockingFailures: readonly CraftFloorCheck[];
  readonly deductions: readonly AuditDeduction[];
}

const APPROPRIATE_WEDGE_RE =
  /(?:weapon|blade|sword|axe|dagger|spear|staff|armor|pauldron|shoulder_pad|helmet|visor|shield|horn|antler|spike|fang|tusk|claw|talon|crest|mohawk|roof|fin|ridge|beak|keel|spur)/i;
const FORBIDDEN_WEDGE_RE =
  /(?:head|skull|muzzle|snout|jaw|chin|face|cheek|torso|chest|breast|belly|ruff|abdomen|pelvis|haunch|foot|feet|boot|shoe|toe|paw|hoof|leg|thigh|shin|calf|arm|hand)/i;
const FURRY_TAIL_BODY_RE = /(?:tail|body|torso|chest|haunch|pelvis|ruff|mane)/i;
const CYL_SAFE_RE =
  /(?:buckle|belt|collar|button|gem|stud|orb|barrel|bottle|pillar|column|wheel|staff|pole|handle|hilt|guard|boss|leg|thigh|shin|arm|forearm)/i;

const leafName = (id: string): string => {
  const idx = id.lastIndexOf('/');
  return idx >= 0 ? id.slice(idx + 1) : id;
};

/** True when a wedge belongs on an edged/armored silhouette part rather than soft anatomy. */
export const isAppropriateWedge = (obb: AuditObb): boolean => {
  const leaf = leafName(obb.nodeId);
  return APPROPRIATE_WEDGE_RE.test(leaf) && !FORBIDDEN_WEDGE_RE.test(leaf);
};

/** True when an OBB contributes valid angled sculpting (filtering inappropriate wedges). */
export const isRewardedAngledPart = (obb: AuditObb): boolean =>
  obb.primKind === 'wedge' ? isAppropriateWedge(obb) : obb.angled || obb.isPlane;

const lateralAxisIndex = (forward: CompiledModel['forward']): 0 | 2 =>
  forward === 'east' || forward === 'west' ? 2 : 0;

const forwardAxisIndex = (forward: CompiledModel['forward']): 0 | 2 =>
  forward === 'east' || forward === 'west' ? 0 : 2;

const passCheck = (id: CraftCheckId, summary: string): CraftFloorCheck => ({
  id,
  passed: true,
  blocking: false,
  lostPoints: 0,
  summary,
  targets: [],
  fix: '',
});

const failCheck = (
  id: CraftCheckId,
  lostPoints: number,
  summary: string,
  targets: readonly string[],
  fix: string,
  blocking = true,
): CraftFloorCheck => ({
  id,
  passed: false,
  blocking,
  lostPoints,
  summary,
  targets: targets.slice(0, 6),
  fix,
});

const isBadPrimitive = (o: AuditObb, totalVol: number): boolean => {
  const share = totalVol > 0 ? o.volume / totalVol : 0;
  const leaf = leafName(o.nodeId);
  const parent = leafName(o.parentId ?? '');
  if (o.primKind === 'wedge' && !isAppropriateWedge(o)) {
    return (
      (FORBIDDEN_WEDGE_RE.test(leaf) && share > 0.005) ||
      (FORBIDDEN_WEDGE_RE.test(parent) && share > 0.03)
    );
  }
  return (
    o.primKind === 'cylinder' &&
    !CYL_SAFE_RE.test(leaf) &&
    (FURRY_TAIL_BODY_RE.test(leaf) || FURRY_TAIL_BODY_RE.test(parent)) &&
    share > 0.015
  );
};

const checkPrimitiveAppropriateness = (
  profile: AssetQualityProfile,
  obbs: readonly AuditObb[],
): CraftFloorCheck => {
  if (profile !== 'creature') {
    return passCheck('craft.primitiveAppropriateness', 'Applies to creature profile.');
  }
  const totalVol = obbs.reduce((s, o) => s + (o.isPlane ? 0 : o.volume), 0);
  const badTargets = obbs.filter((o) => isBadPrimitive(o, totalVol)).map((o) => o.nodeId);
  if (badTargets.length === 0) {
    return passCheck(
      'craft.primitiveAppropriateness',
      'Primitives match organic and armored roles cleanly.',
    );
  }
  return failCheck(
    'craft.primitiveAppropriateness',
    Math.min(8, badTargets.length * 3),
    `Inappropriate wedge/cylinder on organic anatomy: ${badTargets.slice(0, 4).join(', ')}.`,
    badTargets,
    'Replace muzzle/chest/boot wedges and furry-tail cylinders with layered angled cubes and plane tufts.',
  );
};

const findSkullBounds = (
  obbs: readonly AuditObb[],
  bones: readonly BoneNode[],
): { readonly minY: number; readonly maxY: number } | null => {
  const headBoneIds = new Set(
    bones.filter((b) => /(?:^|[/_])head$/i.test(b.id) || /head/i.test(b.name)).map((b) => b.id),
  );
  const solids = obbs.filter((o) => !o.isPlane);
  const skull =
    solids.find((o) => /(?:^|\/)skull$/i.test(o.nodeId)) ??
    solids
      .filter(
        (o) =>
          (o.parentId !== null && headBoneIds.has(o.parentId)) || /head/i.test(leafName(o.nodeId)),
      )
      .sort((a, b) => b.volume - a.volume)[0];
  if (!skull) return null;
  return { minY: skull.aabbMin[1], maxY: skull.aabbMax[1] };
};

const evalEyeSlot = (
  obb: AuditObb,
  model: CompiledModel,
  skull: { readonly minY: number; readonly maxY: number },
  skullH: number,
  hasWings: boolean,
): { readonly bad: boolean; readonly blocking: boolean } => {
  const ratio = ((obb.aabbMin[1] + obb.aabbMax[1]) * 0.5 - skull.minY) / skullH;
  const outBand = ratio < 0.38 || ratio > 0.64;
  const frontWing = hasWings && expressionSlotPlacement(model.scene.nodes[obb.nodeId]!) === 'front';
  return {
    bad: outBand || frontWing,
    blocking: frontWing || ratio > 0.68 || ratio < 0.3,
  };
};

const checkEyePlacement = (
  profile: AssetQualityProfile,
  model: CompiledModel,
  scene: AuditSceneGeometry,
  bones: readonly BoneNode[],
): CraftFloorCheck => {
  const passDefault = passCheck('craft.eyePlacement', 'Eye placement within natural skull band.');
  if (profile !== 'creature') return passDefault;
  const skull = findSkullBounds(scene.obbs, bones);
  const exprObbs = scene.obbs.filter((o) => {
    const node = model.scene.nodes[o.nodeId];
    return node !== undefined && isExpressionVariantNode(node);
  });
  if (!skull || exprObbs.length === 0) return passDefault;
  const hasWings = bones.some((b) => /wing/i.test(b.id) || /wing/i.test(b.name));
  const skullH = Math.max(0.1, skull.maxY - skull.minY);
  const hits = exprObbs.map((o) => ({
    id: o.nodeId,
    ...evalEyeSlot(o, model, skull, skullH, hasWings),
  }));
  const unique = [...new Set(hits.filter((h) => h.bad).map((h) => h.id))];
  if (unique.length === 0) return passDefault;
  const blocking = hits.some((h) => h.blocking);
  return {
    id: 'craft.eyePlacement',
    passed: false,
    blocking,
    lostPoints: blocking ? 5 : 2,
    summary: hasWings
      ? `Winged/head eye placement outside 38%..64% skull height or using front cross-eyes (${unique.slice(0, 3).join(', ')}).`
      : `Eye expression_slot outside 38%..64% skull height (${unique.slice(0, 3).join(', ')}).`,
    targets: unique.slice(0, 6),
    fix: hasWings
      ? 'Use placement = lateral_pair on expression_slot and place eyes at 42%..58% of skull height.'
      : 'Lower eye expression_slot to 38%..64% of skull height.',
  };
};

const axisSpan = (obbs: readonly AuditObb[], axis: 0 | 2): number =>
  obbs.length > 0
    ? Math.max(...obbs.map((o) => o.aabbMax[axis]!)) -
      Math.min(...obbs.map((o) => o.aabbMin[axis]!))
    : 0;

const resolveTorsoWidth = (
  bones: readonly BoneNode[],
  scene: AuditSceneGeometry,
  lat: 0 | 2,
): number => {
  const torsoIds = new Set(
    bones
      .filter((b) => /(?:torso|body|chest)/i.test(b.id) || /(?:torso|body)/i.test(b.name))
      .map((b) => b.id),
  );
  return axisSpan(
    scene.obbs.filter(
      (o) =>
        !o.isPlane &&
        o.parentId !== null &&
        torsoIds.has(o.parentId) &&
        !/wing/i.test(leafName(o.nodeId)),
    ),
    lat,
  );
};

const measureWingSweep = (wingBones: readonly BoneNode[], wingObbs: readonly AuditObb[]) => {
  const hasAngledSweep =
    wingBones.some((b) => b.transform.rotation.some((r) => Math.abs(r) >= 4)) ||
    wingObbs.some((o) => (o.primKind !== 'wedge' && o.angled) || o.isPlane);
  const ys = wingObbs.map((o) => o.center[1]);
  const centerYSpread = ys.length > 0 ? Math.max(...ys) - Math.min(...ys) : 0;
  return { hasAngledSweep, centerYSpread, swept: hasAngledSweep || centerYSpread >= 2.0 };
};

const checkWingedProportions = (
  profile: AssetQualityProfile,
  model: CompiledModel,
  scene: AuditSceneGeometry,
  bones: readonly BoneNode[],
): CraftFloorCheck => {
  const wingBones = bones.filter((b) => /wing/i.test(b.id) || /wing/i.test(b.name));
  if (profile !== 'creature' || wingBones.length === 0) {
    return passCheck('craft.wingedProportions', 'No winged rig proportions required.');
  }
  const lat = lateralAxisIndex(model.forward);
  const wingIds = new Set(wingBones.map((b) => b.id));
  const torsoWidth = resolveTorsoWidth(bones, scene, lat);
  const wingObbs = scene.obbs.filter((o) => o.parentId !== null && wingIds.has(o.parentId));
  const wingspan = axisSpan(wingObbs, lat);
  const sweep = measureWingSweep(wingBones, wingObbs);
  const passed =
    (torsoWidth <= 0 || wingspan >= 1.6 * torsoWidth) && wingObbs.length >= 4 && sweep.swept;
  if (passed) {
    return passCheck(
      'craft.wingedProportions',
      `Wingspan ${wingspan.toFixed(1)}u (${(wingspan / Math.max(1, torsoWidth)).toFixed(2)}x torso) with swept plumage.`,
    );
  }
  return failCheck(
    'craft.wingedProportions',
    5,
    `Winged creature failed span/sweep (wingspan=${wingspan.toFixed(1)}u vs torso=${torsoWidth.toFixed(1)}u, angledSweep=${sweep.hasAngledSweep}, ySpread=${sweep.centerYSpread.toFixed(1)}u).`,
    wingBones.map((b) => b.id),
    'Use >= 1.6x torso wingspan with angled 26-32deg wing segments and feathered plane plumage.',
  );
};

const clusterGroundedFeet = (obbs: readonly AuditObb[]): AuditObb[] => {
  const grounded = obbs.filter((o) => !o.isPlane && o.aabbMin[1] <= 0.6);
  const clusters: AuditObb[] = [];
  for (const o of grounded) {
    const merged = clusters.some(
      (c) => Math.hypot(c.center[0] - o.center[0], c.center[2] - o.center[2]) < 1.5,
    );
    if (!merged) clusters.push(o);
  }
  return clusters;
};

const legColumnCount = (
  boneId: string,
  obbs: readonly AuditObb[],
  groundedFeet: readonly AuditObb[],
): number => {
  const direct = obbs.filter((o) => !o.isPlane && o.parentId === boneId);
  if (direct.length >= 2) return direct.length;
  const baseFoot =
    direct.find((o) => o.aabbMin[1] <= 0.6) ?? groundedFeet.find((f) => f.parentId === boneId);
  if (!baseFoot) return direct.length;
  return obbs.filter(
    (o) =>
      !o.isPlane &&
      Math.hypot(o.center[0] - baseFoot.center[0], o.center[2] - baseFoot.center[2]) <= 2.5,
  ).length;
};

const checkLimbCoherence = (
  profile: AssetQualityProfile,
  model: CompiledModel,
  scene: AuditSceneGeometry,
  bones: readonly BoneNode[],
): CraftFloorCheck => {
  const ok = passCheck('craft.limbCoherence', 'Limb grounding and articulation coherent.');
  if (profile !== 'creature') return ok;
  const legBones = bones.filter(
    (b) => /(?:leg|foreleg|hindleg)/i.test(b.id) || /leg/i.test(b.name),
  );
  const hasWings = bones.some((b) => /wing/i.test(b.id) || /wing/i.test(b.name));
  const lat = lateralAxisIndex(model.forward);
  const fwd = forwardAxisIndex(model.forward);
  const torsoObbs = scene.obbs.filter(
    (o) => !o.isPlane && /(?:torso|body|chest|haunch|pelvis)/i.test(leafName(o.nodeId)),
  );
  const torsoW =
    torsoObbs.length > 0
      ? Math.max(...torsoObbs.map((o) => o.aabbMax[lat]!)) -
        Math.min(...torsoObbs.map((o) => o.aabbMin[lat]!))
      : 0;
  const torsoD =
    torsoObbs.length > 0
      ? Math.max(...torsoObbs.map((o) => o.aabbMax[fwd]!)) -
        Math.min(...torsoObbs.map((o) => o.aabbMin[fwd]!))
      : 0;
  const expectsQuad =
    legBones.length >= 4 ||
    (hasWings &&
      torsoObbs.some((o) => /haunch/i.test(leafName(o.nodeId))) &&
      torsoD > torsoW * 1.15);
  const groundedFeet = clusterGroundedFeet(scene.obbs);
  const shortLegs = legBones
    .filter((b) => legColumnCount(b.id, scene.obbs, groundedFeet) < 2)
    .map((b) => b.id);
  const missingFeet = expectsQuad && groundedFeet.length < 4;
  if (!missingFeet && shortLegs.length === 0) return ok;
  return {
    id: 'craft.limbCoherence',
    passed: false,
    blocking: true,
    lostPoints: 6,
    summary: missingFeet
      ? `Quadruped/winged-quadruped has ${groundedFeet.length} grounded feet (expected 4 with minY <= 0.6u).`
      : `Leg bone(s) lack >= 2 articulated segments: ${shortLegs.join(', ')}.`,
    targets: missingFeet ? ['root'] : shortLegs.slice(0, 6),
    fix: missingFeet
      ? 'Use winged_quadruped/quadruped rig with 4 grounded feet (minY <= 0.6u) and >= 2 segments per leg.'
      : 'Split single-block legs into >= 2 segments (thigh/shin/paw).',
  };
};

const checkPbrHeadroom = (model: CompiledModel, scene: AuditSceneGeometry): CraftFloorCheck => {
  const badTargets = findBadPbrHeadroomCharts(model, scene);
  if (badTargets.length === 0) {
    return passCheck(
      'craft.pbrHeadroom',
      'Metallic and matte albedo luminance headroom within PBR range.',
    );
  }
  return failCheck(
    'craft.pbrHeadroom',
    4,
    `PBR luminance headroom violation (metallic L<0.42 crush or large matte L>0.94 clip) at ${badTargets.slice(0, 3).join(', ')}.`,
    badTargets,
    'Raise metallic (>=0.6) chart albedo luminance >= 0.42 and keep large matte charts <= 0.94.',
  );
};

const checkSilhouetteLayers = (
  profile: AssetQualityProfile,
  model: CompiledModel,
  scene: AuditSceneGeometry,
): CraftFloorCheck => {
  if (profile !== 'creature') {
    return passCheck('craft.silhouetteLayers', 'Applies to creature profile.');
  }
  const nonExprPlanes = scene.obbs.filter((o) => {
    const n = model.scene.nodes[o.nodeId];
    return o.isPlane && n !== undefined && !isExpressionVariantNode(n);
  }).length;
  const sculpted = scene.obbs.filter((o) => !o.isPlane && isRewardedAngledPart(o)).length;
  if (nonExprPlanes >= 1 || (sculpted >= 2 && scene.maxBoneDepth >= 3 && scene.obbs.length >= 8)) {
    return passCheck(
      'craft.silhouetteLayers',
      `Layered creature silhouette (${nonExprPlanes} decorative planes, ${sculpted} sculpted angled parts).`,
    );
  }
  return failCheck(
    'craft.silhouetteLayers',
    4,
    `Creature lacks layered silhouette breakup (planes=${nonExprPlanes}, sculpted=${sculpted}).`,
    [],
    'Add cutout plane fur tufts/feathers/fins or angled multi-part sub-sculpts.',
  );
};

/** Evaluate deterministic Anti-Derp Craft Floor checks on a compiled asset. */
export const evaluateCraftFloor = (
  profile: AssetQualityProfile,
  model: CompiledModel,
  scene: AuditSceneGeometry,
): CraftFloorReport => {
  const bones = Object.values(model.scene.nodes).filter((n): n is BoneNode => n.kind === 'bone');
  const checks: readonly CraftFloorCheck[] = [
    checkPrimitiveAppropriateness(profile, scene.obbs),
    checkEyePlacement(profile, model, scene, bones),
    checkWingedProportions(profile, model, scene, bones),
    checkLimbCoherence(profile, model, scene, bones),
    checkPbrHeadroom(model, scene),
    checkSilhouetteLayers(profile, model, scene),
  ];
  const blockingFailures = checks.filter((c) => !c.passed && c.blocking);
  const formPenalty = checks
    .filter((c) => !c.passed && c.id !== 'craft.pbrHeadroom')
    .reduce((s, c) => s + c.lostPoints, 0);
  const pbr = checks.find((c) => c.id === 'craft.pbrHeadroom');
  const texturePenalty = pbr && !pbr.passed ? pbr.lostPoints : 0;
  const deductions: AuditDeduction[] = checks
    .filter((c) => !c.passed)
    .map((c) => ({
      metricId: c.id,
      pillar: c.id === 'craft.pbrHeadroom' ? ('texture' as const) : ('form' as const),
      lostPoints: c.lostPoints,
      summary: c.summary,
      targets: c.targets,
      fix: c.fix,
    }));
  return { checks, formPenalty, texturePenalty, blockingFailures, deductions };
};
