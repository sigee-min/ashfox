import * as fs from 'node:fs';
import * as path from 'node:path';
import {
  BuildFailure,
  checkNodeSnapshot,
  readSnapshot,
  type NodeCheckResult,
  type Snapshot,
} from '@ashfox/asset-build';
import { evaluateSoundQuality } from '@ashfox/audio-core';
import {
  collectInspectRefs,
  evaluateAssetQuality,
  evaluateSpriteQuality,
} from '@ashfox/engine-core';
import type { DevDiagnostic, DevViewerState } from '@ashfox/render-core';
import { prepare } from '../observe/prepare';
import { startDevServer, type DevServerHandle } from './server';

const IGNORED_DIRS = new Set(['.git', 'node_modules', '.ashfox-cache', 'dist', 'build']);
const DEBOUNCE_MS = 80;

const soundWaveBins = (wav: Uint8Array, frames: number, channels: number, bins = 128): number[] => {
  const buf = Buffer.from(wav.buffer, wav.byteOffset, wav.byteLength);
  return Array.from({ length: bins }, (_, x) => {
    const start = Math.floor((x * frames) / bins);
    const end = Math.floor(((x + 1) * frames) / bins);
    let peak = 0;
    for (let i = start; i < end; i++) {
      for (let ch = 0; ch < channels; ch++) {
        peak = Math.max(peak, Math.abs(buf.readInt16LE(44 + (i * channels + ch) * 2) / 32768));
      }
    }
    return peak;
  });
};

const computeAuditScore = (
  prepared: ReturnType<typeof prepare>,
  checked: NodeCheckResult,
): number | null => {
  const checkedScore = checked.products[0]?.audit?.score;
  if (typeof checkedScore === 'number') return Number(checkedScore.toFixed(2));
  const product = prepared.product;
  if (product?.kind === 'model') {
    const report = evaluateAssetQuality({ model: product.model, telemetry: product.telemetry });
    return Number(report.score.toFixed(2));
  }
  if (product?.kind === 'structure') return Number(product.structure.audit.score.toFixed(2));
  if (prepared.sprite) {
    const s = prepared.sprite;
    const report = evaluateSpriteQuality({
      profile: s.profile,
      raster: {
        width: s.receipt.width,
        height: s.receipt.height,
        rgba: {
          length: s.rgba.length,
          at: (i: number) => s.rgba[i],
          copy: () => new Uint8Array(s.rgba),
          [Symbol.iterator]: () => s.rgba[Symbol.iterator](),
        },
      },
      telemetry: s.telemetry,
    });
    return Number(report.score.toFixed(2));
  }
  if (product?.kind === 'sound' && product.sounds.length > 0) {
    return Number(evaluateSoundQuality(product.sounds).score.toFixed(2));
  }
  return null;
};

const toViewerDiagnostics = (error: unknown): readonly DevDiagnostic[] => {
  if (error instanceof BuildFailure) {
    if (error.diagnostics && error.diagnostics.length > 0) return error.diagnostics;
    return [
      {
        severity: 'error',
        code: error.code,
        message: error.message,
        ...(error.hint !== undefined ? { hint: error.hint } : {}),
      },
    ];
  }
  return [
    {
      severity: 'error',
      code: 'dev.compile',
      message: error instanceof Error ? error.message : String(error),
    },
  ];
};

const printTerminalDiagnostics = (diagnostics: readonly DevDiagnostic[]): void => {
  for (const d of diagnostics) {
    const loc = d.file && !d.message.startsWith(d.file) ? `${d.file}: ` : '';
    process.stderr.write(`ashfox dev [${d.code}]: ${loc}${d.message}\n`);
    if (d.hint) process.stderr.write(`  ${d.hint}\n`);
  }
};

const formatDeltaLabel = (delta: number | null): string => {
  if (delta === null) return '';
  return ` (${delta >= 0 ? '+' : ''}${delta})`;
};

