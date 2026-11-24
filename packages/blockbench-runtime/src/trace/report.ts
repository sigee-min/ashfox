import type {
  ProjectDiffCounts,
  ProjectDiffCountsByKind,
} from '@ashfox/blockbench-contracts/types/project';
import {
  isTraceLogEntry,
  TRACE_LOG_SCHEMA_VERSION,
  type TraceLogReport,
} from '@ashfox/blockbench-contracts/types/traceLog';
import { parseTraceLogText } from './replay';

const emptyCounts = (): ProjectDiffCounts => ({ added: 0, removed: 0, changed: 0 });

const emptyCountsByKind = (): ProjectDiffCountsByKind => ({
  bones: emptyCounts(),
  cubes: emptyCounts(),
  meshes: emptyCounts(),
  textures: emptyCounts(),
  animations: emptyCounts(),
});

const safeCountSum = (left: number, right: number, path: string, warnings: Set<string>): number => {
  if (left <= Number.MAX_SAFE_INTEGER - right) return left + right;
  warnings.add(`Diff count overflow at ${path}; clamped to Number.MAX_SAFE_INTEGER.`);
  return Number.MAX_SAFE_INTEGER;
};

const addCounts = (
  target: ProjectDiffCounts,
  value: ProjectDiffCounts,
  path: string,
  warnings: Set<string>,
): ProjectDiffCounts => ({
  added: safeCountSum(target.added, value.added, `${path}.added`, warnings),
  removed: safeCountSum(target.removed, value.removed, `${path}.removed`, warnings),
  changed: safeCountSum(target.changed, value.changed, `${path}.changed`, warnings),
});

const addCountsByKind = (
  target: ProjectDiffCountsByKind,
  value: ProjectDiffCountsByKind,
  warnings: Set<string>,
): ProjectDiffCountsByKind => ({
  bones: addCounts(target.bones, value.bones, 'bones', warnings),
  cubes: addCounts(target.cubes, value.cubes, 'cubes', warnings),
  meshes: addCounts(
    target.meshes ?? emptyCounts(),
    value.meshes ?? emptyCounts(),
    'meshes',
    warnings,
  ),
  textures: addCounts(target.textures, value.textures, 'textures', warnings),
  animations: addCounts(target.animations, value.animations, 'animations', warnings),
});

export const buildTraceLogReport = (text: string): TraceLogReport => {
  const parsed = parseTraceLogText(text);
  const generatedAt = new Date().toISOString();
  if (!parsed.ok) {
    return {
      schemaVersion: TRACE_LOG_SCHEMA_VERSION,
      generatedAt,
      steps: 0,
      errors: 1,
      routes: { tool: 0 },
      ops: {},
      warnings: parsed.warnings ?? [],
      lastError: {
        seq: 0,
        op: 'parse',
        code: parsed.error.code,
        message: parsed.error.message,
      },
    };
  }

  const steps = parsed.records.filter(isTraceLogEntry);
  const warnings = new Set(parsed.warnings ?? []);
  const opSummaries = new Map<string, { count: number; errors: number }>();
  const report: TraceLogReport = {
    schemaVersion: TRACE_LOG_SCHEMA_VERSION,
    generatedAt,
    steps: steps.length,
    errors: 0,
    routes: { tool: 0 },
    ops: {},
    diffCounts: emptyCountsByKind(),
  };

  steps.forEach((entry) => {
    report.routes.tool += 1;
    const opSummary = opSummaries.get(entry.op) ?? { count: 0, errors: 0 };
    opSummary.count += 1;
    if (!entry.response.ok) {
      opSummary.errors += 1;
      report.errors += 1;
      report.lastError = {
        seq: entry.seq,
        op: entry.op,
        code: entry.response.error.code,
        message: entry.response.error.message,
      };
    }
    opSummaries.set(entry.op, opSummary);
    if (entry.diff && report.diffCounts) {
      report.diffCounts = addCountsByKind(report.diffCounts, entry.diff.counts, warnings);
    }
    if (!report.firstTs || entry.ts < report.firstTs) report.firstTs = entry.ts;
    if (!report.lastTs || entry.ts > report.lastTs) report.lastTs = entry.ts;
  });

  report.ops = Object.fromEntries(opSummaries);

  if (warnings.size > 0) report.warnings = [...warnings];
  return report;
};
