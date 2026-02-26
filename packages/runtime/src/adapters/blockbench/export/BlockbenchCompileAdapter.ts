import type { ToolError } from '@ashfox/contracts/types/internal';
import type { Logger } from '../../../logging';
import { errorMessage } from '../../../logging';
import type { NativeCodecTarget } from '../../../ports/exporter';
import type { BlockbenchCodec, FormatEntry } from '../../../types/blockbench';
import { readGlobals } from '../blockbenchUtils';
import {
  ADAPTER_GLTF_CODEC_UNAVAILABLE,
  ADAPTER_NATIVE_CODEC_UNAVAILABLE,
  ADAPTER_NATIVE_COMPILER_ASYNC_UNSUPPORTED,
  ADAPTER_NATIVE_COMPILER_EMPTY,
  ADAPTER_NATIVE_COMPILER_UNAVAILABLE
} from '../../../shared/messages';

export type CompiledCodecSelection = {
  codecId: string;
  codec: BlockbenchCodec;
  compiled: unknown;
};

type CompileFormatResult =
  | { ok: true; compiled: unknown }
  | { ok: false; error: ToolError };

type CompileCodecResult =
  | { ok: true; selection: CompiledCodecSelection }
  | { ok: false; error: ToolError };

type CodecSelection = {
  id: string;
  label: string;
  extensions: string[];
  codec: BlockbenchCodec;
};

type InvokeCompileResult =
  | { ok: true; value: unknown }
  | { ok: false; error: unknown };

type CompileOptions = {
  format: FormatEntry | null;
  formatId: string | null;
  codec: BlockbenchCodec | null;
  codecId: string | null;
  project: unknown;
  blockbench: unknown;
  codecs: unknown;
  formats: unknown;
  compileAdapter: Record<string, unknown>;
  options: { compileAdapter: Record<string, unknown>; project: unknown };
  context: { compileAdapter: Record<string, unknown>; project: unknown };
};

export class BlockbenchCompileAdapter {
  private readonly log: Logger;

  constructor(log: Logger) {
    this.log = log;
  }

  compileNativeFormat(formatId: string): CompileFormatResult {
    const format = getFormatById(formatId);
    const compiler = resolveFormatCompiler(format);
    if (!compiler) {
      return { ok: false, error: { code: 'not_implemented', message: ADAPTER_NATIVE_COMPILER_UNAVAILABLE(formatId) } };
    }
    const compileOptions = createCompileOptions({
      format,
      formatId,
      codec: format?.codec ?? null,
      codecId: normalizeToken(format?.codec?.id ?? '')
    });
    const invoked = invokeCompilerCompat(compiler, compileOptions);
    if (!invoked.ok) {
      const message = errorMessage(invoked.error, 'native compile failed');
      this.log.error('native compile error', { message, formatId });
      return { ok: false, error: { code: 'io_error', message } };
    }
    const compiled = invoked.value;
    if (compiled === null || compiled === undefined) {
      return { ok: false, error: { code: 'not_implemented', message: ADAPTER_NATIVE_COMPILER_EMPTY } };
    }
    if (isThenable(compiled)) {
      return { ok: false, error: { code: 'not_implemented', message: ADAPTER_NATIVE_COMPILER_ASYNC_UNSUPPORTED } };
    }
    return { ok: true, compiled };
  }

  async compileGltf(): Promise<CompileCodecResult> {
    const selected = resolveGltfCodec();
    if (!selected) {
      return { ok: false, error: { code: 'not_implemented', message: ADAPTER_GLTF_CODEC_UNAVAILABLE } };
    }
    return await this.compileCodecSelection(selected);
  }

  async compileCodec(codecId: string): Promise<CompileCodecResult> {
    const selected = resolveCodec(codecId);
    if (!selected) {
      return { ok: false, error: { code: 'not_implemented', message: ADAPTER_NATIVE_CODEC_UNAVAILABLE(codecId) } };
    }
    return await this.compileCodecSelection(selected);
  }

  listNativeCodecs(): NativeCodecTarget[] {
    return readCodecEntries().map((entry) => ({
      id: entry.id,
      label: entry.label,
      extensions: entry.extensions
    }));
  }