const resolveSnapshotTarget = (
  resolvedInput: string,
): { readonly target: string; readonly selectedFile?: string } => {
  if (!fs.statSync(resolvedInput).isDirectory()) {
    return { target: resolvedInput, selectedFile: fs.realpathSync(resolvedInput) };
  }
  const config = ['.ashfoxworkspace', '.ashfoxworkspace.mjs']
    .map((name) => path.join(resolvedInput, name))
    .find((candidate) => fs.existsSync(candidate));
  if (!config) {
    throw new BuildFailure('dev.input', `No .ashfoxworkspace found in ${resolvedInput}`, 2);
  }
  return { target: config };
};

const buildViewerState = async (
  input: string,
  revision: number,
  prevScore: number | null,
  signal: AbortSignal,
): Promise<DevViewerState> => {
  const { target, selectedFile } = resolveSnapshotTarget(input);
  const snapshot: Snapshot = readSnapshot(target);
  const checked = await checkNodeSnapshot(snapshot, signal);
  const prepared = prepare(snapshot, selectedFile);
  const auditScore = computeAuditScore(prepared, checked);
  const auditDelta =
    auditScore !== null && prevScore !== null ? Number((auditScore - prevScore).toFixed(2)) : null;
  const product = prepared.product;
  const structureProduct = product?.kind === 'structure' ? product.structure : undefined;
  const inspectRefs = collectInspectRefs(snapshot.files, {
    document: prepared.document,
    structure: structureProduct,
  });
  const entryName =
    product?.entry.entryName ?? prepared.products?.[0]?.entry.entryName ?? path.basename(input);
  const base = {
    revision,
    ok: true as const,
    kind: prepared.kind,
    entry: entryName,
    auditScore,
    auditDelta,
    diagnostics: [],
    inspectRefs,
  };
  if (prepared.kind === 'model' && prepared.document)
    return { ...base, document: prepared.document };
  if (structureProduct) {
    return {
      ...base,
      structure: {
        id: structureProduct.id,
        size: structureProduct.grid.size,
        bakedMesh: structureProduct.bakedMesh,
        customModels: structureProduct.customModels,
        playableMeta: structureProduct.playableMeta,
        floors: structureProduct.grid.floors,
        rooms: structureProduct.grid.rooms,
      },
    };
  }
  if (prepared.sprite) return { ...base, png: Buffer.from(prepared.sprite.png).toString('base64') };
  if (product?.kind === 'sound' && product.sounds[0]) {
    const s = product.sounds[0];
    return { ...base, wave: soundWaveBins(s.wav, s.frames, s.channels) };
  }
  if (product?.kind === 'vfx') return { ...base, vfx: product.vfx };
  return base;
};

const collectWatchDirs = (rootDir: string): string[] => {
  const dirs = [rootDir];
  const stack = [rootDir];
  while (stack.length > 0) {
    const current = stack.pop()!;
    for (const entry of fs.readdirSync(current, { withFileTypes: true })) {
      if (!entry.isDirectory() || IGNORED_DIRS.has(entry.name)) continue;
      const full = path.join(current, entry.name);
      dirs.push(full);
      stack.push(full);
    }
  }
  return dirs;
};

const shouldIgnoreFilename = (filename: string | null): boolean => {
  if (!filename) return false;
  const normalized = filename.replaceAll('\\', '/');
  return normalized.split('/').some((seg) => IGNORED_DIRS.has(seg));
};

export interface DevSession {
  readonly url: string;
  readonly port: number;
  readonly close: () => Promise<void>;
}

