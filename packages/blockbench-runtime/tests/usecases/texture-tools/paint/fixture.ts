import { DEFAULT_ANIMATION_TIME_POLICY } from '../../../../src/domain/animation/timePolicy';
import { DEFAULT_UV_POLICY } from '../../../../src/domain/uv/policy';
import { computeTextureUsageId } from '../../../../src/domain/textureUsage';
import type { EditorPort } from '../../../../src/ports/editor';
import type { SessionState } from '../../../../src/session';
import type {
  Capabilities,
  PaintTexturePayload,
  TextureUsageResult,
  ToolError,
} from '@ashfox/blockbench-contracts/types/internal';
import { toDomainTextureUsage } from '../../../../src/usecases/domainMappers';
import type { TextureToolContext } from '../../../../src/usecases/textureTools/context';

const capabilities: Capabilities = {
  pluginVersion: 'test',
  blockbenchVersion: 'test',
  formats: [{ format: 'geckolib', animations: true, enabled: true }],
  limits: { maxCubes: 256, maxTextureSize: 64, maxAnimationSeconds: 120 },
};

type HarnessOptions = {
  usage?: TextureUsageResult;
  usageError?: ToolError;
  projectResolution?: { width: number; height: number } | null;
  noRenderer?: boolean;
  renderError?: ToolError;
  renderWithoutResult?: boolean;
  importError?: ToolError;
  updateError?: ToolError;
  snapshotTextures?: SessionState['textures'];
  snapshotCubes?: SessionState['cubes'];
  policy?: Partial<typeof DEFAULT_UV_POLICY>;
};

export const createUsage = (
  textureName = 'atlas',
  uv: [number, number, number, number] = [0, 0, 16, 16],
): TextureUsageResult => ({
  textures: [
    {
      id: 'tex1',
      name: textureName,
      width: 16,
      height: 16,
      cubeCount: 1,
      faceCount: 1,
      cubes: [
        {
          id: 'cube1',
          name: 'cube',
          faces: [{ face: 'north', uv }],
        },
      ],
    },
  ],
});

export const usageIdFor = (
  usage: TextureUsageResult,
  resolution = { width: 16, height: 16 },
): string => computeTextureUsageId(toDomainTextureUsage(usage), resolution);

export const createHarness = (options: HarnessOptions = {}) => {
  const image = { tag: 'image' } as unknown as CanvasImageSource;
  const usage = options.usage ?? createUsage();
  const projectResolution = options.projectResolution ?? {
    width: 16,
    height: 16,
  };
  const calls = { importCount: 0, updateCount: 0, renderCount: 0 };
  const editor = {
    getTextureUsage: () => {
      if (options.usageError) return { error: options.usageError };
      return { result: usage };
    },
    getProjectTextureResolution: () => projectResolution,
  } as unknown as EditorPort;
  const snapshot: SessionState = {
    id: 'p1',
    format: 'geckolib',
    formatId: 'geckolib_model',
    name: 'demo',
    dirty: false,
    uvPixelsPerBlock: undefined,
    bones: [{ name: 'root', pivot: [0, 0, 0] }],
    cubes: options.snapshotCubes ?? [
      {
        id: 'cube1',
        name: 'cube',
        bone: 'root',
        from: [0, 0, 0],
        to: [16, 16, 16],
      },
    ],
    textures: options.snapshotTextures ?? [
      {
        id: 'tex1',
        name: 'atlas',
        width: 16,
        height: 16,
      },
    ],
    animations: [],
    animationsStatus: 'available',
    animationTimePolicy: DEFAULT_ANIMATION_TIME_POLICY,
  };
  const ctx: TextureToolContext = {
    ensureActive: () => null,
    ensureRevisionMatch: () => null,
    getSnapshot: () => snapshot,
    editor,
    textureRenderer: options.noRenderer
      ? undefined
      : {
          renderPixels: () => {
            calls.renderCount += 1;
            if (options.renderError) return { error: options.renderError };
            if (options.renderWithoutResult) return {};
            return { result: { image, width: 16, height: 16 } };
          },
        },
    capabilities,
    getUvPolicyConfig: () => ({
      ...DEFAULT_UV_POLICY,
      scaleTolerance: 2,
      ...(options.policy ?? {}),
    }),
    importTexture: () => {
      calls.importCount += 1;
      if (options.importError) {
        return { ok: false, error: options.importError };
      }
      return { ok: true, value: { id: 'tex_new', name: 'atlas_new' } };
    },
    updateTexture: () => {
      calls.updateCount += 1;
      if (options.updateError) {
        return { ok: false, error: options.updateError };
      }
      return { ok: true, value: { id: 'tex1', name: 'atlas' } };
    },
  };
  return { ctx, usage, calls };
};

export const fillOp = {
  op: 'fill_rect',
  x: 0,
  y: 0,
  width: 4,
  height: 4,
  color: '#228833',
} as const;

export const createPayload = (
  override: Partial<PaintTexturePayload> = {},
): PaintTexturePayload => ({
  mode: 'create',
  name: 'atlas_new',
  width: 16,
  height: 16,
  ops: [fillOp],
  ...override,
});

export const updatePayload = (
  override: Partial<PaintTexturePayload> = {},
): PaintTexturePayload => ({
  mode: 'update',
  targetName: 'atlas',
  width: 16,
  height: 16,
  ops: [fillOp],
  ...override,
});
