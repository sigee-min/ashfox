import assert from 'node:assert/strict';

import { ProjectSession } from '../src/session';
import { ExportService } from '../src/usecases/ExportService';
import type { Capabilities, ToolError } from '../src/types';
import type { NativeCodecTarget } from '../src/ports/exporter';
import { createEditorStubWithState, createFormatPortStub } from './fakes';
import { registerAsync } from './helpers';
import {
  EXPORT_CODEC_ID_EMPTY,
  EXPORT_CODEC_ID_FORBIDDEN,
  EXPORT_CODEC_ID_REQUIRED,
  EXPORT_CODEC_UNSUPPORTED,
  EXPORT_FORMAT_MISMATCH,
  EXPORT_FORMAT_NOT_ENABLED
} from '../src/shared/messages';

type HarnessOptions = {
  capabilities?: Capabilities;
  exportPolicy?: 'strict' | 'best_effort';
  nativeError?: ToolError | null;
  nativeThrow?: unknown;
  gltfError?: ToolError | null;
  codecError?: ToolError | null;
  writeFileError?: ToolError | null;
  snapshotOverride?: ReturnType<ProjectSession['snapshot']>;
  ensureActiveError?: ToolError | null;
  listFormats?: Array<{ id: string; name: string }>;
  nativeCodecs?: NativeCodecTarget[];
  disableCodecExport?: boolean;
  matchOverrideKind?: () => 'Java Block/Item' | 'geckolib' | 'animated_java' | 'Generic Model' | null;
};

const baseCapabilities = (): Capabilities => ({
  pluginVersion: 'test',
  blockbenchVersion: 'test',
  formats: [
    { format: 'Java Block/Item', animations: true, enabled: true },
    { format: 'geckolib', animations: true, enabled: true },
    { format: 'animated_java', animations: true, enabled: true },
    { format: 'Generic Model', animations: true, enabled: true }
  ],
  limits: { maxCubes: 64, maxTextureSize: 256, maxAnimationSeconds: 120 }
});

const createHarness = (options: HarnessOptions = {}) => {
  const session = new ProjectSession();
  const created = session.create('geckolib', 'dragon', 'geckolib_model');
  assert.equal(created.ok, true);
  const calls = { native: 0, gltf: 0, codec: 0 };
  const editorStub = createEditorStubWithState();
  const editor = {
    ...editorStub.editor,
    writeFile: (path: string, contents: string) => {
      if (options.writeFileError) return options.writeFileError;
      editorStub.state.writes.push({ path, contents });
      return null;
    }
  };
  const service = new ExportService({
    capabilities: options.capabilities ?? baseCapabilities(),
    editor,
    exporter: {
      exportNative: () => {
        calls.native += 1;
        if (options.nativeThrow !== undefined) {
          throw options.nativeThrow;
        }
        return options.nativeError ?? null;
      },
      exportGltf: () => {
        calls.gltf += 1;
        return options.gltfError ?? null;
      },
      ...(options.disableCodecExport
        ? {}
        : {
            exportCodec: () => {
              calls.codec += 1;
              return options.codecError ?? null;
            }
          }),
      listNativeCodecs: () => options.nativeCodecs ?? []
    },
    formats:
      options.listFormats === undefined
        ? createFormatPortStub('geckolib_model', 'GeckoLib')
        : {
            listFormats: () => options.listFormats ?? [],
            getActiveFormatId: () => null
          },
    projectState: {
      matchOverrideKind: options.matchOverrideKind ?? (() => null)
    } as never,
    getSnapshot: () => options.snapshotOverride ?? session.snapshot(),
    ensureActive: () => options.ensureActiveError ?? null,
    policies: {
      exportPolicy: options.exportPolicy ?? 'best_effort',
      formatOverrides: undefined
    }
  });
  return { service, writes: editorStub.state.writes, session, calls };
};