const createStateEvaluator = (resolvedInput: string, signal: AbortSignal) => {
  let revision = 0;
  let lastScore: number | null = null;
  let lastGood: DevViewerState | null = null;
  return async (): Promise<DevViewerState> => {
    revision += 1;
    const started = Date.now();
    try {
      const state = await buildViewerState(resolvedInput, revision, lastScore, signal);
      lastGood = state;
      lastScore = state.auditScore;
      const scoreText =
        state.auditScore !== null
          ? `audit ${state.auditScore}${formatDeltaLabel(state.auditDelta)}`
          : 'ok';
      process.stdout.write(
        `[ashfox dev] ${state.entry} (${state.kind}) · ${scoreText} · ${Date.now() - started}ms\n`,
      );
      return state;
    } catch (error) {
      const diagnostics = toViewerDiagnostics(error);
      printTerminalDiagnostics(diagnostics);
      if (lastGood) return { ...lastGood, revision, ok: false, diagnostics };
      return {
        revision,
        ok: false,
        kind: 'error',
        entry: path.basename(resolvedInput),
        auditScore: null,
        auditDelta: null,
        diagnostics,
        inspectRefs: [],
      };
    }
  };
};

const createDebouncedRunner = (signal: AbortSignal, onRebuild: () => Promise<void>) => {
  let rebuilding = false;
  let queued = false;
  const runNext = async (): Promise<void> => {
    if (signal.aborted) return;
    if (rebuilding) {
      queued = true;
      return;
    }
    rebuilding = true;
    try {
      await onRebuild();
    } finally {
      rebuilding = false;
      if (queued) {
        queued = false;
        void runNext();
      }
    }
  };
  return runNext;
};

const syncDirectoryWatchers = (
  watchRoot: string,
  watchers: Map<string, fs.FSWatcher>,
  onFsEvent: (filename: string | null) => void,
): void => {
  const activeDirs = new Set(collectWatchDirs(watchRoot));
  for (const [dir, watcher] of watchers) {
    if (activeDirs.has(dir)) continue;
    watcher.close();
    watchers.delete(dir);
  }
  for (const dir of activeDirs) {
    if (!watchers.has(dir)) {
      watchers.set(
        dir,
        fs.watch(dir, (_event, filename) => onFsEvent(filename)),
      );
    }
  }
};

const attachDirectoryWatchers = (
  watchRoot: string,
  signal: AbortSignal,
  onRebuild: () => Promise<void>,
): (() => void) => {
  const watchers = new Map<string, fs.FSWatcher>();
  const runNext = createDebouncedRunner(signal, onRebuild);
  let timer: ReturnType<typeof setTimeout> | null = null;
  const onFsEvent = (filename: string | null): void => {
    if (shouldIgnoreFilename(filename)) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => {
      syncDirectoryWatchers(watchRoot, watchers, onFsEvent);
      void runNext();
    }, DEBOUNCE_MS);
  };
  syncDirectoryWatchers(watchRoot, watchers, onFsEvent);
  return () => {
    if (timer) clearTimeout(timer);
    for (const w of watchers.values()) w.close();
    watchers.clear();
  };
};

const resolveWatchRoot = (resolvedInput: string): string => {
  if (fs.statSync(resolvedInput).isDirectory()) return resolvedInput;
  try {
    return readSnapshot(resolveSnapshotTarget(resolvedInput).target).root;
  } catch {
    let dir = path.dirname(resolvedInput);
    while (true) {
      if (
        fs.existsSync(path.join(dir, '.ashfoxworkspace')) ||
        fs.existsSync(path.join(dir, '.ashfoxworkspace.mjs'))
      ) {
        return dir;
      }
      const parent = path.dirname(dir);
      if (parent === dir) return path.dirname(resolvedInput);
      dir = parent;
    }
  }
};

export const startDevSession = async (
  input: string,
  port: number,
  signal: AbortSignal,
): Promise<DevSession> => {
  const resolvedInput = path.resolve(input);
  if (!fs.existsSync(resolvedInput)) {
    throw new BuildFailure('dev.input', `Input path not found: ${input}`, 2);
  }
  const evaluate = createStateEvaluator(resolvedInput, signal);
  const server: DevServerHandle = await startDevServer(port, await evaluate());
  const watchRoot = resolveWatchRoot(resolvedInput);
  const stopWatching = attachDirectoryWatchers(watchRoot, signal, async () =>
    server.setState(await evaluate()),
  );
  return {
    url: server.url,
    port: server.port,
    close: async () => {
      stopWatching();
      await server.close();
    },
  };
};