  private async compileCodecSelection(selection: CodecSelection): Promise<CompileCodecResult> {
    const compiler = resolveCodecCompiler(selection.codec);
    if (!compiler) {
      return {
        ok: false,
        error: { code: 'not_implemented', message: ADAPTER_NATIVE_COMPILER_UNAVAILABLE(selection.id) }
      };
    }
    const compileOptions = createCompileOptions({
      format: null,
      formatId: null,
      codec: selection.codec,
      codecId: selection.id
    });
    const invoked = invokeCompilerCompat(compiler, compileOptions);
    if (!invoked.ok) {
      const message = errorMessage(invoked.error, `codec compile failed: ${selection.id}`);
      this.log.error('codec compile error', { message, codecId: selection.id });
      return { ok: false, error: { code: 'io_error', message } };
    }

    let compiled: unknown;
    try {
      compiled = await resolveCompile(invoked.value);
    } catch (err) {
      const message = errorMessage(err, `codec compile failed: ${selection.id}`);
      this.log.error('codec compile error', { message, codecId: selection.id });
      return { ok: false, error: { code: 'io_error', message } };
    }
    if (compiled === null || compiled === undefined) {
      return { ok: false, error: { code: 'not_implemented', message: ADAPTER_NATIVE_COMPILER_EMPTY } };
    }
    return {
      ok: true,
      selection: {
        codecId: selection.id,
        codec: selection.codec,
        compiled
      }
    };
  }
}

const getFormatById = (formatId: string): FormatEntry | null => {
  const globals = readGlobals();
  const formats = globals.Formats ?? globals.ModelFormat?.formats ?? null;
  if (!formats || typeof formats !== 'object') return null;
  return formats[formatId] ?? null;
};

const resolveFormatCompiler = (format: FormatEntry | null): ((options?: CompileOptions) => unknown) | null => {
  if (!format) return null;
  if (typeof format.compile === 'function') {
    return (options?: CompileOptions) => (format.compile as (options?: CompileOptions) => unknown)(options);
  }
  return resolveCodecCompiler(format.codec ?? null);
};

const resolveCodecCompiler = (codec: BlockbenchCodec | null): ((options?: CompileOptions) => unknown) | null => {
  if (!codec) return null;
  if (typeof codec.compile !== 'function') return null;
  return (options?: CompileOptions) => (codec.compile as (options?: CompileOptions) => unknown)(options);
};

const isThenable = (value: unknown): value is { then: (onFulfilled: (arg: unknown) => unknown) => unknown } => {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as { then?: unknown };
  return typeof candidate.then === 'function';
};

const resolveCompile = async (compiled: unknown): Promise<unknown> => {
  if (!isThenable(compiled)) return compiled;
  return await compiled;
};

const shouldRetryWithOptions = (err: unknown): boolean => {
  if (!isTypeErrorLike(err)) return false;
  const message = String(err.message ?? '');
  if (!message.includes("Cannot read properties of undefined")) return false;
  return message.includes("compileAdapter") || message.includes("compile_adapter");
};

const isTypeErrorLike = (err: unknown): err is TypeError | { name?: unknown; message?: unknown } => {
  if (err instanceof TypeError) return true;
  if (!err || typeof err !== 'object') return false;
  return String((err as { name?: unknown }).name ?? '') === 'TypeError';
};

const invokeCompilerCompat = (
  compiler: (options?: CompileOptions) => unknown,
  options: CompileOptions
): InvokeCompileResult => {
  injectCompileAdapter(options.format, options.compileAdapter);
  injectCompileAdapter(options.codec, options.compileAdapter);
  try {
    return { ok: true, value: compiler() };
  } catch (err) {
    if (!shouldRetryWithOptions(err)) return { ok: false, error: err };
    try {
      return { ok: true, value: compiler(options) };
    } catch (retryErr) {
      return { ok: false, error: retryErr };
    }
  }
};

const createCompileOptions = (args: {
  format: FormatEntry | null;
  formatId: string | null;
  codec: BlockbenchCodec | null;
  codecId: string | null;
}): CompileOptions => {
  const globals = readGlobals();
  const project = globals.Project ?? globals.Blockbench?.project ?? null;
  const compileAdapter = createCompileAdapterCompat({
    project,
    format: args.format,
    codec: args.codec
  });
  return {
    format: args.format,
    formatId: args.formatId,
    codec: args.codec,
    codecId: args.codecId,
    project,
    blockbench: globals.Blockbench ?? null,
    codecs: globals.Codecs ?? null,
    formats: globals.Formats ?? globals.ModelFormat?.formats ?? null,
    compileAdapter,
    options: { compileAdapter, project },
    context: { compileAdapter, project }
  };
};

