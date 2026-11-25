export declare const PROJECT_DOCUMENT_SCHEMA_VERSION: 1;
export declare const COMMAND_RECEIPT_SCHEMA_VERSION: 1;
export declare const EXPORT_BUNDLE_SCHEMA_VERSION: 1;
export declare const SKILL_RELEASE_DESCRIPTOR_SCHEMA_VERSION: 2;

export declare const isClosedContractRecord: (
  value: unknown,
) => value is Readonly<Record<string, unknown>>;
export declare const isDenseContractArray: (value: unknown) => value is readonly unknown[];
export declare const hasExactContractKeys: (value: object, keys: ReadonlySet<string>) => boolean;
export declare const isCanonicalIsoDate: (value: unknown) => value is string;
export declare const isNonEmptyContractText: (value: unknown) => value is string;
export declare const isUniqueContractTextArray: (value: unknown) => value is readonly string[];
export declare const utf8ContractByteLength: (value: string) => number;
