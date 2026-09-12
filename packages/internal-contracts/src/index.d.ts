export declare const PROJECT_DOCUMENT_SCHEMA_VERSION: 1;
export declare const COMMAND_RECEIPT_SCHEMA_VERSION: 1;
export declare const EXPORT_BUNDLE_SCHEMA_VERSION: 1;
export declare const SIDECAR_IPC_SCHEMA_VERSION: 1;
export declare const TRACE_LOG_SCHEMA_VERSION: 1;
export declare const SKILL_RELEASE_DESCRIPTOR_SCHEMA_VERSION: 2;

export declare const isClosedContractRecord: (
  value: unknown
) => value is Readonly<Record<string, unknown>>;
export declare const isDenseContractArray: (
  value: unknown
) => value is readonly unknown[];
export type FiniteJsonValue =
  | null
  | string
  | boolean
  | number
  | FiniteJsonValue[]
  | { [key: string]: FiniteJsonValue };
export type FiniteJsonSnapshotResult =
  | { ok: true; value: unknown }
  | { ok: false };
export declare const createFiniteJsonSnapshot: (
  value: unknown,
  options?: {
    depthAllowance?: number;
    omitUndefinedObjectProperties?: boolean;
    objectPrototype?: 'null' | 'standard';
  }
) => FiniteJsonSnapshotResult;
export declare const FINITE_JSON_CONTRACT_MAX_DEPTH: 64;
export declare const FINITE_JSON_CONTRACT_MAX_CONTAINERS: 100000;
export declare const isFiniteJsonValue: (
  value: unknown
) => value is FiniteJsonValue;
export declare const hasExactContractKeys: (
  value: object,
  keys: ReadonlySet<string>
) => boolean;
export declare const isCanonicalIsoDate: (
  value: unknown
) => value is string;
export declare const isNonEmptyContractText: (
  value: unknown
) => value is string;
export declare const isUniqueContractTextArray: (
  value: unknown
) => value is readonly string[];
export declare const utf8ContractByteLength: (value: string) => number;
