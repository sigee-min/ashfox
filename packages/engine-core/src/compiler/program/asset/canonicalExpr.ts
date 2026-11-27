import { freeze } from '../../../immutable';
import {
  expressionSlotName,
  expressionVariantName,
  isExpressionVariantNode,
  type ExpressionMotionEntry,
  type ExpressionMotionSlotSpec,
} from '../../../model/expression';
import type { SceneNode } from '../../../model/scene';
import type { AssetDiagnostic } from '../../../project/program/asset/contract';
import { NUMBER_BOUNDARY, canonicalNumber, type Location } from './canonicalSupport';
import type { InstantiatedAssetIr, InstantiatedMotion } from './ir';

const collectExpressionSlots = (
  nodes: readonly SceneNode[],
): ReadonlyMap<string, ReadonlySet<string>> => {
  const bySlot = new Map<string, Set<string>>();
  for (const node of nodes) {
    if (!isExpressionVariantNode(node)) continue;
    const slotId = expressionSlotName(node);
    const variant = expressionVariantName(node);
    if (slotId === null || variant === null) continue;
    let variants = bySlot.get(slotId);
    if (!variants) {
      variants = new Set<string>();
      bySlot.set(slotId, variants);
    }
    variants.add(variant);
  }
  return bySlot;
};

const checkMotionSlotSchedule = (
  exp: NonNullable<InstantiatedAssetIr['motions'][number]['expressions']>[number],
  sourcePath: string,
  slots: ReadonlyMap<string, ReadonlySet<string>>,
  diagnostics: AssetDiagnostic[],
): void => {
  const matched = [...slots.entries()].filter(
    ([slotId]) => slotId === exp.slot || slotId.endsWith(`/${exp.slot}`),
  );
  if (matched.length === 0) {
    diagnostics.push(
      freeze({
        severity: 'error' as const,
        path: sourcePath,
        span: exp.span,
        code: 'asset.invalid-expression-slot',
        message: `Expression schedule references unknown slot "${exp.slot}".`,
      }),
    );
    return;
  }
  for (const entry of exp.entries) {
    if (matched.some(([, variants]) => variants.has(entry.variant))) continue;
    diagnostics.push(
      freeze({
        severity: 'error' as const,
        path: sourcePath,
        span: entry.span,
        code: 'asset.invalid-expression-variant',
        message: `Expression slot "${exp.slot}" has no declared variant "${entry.variant}".`,
      }),
    );
  }
};

/** Verify that every motion expression slot and scheduled variant resolves to compiled nodes. */
export const validateMotionExpressionRefs = (
  ir: InstantiatedAssetIr,
  nodes: readonly SceneNode[],
): readonly AssetDiagnostic[] => {
  const slots = collectExpressionSlots(nodes);
  const diagnostics: AssetDiagnostic[] = [];
  for (const motion of ir.motions) {
    for (const exp of motion.expressions ?? []) {
      checkMotionSlotSchedule(exp, motion.sourcePath, slots, diagnostics);
    }
  }
  return diagnostics;
};

/** Lower declarative facial expression slots inside an instantiated rig motion. */
export const lowerMotionExpressions = (
  motion: InstantiatedMotion,
  location: Location,
  diagnostics: AssetDiagnostic[],
): readonly ExpressionMotionSlotSpec[] => {
  const specs: ExpressionMotionSlotSpec[] = [];
  for (const exp of motion.expressions ?? []) {
    const entries: ExpressionMotionEntry[] = [];
    for (const entry of exp.entries) {
      const startTime = canonicalNumber(
        entry.startTime,
        'second',
        NUMBER_BOUNDARY,
        location,
        diagnostics,
      );
      const endTime = entry.endTime
        ? canonicalNumber(entry.endTime, 'second', NUMBER_BOUNDARY, location, diagnostics)
        : null;
      if (startTime === null || (entry.endTime !== null && endTime === null)) continue;
      entries.push(freeze({ startTime, endTime, variant: entry.variant }));
    }
    if (entries.length > 0) specs.push(freeze({ slot: exp.slot, entries: freeze(entries) }));
  }
  return freeze(specs);
};
