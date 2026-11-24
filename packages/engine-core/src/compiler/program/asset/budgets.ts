/** Compiler-private limits for an asset bundle.  They bound work before any
 * target materialization is attempted. */
export const ASSET_BUDGET = Object.freeze({
  files: 128,
  declarations: 4096,
  symbols: 4096,
  diagnostics: 256,
  treeNodes: 16384,
  importDepth: 64,
  motionFrames: 300,
});

export class AssetBudgetAbort extends Error {
  constructor() {
    super('asset budget exceeded');
    this.name = 'AssetBudgetAbort';
  }
}
