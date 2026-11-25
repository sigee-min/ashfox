import * as fs from 'node:fs';
import { BuildFailure } from '@ashfox/asset-build';
import type { AssetQualityProfile, AuditOptions } from '@ashfox/engine-core';
import { ChromeRenderer } from './chrome';
import { DEFAULT_VIEW, type SourceInput } from './contract';
import { inspect, renderMedia, exportAsset } from './operations';
import { readInput, readView } from './read';
import { prepareWorker } from './worker';

const numeric = new Set([
  'width',
  'height',
  'azimuth',
  'elevation',
  'zoom',
  'time',
  'fps',
  'duration',
  'scale',
]);
const boolean = new Set(['wireframe', 'skeleton', 'textures', 'gif']);

const inputBytes = async (): Promise<Buffer> => {
  let length = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    const bytes = Buffer.from(chunk);
    length += bytes.length;
    if (length > 16 * 1024 * 1024)
      throw new BuildFailure('observe.budget', 'stdin exceeds 16 MiB', 2);
    chunks.push(bytes);
  }
  return Buffer.concat(chunks);
};

const CHECK_VALUE_FLAGS = new Set([
  '--name',
  '--input-format',
  '--node',
  '--profile',
  '--threshold',
]);
const CHECK_SINGLE_ASSET_FLAGS = new Set(['--stdin', '--input-json', ...CHECK_VALUE_FLAGS]);

export const inspectCheckArgs = (
  args: readonly string[],
): {
  readonly target?: string;
  readonly singleAsset: boolean;
  readonly nonJsonFlags: readonly string[];
} => {
  const positionals: string[] = [];
  const nonJsonFlags: string[] = [];
  let singleAsset = false;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') continue;
    if (CHECK_SINGLE_ASSET_FLAGS.has(arg)) {
      singleAsset = true;
      nonJsonFlags.push(arg);
      if (CHECK_VALUE_FLAGS.has(arg)) i++;
      continue;
    }
    if (arg.startsWith('--')) nonJsonFlags.push(arg);
    else positionals.push(arg);
  }
  return {
    target: positionals.length === 1 ? positionals[0] : undefined,
    singleAsset,
    nonJsonFlags,
  };
};

interface ParsedCommon {
  readonly file?: string;
  readonly output?: string;
  readonly name?: string;
  readonly stdin: boolean;
  readonly inputJson: boolean;
  readonly inputFormat: string;
  readonly gif: boolean;
  readonly options: Record<string, unknown>;
  readonly audit: { profile?: string; threshold?: string };
}

interface ParseState {
  file?: string;
  output?: string;
  name?: string;
  stdin: boolean;
  inputJson: boolean;
  inputFormat: string;
  gif: boolean;
  jsonFlag: boolean;
  readonly options: Record<string, unknown>;
  readonly audit: { profile?: string; threshold?: string };
}

const applyMediaBooleanFlag = (state: ParseState, key: string, arg: string): boolean => {
  if (boolean.has(key)) {
    if (key === 'gif') {
      if (state.gif) throw new BuildFailure('observe.arguments', 'Duplicate --gif', 2);
      state.gif = true;
    } else {
      if (key in state.options) throw new BuildFailure('observe.arguments', 'Duplicate ' + arg, 2);
      state.options[key] = true;
    }
    return true;
  }
  if (key !== 'no-textures') return false;
  if ('textures' in state.options)
    throw new BuildFailure('observe.arguments', 'Duplicate ' + arg, 2);
  state.options.textures = false;
  return true;
};

const applyCheckOnlyOption = (state: ParseState, key: string, arg: string, value: string): void => {
  if (key === 'profile') state.audit.profile = value;
  else if (key === 'threshold') state.audit.threshold = value;
  else if (key === 'node') state.options.node = value;
  else throw new BuildFailure('observe.arguments', 'Unknown option: ' + arg, 2);
};

const applyValueOption = (
  state: ParseState,
  mode: 'check' | 'media',
  key: string,
  arg: string,
  value: string | undefined,
): void => {
  if (value === undefined || value.startsWith('--'))
    throw new BuildFailure('observe.arguments', 'Missing value for ' + arg, 2);
  if (key === 'name') {
    state.name = value;
    return;
  }
  if (key === 'input-format') {
    if (!['source', 'png'].includes(value))
      throw new BuildFailure('observe.arguments', 'input-format is source or png', 2);
    state.inputFormat = value;
    return;
  }
  if (mode === 'check') {
    applyCheckOnlyOption(state, key, arg, value);
    return;
  }
  if (key === 'output') {
    state.output = value;
    return;
  }
  const targetKey = key === 'model-path' ? 'modelPath' : key;
  if (key !== 'model-path' && key in state.options)
    throw new BuildFailure('observe.arguments', 'Duplicate ' + arg, 2);
  state.options[targetKey] = numeric.has(key) ? Number(value) : value;
};

