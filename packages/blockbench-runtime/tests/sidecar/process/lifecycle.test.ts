import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';

import { SidecarProcess } from '../../../src/sidecar/SidecarProcess';
import { noopLog, unsafePayload } from '../../helpers';

type TimerEntry = {
  handler: () => void;
  delayMs: number;
  cancelled: boolean;
};

const timers: TimerEntry[] = [];
const clock = {
  setTimeout: (handler: () => void, delayMs: number) => {
    const entry: TimerEntry = { handler, delayMs, cancelled: false };
    timers.push(entry);
    return entry as unknown as ReturnType<typeof setTimeout>;
  },
  clearTimeout: (handle: ReturnType<typeof setTimeout>) => {
    (handle as unknown as TimerEntry).cancelled = true;
  },
  random: () => 0,
};

const runTimer = (delayMs: number) => {
  const timer = timers.find((entry) => !entry.cancelled && entry.delayMs === delayMs);
  assert.notEqual(timer, undefined, `missing active ${delayMs}ms timer`);
  if (!timer) return;
  timer.cancelled = true;
  timer.handler();
};

const activeDelays = () => timers.filter((entry) => !entry.cancelled).map((entry) => entry.delayMs);

type FakeChild = EventEmitter & {
  stdin: { write: (data: string) => void };
  stdout: EventEmitter;
  stderr: EventEmitter;
  pid: number;
  killCalls: number;
  kill: () => void;
};

const children: FakeChild[] = [];
let capturedArgs: string[] = [];
let capturedEnv: Record<string, string | undefined> = {};
const childProcessModule = {
  spawn: (
    _command: string,
    args: string[],
    options: { env: Record<string, string | undefined> },
  ) => {
    capturedArgs = [...args];
    capturedEnv = { ...options.env };
    const child = Object.assign(new EventEmitter(), {
      stdin: { write: (_data: string) => undefined },
      stdout: new EventEmitter(),
      stderr: new EventEmitter(),
      pid: children.length + 1,
      killCalls: 0,
      kill() {
        this.killCalls += 1;
      },
    });
    children.push(child);
    return child;
  },
};

const globals = globalThis as unknown as {
  Plugins?: unknown;
  requireNativeModule?: (name: string) => unknown;
};
const originalPlugins = globals.Plugins;
const originalLoader = globals.requireNativeModule;
globals.Plugins = {
  registered: { ashfox: { path: '/plugins/ashfox.js' } },
};
globals.requireNativeModule = (name) => {
  if (name === 'child_process') return childProcessModule;
  if (name === 'path') {
    return {
      basename: (value: string) => value.split('/').at(-1) ?? '',
      dirname: (value: string) => value.slice(0, value.lastIndexOf('/')),
      join: (...parts: string[]) => parts.join('/'),
    };
  }
  if (name === 'process') {
    return {
      execPath: '/Applications/Blockbench.app/Contents/MacOS/Blockbench',
      env: { PATH: '/usr/bin' },
    };
  }
  return null;
};

try {
  const sidecar = new SidecarProcess(
    { host: '127.0.0.1', port: 8787, path: '/mcp', token: 'secret' },
    unsafePayload({ handle: async () => ({ ok: true, data: {} }) }),
    noopLog,
    clock,
  );
  assert.equal(sidecar.start(), true);
  assert.equal(children.length, 1);
  assert.equal(capturedArgs.includes('--token'), false);
  assert.equal(capturedArgs.includes('secret'), false);
  assert.equal(capturedEnv.ASHFOX_TOKEN, 'secret');
  assert.equal(capturedEnv.PATH, '/usr/bin');

  children[0].emit('exit', 1, null);
  assert.deepEqual(activeDelays(), [500]);
  runTimer(500);
  assert.equal(children.length, 2);
  children[1].emit('exit', 1, null);
  assert.deepEqual(activeDelays(), [1_000]);
  runTimer(1_000);
  assert.equal(children.length, 3);

  children[2].emit('error', new Error('spawn failed asynchronously'));
  children[2].emit('exit', 1, null);
  assert.equal(children[2].killCalls, 1);
  assert.deepEqual(activeDelays(), [2_000]);
  runTimer(2_000);
  assert.equal(children.length, 4);

  runTimer(30_000);
  children[3].emit('exit', 1, null);
  assert.deepEqual(activeDelays(), [500]);
  sidecar.stop();
  assert.deepEqual(activeDelays(), []);
} finally {
  globals.Plugins = originalPlugins;
  globals.requireNativeModule = originalLoader;
}
