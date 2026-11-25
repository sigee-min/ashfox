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

const parseArgs = (args: readonly string[], mode: 'check' | 'media'): ParsedCommon => {
  let file: string | undefined,
    output: string | undefined,
    name: string | undefined,
    stdin = false,
    inputJson = false,
    inputFormat = 'source',
    gif = false,
    jsonFlag = false;
  const options: Record<string, unknown> = {};
  const audit: { profile?: string; threshold?: string } = {};
  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    if (mode === 'check' && arg === '--json') {
      if (jsonFlag) throw new BuildFailure('observe.arguments', 'Duplicate --json', 2);
      jsonFlag = true;
      continue;
    }
    if (arg === '--stdin') {
      if (stdin) throw new BuildFailure('observe.arguments', 'Duplicate --stdin', 2);
      stdin = true;
      continue;
    }
    if (arg === '--input-json') {
      inputJson = true;
      continue;
    }
    if (arg.startsWith('--')) {
      const key = arg.slice(2);
      if (mode === 'media' && boolean.has(key)) {
        if (key === 'gif') {
          if (gif) throw new BuildFailure('observe.arguments', 'Duplicate --gif', 2);
          gif = true;
        } else {
          if (key in options) throw new BuildFailure('observe.arguments', 'Duplicate ' + arg, 2);
          options[key] = true;
        }
        continue;
      }
      if (mode === 'media' && key === 'no-textures') {
        if ('textures' in options)
          throw new BuildFailure('observe.arguments', 'Duplicate ' + arg, 2);
        options.textures = false;
        continue;
      }
      const value = args[++i];
      if (value === undefined || value.startsWith('--'))
        throw new BuildFailure('observe.arguments', 'Missing value for ' + arg, 2);
      if (key === 'name') {
        name = value;
        continue;
      }
      if (key === 'input-format') {
        if (!['source', 'png'].includes(value))
          throw new BuildFailure('observe.arguments', 'input-format is source or png', 2);
        inputFormat = value;
        continue;
      }
      if (mode === 'check') {
        if (key === 'profile') audit.profile = value;
        else if (key === 'threshold') audit.threshold = value;
        else if (key === 'node') options.node = value;
        else throw new BuildFailure('observe.arguments', 'Unknown option: ' + arg, 2);
        continue;
      }
      if (key === 'output') {
        output = value;
        continue;
      }
      if (key === 'model-path') {
        options.modelPath = value;
        continue;
      }
      if (key in options) throw new BuildFailure('observe.arguments', 'Duplicate ' + arg, 2);
      options[key] = numeric.has(key) ? Number(value) : value;
    } else {
      if (file) throw new BuildFailure('observe.arguments', 'Expected one input', 2);
      file = arg;
    }
  }
  return { file, output, name, stdin, inputJson, inputFormat, gif, options, audit };
};

const loadSourceInput = async (parsed: ParsedCommon): Promise<SourceInput> => {
  let { stdin } = parsed;
  const { file, name, inputJson, inputFormat } = parsed;
  if ((stdin || inputJson) && file)
    throw new BuildFailure('observe.arguments', 'Choose file or stdin', 2);
  if (!file && !stdin && !inputJson) {
    if (process.stdin.isTTY)
      throw new BuildFailure('observe.arguments', 'Supply a file or pipe source to stdin', 2);
    stdin = true;
  }
  if (name && !stdin) throw new BuildFailure('observe.arguments', '--name requires --stdin', 2);
  if (inputJson && stdin)
    throw new BuildFailure('observe.arguments', 'Choose --stdin or --input-json', 2);
  if (inputFormat !== 'source' && !stdin)
    throw new BuildFailure('observe.arguments', 'input-format requires --stdin', 2);
  const bytes = file ? undefined : await inputBytes();
  const source =
    bytes && inputFormat !== 'png'
      ? new TextDecoder('utf-8', { fatal: true }).decode(bytes)
      : undefined;
  return readInput(
    file
      ? { file }
      : inputJson
        ? JSON.parse(source!)
        : inputFormat === 'png'
          ? { png: bytes!.toString('base64') }
          : { source, ...(name ? { name } : {}) },
  );
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
