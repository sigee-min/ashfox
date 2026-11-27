export type {
  VirtualLibraryDescriptor,
  VirtualLibraryDomain,
  VirtualModuleDescription,
  VirtualModuleExport,
  VirtualModuleParam,
} from './contract';
export {
  STD_LIBRARY_PREFIX,
  STD_LOGICAL_ROOT,
  buildStdPackageEntry,
  describeVirtualModule,
  extractSourceImports,
  filterVirtualLibraries,
  isStdLibraryLogicalPath,
  isVirtualLibrarySpecifier,
  listVirtualLibraries,
  mergeVirtualLibraryFiles,
  resolveImportPath,
  resolveSourceImport,
  virtualLibraryLogicalPath,
  virtualLibrarySpecifierFromPath,
  type VirtualFileLookup,
} from './resolve';
