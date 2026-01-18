export type UnknownRecord = Record<string, unknown>;

export interface BlockbenchProject {
  name?: string;
  uuid?: string;
  id?: string;
  uid?: string;
  saved?: boolean;
  isSaved?: boolean;
  dirty?: boolean;
  isDirty?: boolean;
  unsaved?: boolean;
  hasUnsavedChanges?: () => boolean;
  markSaved?: () => void;
}

export interface BlockbenchApi {
  version?: string;
  isWeb?: boolean;
  project?: BlockbenchProject;
  hasUnsavedChanges?: () => boolean;
  newProject?: (formatId: string) => void;
  setProjectName?: (name: string) => void;
  edit?: (aspects: UnknownRecord, fn: () => void) => void;
  textPrompt?: (title: string, value?: string, cb?: () => void) => Promise<string | null> | void;
  showQuickMessage?: (message: string, timeoutMs?: number) => void;
  exportFile?: (payload: { content: unknown; name: string }, onExport?: () => void) => void;
  writeFile?: (path: string, options: { content: string; savetype: 'text' | 'image' }) => void;
  dispatchEvent?: (name: string, payload?: UnknownRecord) => void;
}

export interface FormatEntry {
  name?: string;
  new?: () => void;
  compile?: () => unknown;
  codec?: { compile?: () => unknown };
}

export interface FormatSelection {
  id?: string;
}

export interface ModelFormatApi {
  selected?: FormatSelection | null;
  formats?: Record<string, FormatEntry>;
  new?: () => void;
}

export interface TextureInstance {
  id?: string;
  name?: string;
  path?: string;
  source?: string;
  width?: number;
  height?: number;
  img?: HTMLImageElement;
  canvas?: HTMLCanvasElement;
  bbmcpId?: string;
  fromDataURL?: (dataUri: string) => void;
  loadFromDataURL?: (dataUri: string) => void;
  add?: () => void;
  load?: () => void;
  select?: () => void;
  rename?: (newName: string) => void;
  remove?: () => void;
  delete?: () => void;
  dispose?: () => void;
  getDataUrl?: () => string;
  getBase64?: () => string;
  toDataURL?: (mime?: string) => string;
}

export interface TextureConstructor {
  new (options: { name: string }): TextureInstance;
  all?: TextureInstance[];
}

export interface OutlinerNode {
  name?: string;
  parent?: OutlinerNode | null;
  children?: OutlinerNode[];
  bbmcpId?: string;
  uuid?: string;
  id?: string;
  uid?: string;
  _uuid?: string;
  addTo?: (parent: OutlinerNode) => void;
  remove?: () => void;
  delete?: () => void;
  dispose?: () => void;
  rename?: (name: string) => void;
}

export interface GroupInstance extends OutlinerNode {
  origin?: [number, number, number] | { x: number; y: number; z: number };
  pivot?: [number, number, number] | { x: number; y: number; z: number };
  rotation?: [number, number, number] | { x: number; y: number; z: number };
  scale?: [number, number, number] | { x: number; y: number; z: number };
  init?: () => GroupInstance | void;
}

export interface GroupConstructor {
  new (options: UnknownRecord): GroupInstance;
}

export interface CubeInstance extends OutlinerNode {
  from?: [number, number, number] | { x: number; y: number; z: number };
  to?: [number, number, number] | { x: number; y: number; z: number };
  uv_offset?: [number, number] | { x: number; y: number };
  inflate?: number;
  mirror?: boolean;
  mirror_uv?: boolean;
  init?: () => CubeInstance | void;
}

export interface CubeConstructor {
  new (options: UnknownRecord): CubeInstance;
}

export interface OutlinerApi {
  root?: OutlinerNode[] | { children?: OutlinerNode[] };
}

export interface UndoApi {
  initEdit?: (aspects: UnknownRecord) => void;
  finishEdit?: (label: string) => void;
}

export interface AnimationClip {
  id?: string;
  name?: string;
  length?: number;
  animation_length?: number;
  duration?: number;
  loop?: boolean | string;
  snapping?: number;
  fps?: number;
  animators?: UnknownRecord;
  keyframes?: UnknownRecord[];
  time?: number;
  select?: () => void;
  setTime?: (time: number) => void;
}

export interface AnimatorApi {
  time?: number;
  setTime?: (time: number) => void;
  preview?: (time: number) => void;
}

export interface AnimationApi {
  all?: AnimationClip[];
  selected?: AnimationClip | null;
}

export interface PreviewItem {
  canvas?: HTMLCanvasElement | null;
}

export interface PreviewRegistry {
  selected?: PreviewItem | null;
  all?: PreviewItem[];
}

export interface DialogApi {
  open?: UnknownRecord;
  getFormResult?: () => UnknownRecord | null;
  setFormValues?: (values: UnknownRecord, silent?: boolean) => void;
  confirm?: () => void;
}

export interface PluginsApi {
  devReload?: () => void;
  path?: string;
  registered?: UnknownRecord;
}

export interface MenuBarApi {
  addAction: (action: UnknownRecord, section?: string) => void;
}

export interface PluginApi {
  register: (id: string, config: UnknownRecord) => void;
}

export interface SettingConstructor {
  new (id: string, options: UnknownRecord): { value?: unknown };
}

export interface CodecConstructor {
  new (options: UnknownRecord): unknown;
}

export interface BlockbenchGlobals {
  Blockbench?: BlockbenchApi;
  Texture?: TextureConstructor;
  Group?: GroupConstructor;
  Cube?: CubeConstructor;
  Animator?: AnimatorApi;
  Animation?: AnimationApi;
  Animations?: AnimationClip[];
  Outliner?: OutlinerApi;
  ModelFormat?: ModelFormatApi;
  Formats?: Record<string, FormatEntry>;
  Format?: FormatSelection | null;
  Undo?: UndoApi;
  Preview?: PreviewRegistry;
  Dialog?: DialogApi;
  Plugins?: PluginsApi;
  MenuBar?: MenuBarApi;
  Plugin?: PluginApi;
  Setting?: SettingConstructor;
  Codec?: CodecConstructor;
  Project?: BlockbenchProject;
  crypto?: Crypto;
  document?: Document;
}

export const readBlockbenchGlobals = (): BlockbenchGlobals =>
  globalThis as unknown as BlockbenchGlobals;
