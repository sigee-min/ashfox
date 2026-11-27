export declare const PROJECT_DOCUMENT_SCHEMA_VERSION: 1;
export declare const EXPORT_BUNDLE_SCHEMA_VERSION: 1;
export declare const SKILL_RELEASE_DESCRIPTOR_SCHEMA_VERSION: 2;
export declare const DEFAULT_AUDIT_THRESHOLD: 75;

export type AuditQualityGrade = 'fail' | 'needs_work' | 'pass' | 'excellent';

export interface AuditSubmetricShape {
  readonly id: string;
  readonly label: string;
  readonly score: number;
  readonly maxScore: number;
  readonly value: number;
  readonly target: number;
  readonly detail: string;
}

export interface AuditDeductionRankable {
  readonly metricId: string;
  readonly lostPoints: number;
}

export declare const compareText: (left: string, right: string) => number;
export declare const encodeUtf8: (value: string) => Uint8Array;
export declare const decodeUtf8: (bytes: Uint8Array) => string;
export declare const clamp01: (value: number) => number;
export declare const ramp: (value: number, low: number, high: number) => number;
export declare const round2: (value: number) => number;
export declare const round4: (value: number) => number;
export declare const auditSubmetric: (
  id: string,
  label: string,
  ratio: number,
  maxScore: number,
  value: number,
  target: number,
  detail: string,
) => AuditSubmetricShape;
export declare const gradeForAudit: (
  allGates: boolean,
  score: number,
  passed: boolean,
  threshold?: number,
) => AuditQualityGrade;
export declare const rankTopAuditDeductions: <
  TGate extends AuditDeductionRankable,
  TPillar extends AuditDeductionRankable,
>(
  gateDeductions: readonly TGate[],
  pillarDeductions: readonly TPillar[],
  limit?: number,
) => readonly (TGate | TPillar)[];

export declare const isClosedContractRecord: (
  value: unknown,
) => value is Readonly<Record<string, unknown>>;
export declare const isDenseContractArray: (value: unknown) => value is readonly unknown[];
export declare const hasExactContractKeys: (value: object, keys: ReadonlySet<string>) => boolean;
export declare const isCanonicalIsoDate: (value: unknown) => value is string;
export declare const isNonEmptyContractText: (value: unknown) => value is string;
export declare const isUniqueContractTextArray: (value: unknown) => value is readonly string[];
export declare const utf8ContractByteLength: (value: string) => number;
export declare const damerauLevenshtein: (left: string, right: string) => number;
export declare const toSnakeCaseTrap: (raw: string) => string | null;
export declare const suggestClosest: (
  input: string,
  candidates: Iterable<string>,
  maxDistance?: number,
) => string | null;
