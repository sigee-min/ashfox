import { ExportGltfParams, ExportPort, ExportNativeParams } from '../../ports/exporter';
import { ToolError } from '../../types/internal';
import { errorMessage, Logger } from '../../logging';
import { BlockbenchCodec, FormatEntry, readBlockbenchGlobals } from '../../types/blockbench';
import { loadNativeModule } from '../../shared/nativeModules';
import {
  ADAPTER_BLOCKBENCH_WRITEFILE_UNAVAILABLE,
  ADAPTER_FILESYSTEM_WRITE_UNAVAILABLE,
  ADAPTER_GLTF_CODEC_UNAVAILABLE,
  ADAPTER_GLTF_WRITE_UNAVAILABLE,
  ADAPTER_NATIVE_COMPILER_ASYNC_UNSUPPORTED,
  ADAPTER_NATIVE_COMPILER_EMPTY,
  ADAPTER_NATIVE_COMPILER_UNAVAILABLE
} from '../../shared/messages';

export class BlockbenchExport implements ExportPort {
  private readonly log: Logger;

  constructor(log: Logger) {
    this.log = log;
  }

  exportNative(params: ExportNativeParams): ToolError | null {
    try {
      const blockbench = readBlockbenchGlobals().Blockbench;
      if (!blockbench?.writeFile) {
        return { code: 'not_implemented', message: ADAPTER_BLOCKBENCH_WRITEFILE_UNAVAILABLE };
      }
      const format = getFormatById(params.formatId);
      const compiler = resolveCompiler(format);
      if (!compiler) {
        return { code: 'not_implemented', message: ADAPTER_NATIVE_COMPILER_UNAVAILABLE(params.formatId) };
      }
      const compiled = compiler();
      const text = resolveTextCompile(compiled);
      if (!text.ok) return text.error;
      blockbench.writeFile(params.destPath, { content: text.value, savetype: 'text' });
      return null;
    } catch (err) {
      const message = errorMessage(err, 'native export failed');
      this.log.error('native export error', { message });
      return { code: 'io_error', message };
    }
  }

  async exportGltf(params: ExportGltfParams): Promise<ToolError | null> {
    try {
      const globals = readBlockbenchGlobals();
      const codec = getGltfCodec(globals);
      if (!codec) {
        return { code: 'not_implemented', message: ADAPTER_GLTF_CODEC_UNAVAILABLE };
      }
      const compiler = resolveCodecCompiler(codec);
      if (!compiler) {
        return { code: 'not_implemented', message: ADAPTER_NATIVE_COMPILER_UNAVAILABLE('gltf') };
      }
      const compiled = await resolveCompile(compiler());
      if (compiled === null || compiled === undefined) {
        return { code: 'not_implemented', message: ADAPTER_NATIVE_COMPILER_EMPTY };
      }

      const writeErr = await writeWithCodec(codec, compiled, params.destPath);
      if (!writeErr) return null;

      const blockbench = globals.Blockbench;
      if (canFallbackFromCodecWriteError(writeErr) && blockbench?.writeFile && (typeof compiled === 'string' || isPlainObject(compiled))) {
        const serialized = typeof compiled === 'string' ? compiled : JSON.stringify(compiled ?? {}, null, 2);
        blockbench.writeFile(params.destPath, { content: serialized, savetype: 'text' });
        return null;
      }
      const binary = canFallbackFromCodecWriteError(writeErr) ? toBinary(compiled) : null;
      if (binary) {
        const fsErr = writeBinaryFile(params.destPath, binary);
        if (!fsErr) return null;
        return fsErr;
      }
      return writeErr;
    } catch (err) {
      const message = errorMessage(err, 'gltf export failed');
      this.log.error('gltf export error', { message });
      return { code: 'io_error', message };
    }
  }
}

function getFormatById(formatId: string): FormatEntry | null {
  const globals = readBlockbenchGlobals();
  const formats = globals.Formats ?? globals.ModelFormat?.formats ?? null;
  if (!formats || typeof formats !== 'object') return null;
  return formats[formatId] ?? null;
}