const injectCompileAdapter = (target: unknown, compileAdapter: Record<string, unknown>) => {
  if (!target || typeof target !== 'object') return;
  const candidate = target as Record<string, unknown>;
  if (!('compileAdapter' in candidate)) {
    candidate.compileAdapter = compileAdapter;
  }
};

const createCompileAdapterCompat = (args: {
  project: unknown;
  format: FormatEntry | null;
  codec: BlockbenchCodec | null;
}): Record<string, unknown> => ({
  project: args.project,
  format: args.format,
  codec: args.codec,
  stringify: (value: unknown) => {
    try {
      return JSON.stringify(value, null, 2);
    } catch (_err) {
      return String(value);
    }
  },
  clone: (value: unknown) => {
    try {
      return JSON.parse(JSON.stringify(value));
    } catch (_err) {
      return value;
    }
  }
});

const resolveGltfCodec = (): CodecSelection | null => {
  const entries = readCodecEntries();
  const known = ['gltf', 'glb', 'gltf_model', 'gltf_codec'];
  for (const key of known) {
    const entry = entries.find((candidate) => candidate.id === key);
    if (entry) return entry;
  }
  return (
    entries.find(
      (entry) =>
        entry.id.includes('gltf') || entry.extensions.includes('gltf') || entry.extensions.includes('glb')
    ) ?? null
  );
};

const resolveCodec = (codecId: string): CodecSelection | null => {
  const requestToken = normalizeToken(codecId);
  if (!requestToken) return null;
  const entries = readCodecEntries();
  const exact = entries.find((entry) => codecLookupTokens(entry).includes(requestToken));
  if (exact) return exact;
  if (requestToken.length < 3) return null;
  return (
    entries.find((entry) =>
      codecLookupTokens(entry).some((token) => token.includes(requestToken) || requestToken.includes(token))
    ) ?? null
  );
};

const codecLookupTokens = (entry: CodecSelection): string[] => {
  const tokens = [
    entry.id,
    entry.label,
    entry.codec.id ? String(entry.codec.id) : '',
    entry.codec.name ? String(entry.codec.name) : '',
    ...entry.extensions
  ]
    .map((value) => normalizeToken(value))
    .filter(Boolean);
  return Array.from(new Set(tokens));
};

const parseCodecExtensions = (value: unknown): string[] => {
  const text = String(value ?? '').trim().toLowerCase();
  if (!text) return [];
  return Array.from(
    new Set(
      text
        .split(/[^a-z0-9]+/)
        .map((part) => part.trim())
        .filter(Boolean)
    )
  );
};

const normalizeToken = (value: unknown): string =>
  String(value ?? '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '');

const readCodecEntries = (): CodecSelection[] => {
  const globals = readGlobals();
  const codecs = globals.Codecs;
  if (!codecs || typeof codecs !== 'object') return [];
  const codecEntries = safeEntries(codecs);
  const entries = codecEntries
    .filter((entry): entry is [string, BlockbenchCodec] => Boolean(entry[1]))
    .map(([key, codec]) => {
      const idRead = tryRead(() => codec.id);
      if (!idRead.ok) return null;
      const idRaw = String(idRead.value ?? key).trim();
      const id = idRaw.toLowerCase();
      const label = safeRead(() => String(codec.name ?? codec.id ?? key).trim(), idRaw || String(key).trim());
      const extensions = parseCodecExtensions(safeRead(() => codec.extension, ''));
      return { id, label, extensions, codec };
    })
    .filter((entry): entry is CodecSelection => Boolean(entry && entry.id));
  const deduped = new Map<string, CodecSelection>();
  entries.forEach((entry) => {
    if (!deduped.has(entry.id)) {
      deduped.set(entry.id, entry);
    }
  });
  return Array.from(deduped.values());
};

const safeEntries = (value: object): Array<[string, unknown]> => {
  try {
    return Object.entries(value);
  } catch (_err) {
    return [];
  }
};

const safeRead = <T>(read: () => T, fallback: T): T => {
  try {
    return read();
  } catch (_err) {
    return fallback;
  }
};

const tryRead = <T>(read: () => T): { ok: true; value: T } | { ok: false } => {
  try {
    return { ok: true, value: read() };
  } catch (_err) {
    return { ok: false };
  }
};
