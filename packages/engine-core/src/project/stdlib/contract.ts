export type VirtualLibraryDomain = 'core' | 'model' | 'sprite' | 'vfx' | 'sound' | 'structure';

export interface VirtualModuleExport {
  readonly kind: string;
  readonly name: string;
  readonly target?: string;
}

export interface VirtualModuleParam {
  readonly name: string;
  readonly type?: string;
  readonly defaultValue?: string;
}

export interface VirtualLibraryDescriptor {
  readonly specifier: string;
  readonly id: string;
  readonly logicalPath: string;
  readonly domain: string;
  readonly category: string;
  readonly module: string;
  readonly unitId: string;
}

export interface VirtualModuleDescription extends VirtualLibraryDescriptor {
  readonly imports: readonly string[];
  readonly exports: readonly VirtualModuleExport[];
  readonly params: readonly VirtualModuleParam[];
  readonly source: string;
}