const applyCliToken = (
  state: ParseState,
  mode: 'check' | 'media',
  arg: string,
  nextArg: string | undefined,
): boolean => {
  if (mode === 'check' && arg === '--json') {
    if (state.jsonFlag) throw new BuildFailure('observe.arguments', 'Duplicate --json', 2);
    state.jsonFlag = true;
    return false;
  }
  if (arg === '--stdin') {
    if (state.stdin) throw new BuildFailure('observe.arguments', 'Duplicate --stdin', 2);
    state.stdin = true;
    return false;
  }
  if (arg === '--input-json') {
    state.inputJson = true;
    return false;
  }
  if (!arg.startsWith('--')) {
    if (state.file) throw new BuildFailure('observe.arguments', 'Expected one input', 2);
    state.file = arg;
    return false;
  }
  const key = arg.slice(2);
  if (mode === 'media' && applyMediaBooleanFlag(state, key, arg)) return false;
  applyValueOption(state, mode, key, arg, nextArg);
  return true;
};

const parseArgs = (args: readonly string[], mode: 'check' | 'media'): ParsedCommon => {
  const state: ParseState = {
    stdin: false,
    inputJson: false,
    inputFormat: 'source',
    gif: false,
    jsonFlag: false,
    options: {},
    audit: {},
  };
  for (let i = 1; i < args.length; i++) {
    if (applyCliToken(state, mode, args[i], args[i + 1])) i++;
  }
  return state;
};

const resolveMemoryInput = async (parsed: ParsedCommon): Promise<SourceInput> => {
  const bytes = await inputBytes();
  if (parsed.inputFormat === 'png') return readInput({ png: bytes.toString('base64') });
  const source = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  if (parsed.inputJson) return readInput(JSON.parse(source));
  return readInput({ source, ...(parsed.name ? { name: parsed.name } : {}) });
};

const loadSourceInput = async (parsed: ParsedCommon): Promise<SourceInput> => {
  const useStdin = parsed.stdin || (!parsed.file && !parsed.inputJson);
  if ((parsed.stdin || parsed.inputJson) && parsed.file)
    throw new BuildFailure('observe.arguments', 'Choose file or stdin', 2);
  if (!parsed.file && !parsed.stdin && !parsed.inputJson && process.stdin.isTTY)
    throw new BuildFailure('observe.arguments', 'Supply a file or pipe source to stdin', 2);
  if (parsed.name && !useStdin)
    throw new BuildFailure('observe.arguments', '--name requires --stdin', 2);
  if (parsed.inputJson && parsed.stdin)
    throw new BuildFailure('observe.arguments', 'Choose --stdin or --input-json', 2);
  if (parsed.inputFormat !== 'source' && !useStdin)
    throw new BuildFailure('observe.arguments', 'input-format requires --stdin', 2);
  return parsed.file ? readInput({ file: parsed.file }) : resolveMemoryInput(parsed);
};

const parseAuditFlags = (audit: { profile?: string; threshold?: string }): AuditOptions => {
  let profile: AssetQualityProfile | undefined;
  if (audit.profile !== undefined) {
    if (!['creature', 'prop', 'block'].includes(audit.profile))
      throw new BuildFailure('observe.option', 'Invalid profile: ' + audit.profile, 2);
    profile = audit.profile as AssetQualityProfile;
  }
  let threshold: number | undefined;
  if (audit.threshold !== undefined) {
    const n = Number(audit.threshold);
    if (!Number.isInteger(n) || n < 0 || n > 100)
      throw new BuildFailure('observe.option', 'threshold must be integer 0..100', 2);
    threshold = n;
  }
  return {
    ...(profile !== undefined ? { profile } : {}),
    ...(threshold !== undefined ? { threshold } : {}),
  };
};

export const runAssetCheck = async (
  args: readonly string[],
  executable: string,
  signal: AbortSignal,
): Promise<unknown> => {
  const parsed = parseArgs(args, 'check');
  const view = readView(parsed.options, DEFAULT_VIEW);
  const auditOptions = parseAuditFlags(parsed.audit);
  const input = await loadSourceInput(parsed);
  const asset = await prepareWorker(executable, input, signal);
  return inspect(asset, view, auditOptions);
};

export const runMediaCommand = async (
  args: readonly string[],
  executable: string,
  signal: AbortSignal,
): Promise<void> => {
  const command = args[0];
  const parsed = parseArgs(args, 'media');
  if (command === 'export' && parsed.gif)
    throw new BuildFailure('observe.arguments', '--gif applies to render, not export', 2);
  const view = readView(parsed.options, DEFAULT_VIEW);
  const input = await loadSourceInput(parsed);
  const asset = await prepareWorker(executable, input, signal);
  const renderer = new ChromeRenderer();
  try {
    const media =
      command === 'render'
        ? await renderMedia(asset, view, parsed.gif, renderer, signal)
        : await exportAsset(asset, view);
    if (media.bytes.length === 0 && media.mime === 'application/octet-stream')
      throw new BuildFailure('observe.output', 'Empty media', 3);
    if (!parsed.output && process.stdout.isTTY)
      throw new BuildFailure(
        'observe.terminal',
        'Binary stdout requires a pipe, redirection, or --output',
        2,
      );
    if (signal.aborted) throw new BuildFailure('observe.cancelled', 'Cancelled before output', 130);
    if (parsed.output) fs.writeFileSync(parsed.output, media.bytes, { flag: 'wx' });
    else
      await new Promise<void>((resolve, reject) =>
        process.stdout.write(media.bytes, (error) => (error ? reject(error) : resolve())),
      );
  } finally {
    await renderer.close();
  }
};
