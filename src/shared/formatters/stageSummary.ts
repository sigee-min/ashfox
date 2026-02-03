type StageReportCounts = {
  bones: number;
  cubes: number;
};

type StageReportSummary = {
  created?: StageReportCounts;
  updated?: StageReportCounts;
  deleted?: StageReportCounts;
};

export type StageSummary = {
  label?: string;
  plan?: Record<string, number>;
  warnings?: number;
  ops?: { count: number };
  report?: StageReportSummary;
  preview?: { kind?: string; frameCount?: number };
  validate?: { total: number; errors: number; warnings: number; info: number };
};

type StageResultLike = {
  label?: unknown;
  plan?: unknown;
  warnings?: unknown;
  ops?: unknown;
  report?: unknown;
  preview?: unknown;
  validate?: unknown;
};

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

const isStageResultLike = (value: unknown): value is StageResultLike =>
  isRecord(value) && 'plan' in value && isRecord((value as Record<string, unknown>).plan);

const countArray = (value: unknown): number | undefined => (Array.isArray(value) ? value.length : undefined);

const summarizeReportCounts = (value: unknown): StageReportCounts | undefined => {
  if (!isRecord(value)) return undefined;
  const bones = countArray(value.bones) ?? 0;
  const cubes = countArray(value.cubes) ?? 0;
  if (bones === 0 && cubes === 0) return undefined;
  return { bones, cubes };
};

const summarizeReport = (value: unknown): StageReportSummary | undefined => {
  if (!isRecord(value)) return undefined;
  const created = summarizeReportCounts(value.created);
  const updated = summarizeReportCounts(value.updated);
  const deleted = summarizeReportCounts(value.deleted);
  if (!created && !updated && !deleted) return undefined;
  return {
    ...(created ? { created } : {}),
    ...(updated ? { updated } : {}),
    ...(deleted ? { deleted } : {})
  };
};

const summarizePreview = (value: unknown): StageSummary['preview'] | undefined => {
  if (!isRecord(value)) return undefined;
  const kind = typeof value.kind === 'string' ? value.kind : undefined;
  const frameCount = typeof value.frameCount === 'number' ? value.frameCount : undefined;
  if (!kind && frameCount === undefined) return undefined;
  return { ...(kind ? { kind } : {}), ...(frameCount !== undefined ? { frameCount } : {}) };
};

const summarizeValidate = (value: unknown): StageSummary['validate'] | undefined => {
  if (!isRecord(value) || !Array.isArray(value.findings)) return undefined;
  let errors = 0;
  let warnings = 0;
  let info = 0;
  value.findings.forEach((finding) => {
    if (!isRecord(finding)) return;
    const severity = finding.severity;
    if (severity === 'error') errors += 1;
    else if (severity === 'warning') warnings += 1;
    else if (severity === 'info') info += 1;
  });
  const total = errors + warnings + info;
  if (total === 0) return undefined;
  return { total, errors, warnings, info };
};

export const summarizeStageResult = (stage: StageResultLike): StageSummary => {
  const summary: StageSummary = {};
  if (typeof stage.label === 'string') summary.label = stage.label;
  if (isRecord(stage.plan)) summary.plan = stage.plan as Record<string, number>;
  if (Array.isArray(stage.warnings)) summary.warnings = stage.warnings.length;
  if (Array.isArray(stage.ops)) summary.ops = { count: stage.ops.length };
  const report = summarizeReport(stage.report);
  if (report) summary.report = report;
  const preview = summarizePreview(stage.preview);
  if (preview) summary.preview = preview;
  const validate = summarizeValidate(stage.validate);
  if (validate) summary.validate = validate;
  return summary;
};

export const summarizeStageResults = (value: unknown): StageSummary[] | null => {
  if (!Array.isArray(value) || value.length === 0) return null;
  if (!value.every(isStageResultLike)) return null;
  return value.map((stage) => summarizeStageResult(stage));
};