registerAsync(
  (async () => {
    {
      const { service } = createHarness();
      const res = await service.exportModel({ format: 'native_codec', destPath: 'model.obj' });
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error.code, 'invalid_payload');
        assert.equal(res.error.message, EXPORT_CODEC_ID_REQUIRED);
      }
    }

    {
      const { service } = createHarness();
      const res = await service.exportModel({ format: 'native_codec', codecId: '   ', destPath: 'model.obj' });
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error.code, 'invalid_payload');
        assert.equal(res.error.message, EXPORT_CODEC_ID_EMPTY);
      }
    }

    {
      const { service } = createHarness();
      const res = await service.exportModel({ format: 'gltf', codecId: 'obj', destPath: 'model.gltf' });
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error.code, 'invalid_payload');
        assert.equal(res.error.message, EXPORT_CODEC_ID_FORBIDDEN);
      }
    }

    {
      const { service, calls } = createHarness({
        codecError: null,
        nativeCodecs: [{ id: 'obj', label: 'OBJ', extensions: ['obj'] }]
      });
      const res = await service.exportModel({ format: 'native_codec', codecId: 'obj', destPath: 'model.obj' });
      assert.equal(res.ok, true);
      assert.equal(calls.codec, 1);
      assert.equal(calls.gltf, 0);
      assert.equal(calls.native, 0);
    }

    {
      const { service } = createHarness();
      const res = await service.exportModel({ format: 'native_codec', codecId: 'obj', destPath: 'model.obj' });
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error.code, 'unsupported_format');
        assert.equal(res.error.message, `${EXPORT_CODEC_UNSUPPORTED('obj')}.`);
      }
    }

    {
      const { service, calls } = createHarness({
        codecError: null,
        nativeCodecs: [{ id: 'gltf', label: 'glTF', extensions: ['gltf', 'glb'] }]
      });
      const res = await service.exportModel({ format: 'native_codec', codecId: '.GLB', destPath: 'model.glb' });
      assert.equal(res.ok, true);
      assert.equal(calls.codec, 1);
    }

    {
      const capabilities = baseCapabilities();
      capabilities.exportTargets = [
        { kind: 'internal', id: 'gecko_geo_anim', label: 'GeckoLib Geo+Anim JSON', available: true },
        { kind: 'gltf', id: 'gltf', label: 'glTF', extensions: ['gltf', 'glb'], available: true },
        { kind: 'native_codec', id: 'native_codec', label: 'Native Codec Export', available: true }
      ];
      const { service } = createHarness({
        capabilities,
        nativeCodecs: [
          { id: 'obj', label: 'OBJ', extensions: ['obj'] },
          { id: 'fbx', label: 'FBX', extensions: ['fbx'] }
        ]
      });
      const res = await service.exportModel({ format: 'native_codec', codecId: 'unknown', destPath: 'model.unknown' });
      assert.equal(res.ok, false);
      if (!res.ok) {
        const details = res.error.details as
          | { requestedCodecId?: string; availableCodecs?: Array<{ id: string }> }
          | undefined;
        assert.equal(details?.requestedCodecId, 'unknown');
        assert.equal(details?.availableCodecs?.length, 2);
        assert.equal(details?.availableCodecs?.[0]?.id, 'obj');
        assert.equal(details?.availableCodecs?.[1]?.id, 'fbx');
      }
    }

    {
      const capabilities = baseCapabilities();
      capabilities.exportTargets = [
        { kind: 'internal', id: 'gecko_geo_anim', label: 'GeckoLib Geo+Anim JSON', available: true },
        { kind: 'gltf', id: 'gltf', label: 'glTF', extensions: ['gltf', 'glb'], available: true },
        { kind: 'native_codec', id: 'native_codec', label: 'Native Codec Export', available: true }
      ];
      const { service } = createHarness({ capabilities });
      const res = await service.exportModel({ format: 'native_codec', codecId: 'obj', destPath: 'model.obj' });
      assert.equal(res.ok, false);
      if (!res.ok) {
        const recommended = res.error.details?.recommendedTarget as { id: string } | undefined;
        const availableTargets = res.error.details?.availableTargets as Array<{ id: string }> | undefined;
        assert.equal(recommended?.id, 'gecko_geo_anim');
        assert.equal(Array.isArray(availableTargets), true);
        assert.equal(availableTargets?.length, 3);
      }
    }

    {
      const genericSnapshot = {
        ...new ProjectSession().snapshot(),
        id: 'p_generic_hint',
        format: 'Generic Model' as const,
        formatId: 'free',
        name: 'generic_unit'
      };
      const capabilities = baseCapabilities();
      capabilities.exportTargets = [
        { kind: 'internal', id: 'generic_model_json', label: 'Generic Model JSON', available: true },
        { kind: 'gltf', id: 'gltf', label: 'glTF', extensions: ['gltf', 'glb'], available: true }
      ];
      const { service } = createHarness({
        capabilities,
        snapshotOverride: genericSnapshot
      });
      const res = await service.exportModel({ format: 'gecko_geo_anim', destPath: 'out.json' });
      assert.equal(res.ok, false);
      if (!res.ok) {
        const recommended = res.error.details?.recommendedTarget as { id: string } | undefined;
        assert.equal(recommended?.id, 'generic_model_json');
      }
    }

    {
      const { service } = createHarness({
        disableCodecExport: true,
        nativeCodecs: [{ id: 'obj', label: 'OBJ', extensions: ['obj'] }]
      });
      const res = await service.exportModel({ format: 'native_codec', codecId: 'obj', destPath: 'model.obj' });
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error.code, 'not_implemented');
      }
    }

    {
      const capabilities = baseCapabilities();
      capabilities.formats = [{ format: 'geckolib', animations: true, enabled: false }];
      const { service } = createHarness({ capabilities });
      const res = await service.exportModel({ format: 'gecko_geo_anim', destPath: 'out.json' });
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error.code, 'unsupported_format');
        assert.equal(res.error.message, `${EXPORT_FORMAT_NOT_ENABLED('geckolib')}.`);
      }
    }

    {
      const { service } = createHarness();
      const res = await service.exportModel({ format: 'java_block_item_json', destPath: 'out.json' });
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error.code, 'invalid_payload');
        assert.equal(res.error.message, `${EXPORT_FORMAT_MISMATCH}.`);
      }
    }

    {
      const { service } = createHarness({
        snapshotOverride: {
          ...new ProjectSession().snapshot(),
          id: 'p_override',
          format: null,
          formatId: 'unknown_format'
        }
      });
      const res = await service.exportModel({ format: 'gecko_geo_anim', destPath: 'out.json' });
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error.code, 'invalid_payload');
      }
    }

    {
      const { service } = createHarness({
        snapshotOverride: {
          ...new ProjectSession().snapshot(),
          id: 'p1',
          format: 'geckolib',
          formatId: null,
          name: 'dragon'
        },
        listFormats: []
      });
      const res = await service.exportModel({ format: 'gecko_geo_anim', destPath: 'out.json' });
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error.code, 'unsupported_format');
      }
    }

    {
      const { service } = createHarness({ nativeError: null });
      const res = await service.exportModel({ format: 'gecko_geo_anim', destPath: 'out.json' });
      assert.equal(res.ok, true);
      if (res.ok) {
        assert.equal(res.value.path, 'out.json');
        assert.equal(res.value.selectedTarget?.kind, 'internal');
        assert.equal(res.value.selectedTarget?.id, 'gecko_geo_anim');
        assert.equal(res.value.stage, 'done');
      }
    }

    {
      const { service } = createHarness({
        exportPolicy: 'strict',
        nativeError: { code: 'not_implemented', message: 'native unavailable' }
      });
      const res = await service.exportModel({ format: 'gecko_geo_anim', destPath: 'out.json' });
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error.code, 'not_implemented');
      }
    }

    {
      const { service, writes } = createHarness({
        exportPolicy: 'best_effort',
        nativeError: { code: 'not_implemented', message: 'native unavailable' }
      });
      const res = await service.exportModel({
        format: 'gecko_geo_anim',
        destPath: 'out.json',
        options: { includeDiagnostics: true }
      });
      assert.equal(res.ok, true);
      assert.equal(writes.length, 1);
      assert.equal(writes[0].path, 'out.json');
      if (res.ok) {
        assert.equal(res.value.stage, 'fallback');
        assert.deepEqual(res.value.warnings, ['native unavailable']);
      }
    }

    {
      const { service, writes } = createHarness({
        exportPolicy: 'strict',
        nativeThrow: new TypeError("Cannot read properties of undefined (reading 'compileAdapter')")
      });
      const res = await service.exportModel({
        format: 'gecko_geo_anim',
        destPath: 'out.json',
        options: { includeDiagnostics: true }
      });
      assert.equal(res.ok, true);
      assert.equal(writes.length, 1);
      if (res.ok) {
        assert.equal(res.value.stage, 'fallback');
        assert.deepEqual(res.value.warnings, ["Cannot read properties of undefined (reading 'compileAdapter')"]);
      }
    }

    {
      const { service, writes } = createHarness({
        exportPolicy: 'strict',
        nativeThrow: new Error('native crash')
      });
      const res = await service.exportModel({
        format: 'gecko_geo_anim',
        destPath: 'out.json',
        options: { includeDiagnostics: true }
      });
      assert.equal(res.ok, false);
      assert.equal(writes.length, 0);
      if (!res.ok) {
        assert.equal(res.error.code, 'io_error');
        assert.equal(res.error.message, 'native crash.');
      }
    }

    {
      const { service, writes } = createHarness({
        exportPolicy: 'best_effort',
        nativeError: { code: 'not_implemented', message: 'native unavailable' }
      });
      const res = await service.exportModel({
        format: 'gecko_geo_anim',
        destPath: 'out.json',
        options: { fallback: 'strict' }
      });
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error.code, 'not_implemented');
      }
      assert.equal(writes.length, 0);
    }

    {
      const { service, writes } = createHarness({
        exportPolicy: 'best_effort',
        nativeError: { code: 'io_error', message: 'disk failed' }
      });
      const res = await service.exportModel({ format: 'gecko_geo_anim', destPath: 'out.json' });
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error.code, 'io_error');
      }
      assert.equal(writes.length, 0);
    }

    {
      const { service } = createHarness({
        exportPolicy: 'best_effort',
        nativeError: { code: 'unsupported_format', message: 'native unavailable' },
        writeFileError: { code: 'io_error', message: 'write failed' }
      });
      const res = await service.exportModel({ format: 'gecko_geo_anim', destPath: 'out.json' });
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error.code, 'io_error');
      }
    }

    {
      const { service } = createHarness({
        ensureActiveError: { code: 'invalid_state', message: 'no active project' }
      });
      const res = await service.exportModel({ format: 'gecko_geo_anim', destPath: 'out.json' });
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error.code, 'invalid_state');
      }
    }

    {
      const genericSnapshot = {
        ...new ProjectSession().snapshot(),
        id: 'p_generic',
        format: 'Generic Model' as const,
        formatId: 'free',
        name: 'generic_unit',
        meshes: [
          {
            name: 'mesh_1',
            vertices: [
              { id: 'v0', pos: [0, 0, 0] as [number, number, number] },
              { id: 'v1', pos: [1, 0, 0] as [number, number, number] },
              { id: 'v2', pos: [0, 1, 0] as [number, number, number] }
            ],
            faces: [{ vertices: ['v0', 'v1', 'v2'] }]
          }
        ]
      };
      const { service, writes } = createHarness({
        exportPolicy: 'strict',
        nativeError: { code: 'not_implemented', message: 'native unavailable' },
        snapshotOverride: genericSnapshot
      });
      const res = await service.exportModel({ format: 'generic_model_json', destPath: 'generic.json' });
      assert.equal(res.ok, true);
      assert.equal(writes.length, 1);
      assert.equal(writes[0].path, 'generic.json');
      const payload = JSON.parse(writes[0].contents) as { format: string; meshes: unknown[] };
      assert.equal(payload.format, 'ashfox_generic_model');
      assert.equal(payload.meshes.length, 1);
    }

    {
      const { service, calls } = createHarness({ gltfError: null });
      const res = await service.exportModel({ format: 'gltf', destPath: 'model.glb' });
      assert.equal(res.ok, true);
      assert.equal(calls.gltf, 1);
      assert.equal(calls.native, 0);
    }

    {
      const { service, writes } = createHarness({
        exportPolicy: 'best_effort',
        gltfError: { code: 'not_implemented', message: 'gltf unavailable' }
      });
      const res = await service.exportModel({ format: 'gltf', destPath: 'model.gltf' });
      assert.equal(res.ok, false);
      if (!res.ok) {
        assert.equal(res.error.code, 'not_implemented');
      }
      assert.equal(writes.length, 0);
    }
  })()
);
