import * as fs from 'node:fs';
import { BuildFailure } from '@ashfox/asset-build';
import { ChromeRenderer } from './chrome';
import { type SourceInput } from './contract';
import { inspect, renderMedia } from './operations';
import { readInput } from './read';
import { prepareWorker } from './worker';

const FATAL_UTF8_DECODER = new TextDecoder('utf-8', { fatal: true });

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

const CHECK_SINGLE_ASSET_FLAGS = new Set(['--stdin', '--input-json', '--name']);

export const inspectCheckArgs = (
  args: readonly string[],
): {
  readonly target?: string;
  readonly singleAsset: boolean;
  readonly nonJsonFlags: readonly string[];
  readonly noCache: boolean;
} => {
  const positionals: string[] = [];
  const nonJsonFlags: string[] = [];
  let singleAsset = false;
  let noCacheCount = 0;
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--json') continue;
    if (arg === '--no-cache') {
      noCacheCount += 1;
      continue;
    }
    if (CHECK_SINGLE_ASSET_FLAGS.has(arg)) {
      singleAsset = true;
      nonJsonFlags.push(arg);
      if (arg === '--name') i++;
      continue;
    }
    if (arg.startsWith('--')) nonJsonFlags.push(arg);
    else positionals.push(arg);
  }
  if (noCacheCount > 1) nonJsonFlags.push('--no-cache');
  return {
    target: positionals.length === 1 ? positionals[0] : undefined,
    singleAsset,
    nonJsonFlags,
    noCache: noCacheCount === 1,
  };
};

interface ParsedCommon {
  readonly file?: string;
  readonly output?: string;
  readonly name?: string;
  readonly view: string;
  readonly stdin: boolean;
  readonly inputJson: boolean;
}

interface ParseState {
  file?: string;
  output?: string;
  name?: string;
  view: string;
  hasView: boolean;
  stdin: boolean;
  inputJson: boolean;
  jsonFlag: boolean;
}

const setOnce = <T>(current: T | undefined, value: T, flag: string): T => {
  if (current !== undefined) throw new BuildFailure('observe.arguments', 'Duplicate ' + flag, 2);
  return value;
};

const applyValueToken = (
  state: ParseState,
  mode: 'check' | 'render',
  arg: string,
  nextArg: string | undefined,
): boolean => {
  if (nextArg === undefined || nextArg.startsWith('--')) {
    throw new BuildFailure('observe.arguments', 'Missing or unknown option: ' + arg, 2);
  }
  if (arg === '--name') state.name = setOnce(state.name, nextArg, '--name');
  else if (mode === 'render' && arg === '--output')
    state.output = setOnce(state.output, nextArg, '--output');
  else if (mode === 'render' && arg === '--view') {
    if (state.hasView) throw new BuildFailure('observe.arguments', 'Duplicate --view', 2);
    state.hasView = true;
    state.view = nextArg;
  } else throw new BuildFailure('observe.arguments', 'Unknown option: ' + arg, 2);
  return true;
};

const applyCliToken = (
  state: ParseState,
  mode: 'check' | 'render',
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
    state.file = setOnce(state.file, arg, 'input');
    return false;
  }
  return applyValueToken(state, mode, arg, nextArg);
};

const parseArgs = (args: readonly string[], mode: 'check' | 'render'): ParsedCommon => {
  const state: ParseState = {
    view: 'default',
    hasView: false,
    stdin: false,
    inputJson: false,
    jsonFlag: false,
  };
  for (let i = 1; i < args.length; i++) {
    if (applyCliToken(state, mode, args[i], args[i + 1])) i++;
  }
  return state;
};

const resolveMemoryInput = async (parsed: ParsedCommon): Promise<SourceInput> => {
  const bytes = await inputBytes();
  const source = FATAL_UTF8_DECODER.decode(bytes);
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
  return parsed.file ? readInput({ file: parsed.file }) : resolveMemoryInput(parsed);
};

export const runAssetCheck = async (
  args: readonly string[],
  executable: string,
  signal: AbortSignal,
): Promise<unknown> => {
  const parsed = parseArgs(args, 'check');
  const input = await loadSourceInput(parsed);
  const asset = await prepareWorker(executable, input, signal);
  return inspect(asset);
};

export const runMediaCommand = async (
  args: readonly string[],
  executable: string,
  signal: AbortSignal,
): Promise<void> => {
  const parsed = parseArgs(args, 'render');
  const input = await loadSourceInput(parsed);
  const asset = await prepareWorker(executable, input, signal);
  const renderer = new ChromeRenderer();
  try {
    const media = await renderMedia(asset, parsed.view, renderer, signal);
    if (media.bytes.length === 0) throw new BuildFailure('observe.output', 'Empty media', 3);
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