function resolveCompiler(format: FormatEntry | null): (() => unknown) | null {
  if (!format) return null;
  const compile = format.compile;
  if (typeof compile === 'function') {
    return () => compile.call(format);
  }
  return resolveCodecCompiler(format.codec ?? null);
}

function isThenable(value: unknown): value is { then: (onFulfilled: (arg: unknown) => unknown) => unknown } {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { then?: unknown };
  return typeof candidate.then === 'function';
}

function resolveCodecCompiler(codec: BlockbenchCodec | null): (() => unknown) | null {
  if (!codec) return null;
  const compile = codec.compile;
  if (typeof compile !== 'function') return null;
  return () => compile.call(codec);
}

function resolveTextCompile(compiled: unknown): { ok: true; value: string } | { ok: false; error: ToolError } {
  if (compiled === null || compiled === undefined) {
    return { ok: false, error: { code: 'not_implemented', message: ADAPTER_NATIVE_COMPILER_EMPTY } };
  }
  if (isThenable(compiled)) {
    return { ok: false, error: { code: 'not_implemented', message: ADAPTER_NATIVE_COMPILER_ASYNC_UNSUPPORTED } };
  }
  const value = typeof compiled === 'string' ? compiled : JSON.stringify(compiled ?? {}, null, 2);
  return { ok: true, value };
}

async function resolveCompile(compiled: unknown): Promise<unknown> {
  if (!isThenable(compiled)) return compiled;
  return await compiled;
}

function getGltfCodec(globals: ReturnType<typeof readBlockbenchGlobals>): BlockbenchCodec | null {
  const codecs = globals.Codecs;
  if (!codecs || typeof codecs !== 'object') return null;
  const known = ['gltf', 'glb', 'gltf_model', 'gltf_codec'];
  for (const key of known) {
    const codec = codecs[key];
    if (codec) return codec;
  }
  const values = Object.values(codecs).filter(Boolean) as BlockbenchCodec[];
  const found = values.find((codec) => {
    const id = String(codec.id ?? '').toLowerCase();
    const name = String(codec.name ?? '').toLowerCase();
    const extension = String(codec.extension ?? '').toLowerCase();
    return id.includes('gltf') || name.includes('gltf') || extension === 'gltf' || extension === 'glb';
  });
  return found ?? null;
}

async function writeWithCodec(codec: BlockbenchCodec, compiled: unknown, destPath: string): Promise<ToolError | null> {
  const write = codec.write;
  if (typeof write !== 'function') {
    return { code: 'not_implemented', message: ADAPTER_GLTF_WRITE_UNAVAILABLE };
  }
  const writeResult = write.call(codec, compiled, destPath);
  if (isThenable(writeResult)) {
    await writeResult;
  }
  return null;
}

function canFallbackFromCodecWriteError(error: ToolError): boolean {
  return error.code === 'not_implemented' && error.message === ADAPTER_GLTF_WRITE_UNAVAILABLE;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function toBinary(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) return value;
  if (value instanceof ArrayBuffer) return new Uint8Array(value);
  if (!value || typeof value !== 'object') return null;
  const withBuffer = value as { buffer?: unknown };
  if (withBuffer.buffer instanceof ArrayBuffer) {
    return new Uint8Array(withBuffer.buffer);
  }
  return null;
}

type FsModule = {
  writeFileSync: (path: string, data: Uint8Array) => void;
};

function writeBinaryFile(destPath: string, data: Uint8Array): ToolError | null {
  const fs = loadNativeModule<FsModule>('fs', { optional: true });
  if (!fs) return { code: 'not_implemented', message: ADAPTER_FILESYSTEM_WRITE_UNAVAILABLE };
  try {
    fs.writeFileSync(destPath, data);
    return null;
  } catch (err) {
    const message = errorMessage(err, 'binary write failed');
    return { code: 'io_error', message };
  }
}



