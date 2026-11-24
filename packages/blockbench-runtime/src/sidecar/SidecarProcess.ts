import { Dispatcher } from '@ashfox/blockbench-contracts/types/internal';
import { errorMessage, Logger } from '../logging';
import { SidecarHost } from './transport/SidecarHost';
import { SidecarLaunchConfig } from './types';
import { PLUGIN_ID } from '../config';
import { resolveRegisteredPluginPath } from '../adapters/blockbench/pluginRegistry';
import {
  SIDECAR_CHILD_PROCESS_UNAVAILABLE,
  SIDECAR_ENTRY_NOT_FOUND,
  SIDECAR_EXECPATH_UNAVAILABLE,
  SIDECAR_PATH_MODULE_UNAVAILABLE,
  SIDECAR_PERMISSION_MESSAGE,
  SIDECAR_RUN_AS_NODE_REJECTED,
  SIDECAR_STDIO_UNAVAILABLE,
} from '../shared/messages';
import { loadNativeModule } from '../shared/nativeModules';
import { validateServerConfig } from '../serverConfig';

type PathModule = {
  basename?: (path: string) => string;
  dirname?: (path: string) => string;
  join?: (...parts: string[]) => string;
};

type ChildProcessModule = {
  spawn: (
    command: string,
    args: string[],
    options: {
      stdio: ['pipe', 'pipe', 'pipe'];
      windowsHide: boolean;
      env: Record<string, string | undefined>;
    },
  ) => ChildProcessHandle;
};

type ProcessModule = {
  execPath?: string;
  env?: Record<string, string | undefined>;
};

type StdioReadable = {
  on(event: 'data', handler: (chunk: string | Uint8Array) => void): void;
  on(event: 'error', handler: (err: Error) => void): void;
  on(event: 'end', handler: () => void): void;
};

type StdioWritable = {
  write: (data: string) => void;
};

type ChildProcessHandle = {
  stdin?: StdioWritable;
  stdout?: StdioReadable;
  stderr?: { on(event: 'data', handler: (chunk: string | Uint8Array) => void): void };
  pid?: number;
  kill?: () => void;
  on(event: 'exit', handler: (code: number | null, signal: string | null) => void): void;
  on(event: 'error', handler: (err: Error) => void): void;
};

const RESTART_INITIAL_DELAY_MS = 500;
const RESTART_MAX_DELAY_MS = 30_000;
const RESTART_STABLE_UPTIME_MS = 30_000;

type SidecarProcessClock = {
  setTimeout: (handler: () => void, delayMs: number) => ReturnType<typeof setTimeout>;
  clearTimeout: (handle: ReturnType<typeof setTimeout>) => void;
  random: () => number;
};

const SYSTEM_CLOCK: SidecarProcessClock = {
  setTimeout: (handler, delayMs) => setTimeout(handler, delayMs),
  clearTimeout: (handle) => clearTimeout(handle),
  random: () => Math.random(),
};

export class SidecarProcess {
  private readonly config: SidecarLaunchConfig;
  private readonly dispatcher: Dispatcher;
  private readonly log: Logger;
  private child: ChildProcessHandle | null = null;
  private host: SidecarHost | null = null;
  private stopRequested = false;
  private restartDelayMs = RESTART_INITIAL_DELAY_MS;
  private disableRunAsNode = false;
  private restartTimer: ReturnType<typeof setTimeout> | null = null;
  private stabilityTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly clock: SidecarProcessClock;

  constructor(
    config: SidecarLaunchConfig,
    dispatcher: Dispatcher,
    log: Logger,
    clock: SidecarProcessClock = SYSTEM_CLOCK,
  ) {
    this.config = config;
    this.dispatcher = dispatcher;
    this.log = log;
    this.clock = clock;
  }

  start(): boolean {
    this.clearRestartTimer();
    if (this.child) return true;
    this.stopRequested = false;
    const validation = validateServerConfig(this.config);
    if (!validation.ok) {
      this.log.error('sidecar config invalid', {
        reason: validation.reason,
        message: validation.message,
      });
      return false;
    }
    const serverConfig = validation.config;

    const childProcess = loadNativeModule<ChildProcessModule>('child_process', {
      message: SIDECAR_PERMISSION_MESSAGE,
      optional: true,
    });
    if (!isChildProcessModule(childProcess)) {
      this.log.warn(SIDECAR_CHILD_PROCESS_UNAVAILABLE);
      return false;
    }

    const pathModule = loadNativeModule<PathModule>('path', { optional: true });
    if (!isPathModule(pathModule)) {
      this.log.warn(SIDECAR_PATH_MODULE_UNAVAILABLE);
      return false;
    }

    const sidecarPath = this.resolveSidecarPath(pathModule);
    if (!sidecarPath) {
      this.log.error(SIDECAR_ENTRY_NOT_FOUND);
      return false;
    }
    const processModule = loadNativeModule<ProcessModule>('process', {
      message: SIDECAR_PERMISSION_MESSAGE,
      optional: true,
    });
    const execPath = this.resolveExecPath(processModule);
    if (!execPath) {
      this.log.error(SIDECAR_EXECPATH_UNAVAILABLE);
      return false;
    }

    const execBase = pathModule.basename?.(execPath)?.toLowerCase?.() ?? '';
    const useRunAsNode = !this.disableRunAsNode && execBase !== 'node' && execBase !== 'node.exe';
    const args = [
      ...(useRunAsNode ? ['--run-as-node'] : []),
      sidecarPath,
      '--host',
      serverConfig.host,
      '--port',
      String(serverConfig.port),
      '--path',
      serverConfig.path,
    ];
    const env: Record<string, string | undefined> = {
      ...(processModule?.env ?? {}),
    };
    if (serverConfig.token) env.ASHFOX_TOKEN = serverConfig.token;

    let child: ChildProcessHandle;
    try {
      child = childProcess.spawn(execPath, args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        windowsHide: true,
        env,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.log.error('sidecar spawn failed', { message });
      return false;
    }

    if (!child?.stdin || !child?.stdout) {
      this.log.error(SIDECAR_STDIO_UNAVAILABLE);
      child?.kill?.();
      return false;
    }

    this.child = child;
    this.host = new SidecarHost(child.stdout, child.stdin, this.dispatcher, this.log);
    const current = child;

    child.stderr?.on('data', (chunk: string | Uint8Array) => {
      const message = String(chunk).trim();
      if (message.length > 0) {
        if (message.includes('--run-as-node') && message.toLowerCase().includes('bad option')) {
          this.disableRunAsNode = true;
          this.log.warn(SIDECAR_RUN_AS_NODE_REJECTED);
        }
        this.log.warn('sidecar stderr', { message });
      }
    });
    child.on('exit', (code: number | null, signal: string | null) => {
      this.handleTermination(current, 'exit', { code, signal });
    });
    child.on('error', (err: Error) => {
      this.handleTermination(current, 'error', {
        message: errorMessage(err),
      });
    });

    this.clearStabilityTimer();
    this.stabilityTimer = this.clock.setTimeout(() => {
      this.stabilityTimer = null;
      if (this.child === current && !this.stopRequested) {
        this.restartDelayMs = RESTART_INITIAL_DELAY_MS;
      }
    }, RESTART_STABLE_UPTIME_MS);

    this.log.info('sidecar process spawned', { pid: child.pid });
    return true;
  }

  stop() {
    this.stopRequested = true;
    this.clearRestartTimer();
    this.clearStabilityTimer();
    if (this.child?.kill) {
      this.child.kill();
    }
    this.cleanup();
    this.restartDelayMs = RESTART_INITIAL_DELAY_MS;
  }

  private cleanup() {
    this.clearStabilityTimer();
    this.host?.dispose();
    this.host = null;
    this.child = null;
  }

  private scheduleRestart() {
    if (this.restartTimer || this.stopRequested) return;
    const delay = this.restartDelayMs;
    this.restartDelayMs = Math.min(this.restartDelayMs * 2, RESTART_MAX_DELAY_MS);
    const jitter = Math.round(delay * 0.2 * this.clock.random());
    const nextDelay = delay + jitter;
    this.restartTimer = this.clock.setTimeout(() => {
      this.restartTimer = null;
      if (!this.stopRequested && !this.start()) {
        this.scheduleRestart();
      }
    }, nextDelay);
  }

  private handleTermination(
    child: ChildProcessHandle,
    kind: 'error' | 'exit',
    meta: Record<string, unknown>,
  ): void {
    if (this.child !== child) return;
    this.cleanup();
    if (kind === 'error') {
      this.log.error('sidecar process error', meta);
      child.kill?.();
    } else {
      this.log.warn('sidecar exited', meta);
    }
    this.scheduleRestart();
  }

  private clearRestartTimer(): void {
    if (!this.restartTimer) return;
    this.clock.clearTimeout(this.restartTimer);
    this.restartTimer = null;
  }

  private clearStabilityTimer(): void {
    if (!this.stabilityTimer) return;
    this.clock.clearTimeout(this.stabilityTimer);
    this.stabilityTimer = null;
  }

  private resolveSidecarPath(pathModule: PathModule): string | null {
    const pluginPath = resolveRegisteredPluginPath(PLUGIN_ID);
    if (!pluginPath || !pathModule?.dirname || !pathModule?.join) return null;
    return pathModule.join(pathModule.dirname(pluginPath), 'ashfox-sidecar.js');
  }

  private resolveExecPath(processModule: ProcessModule | null): string | null {
    const override = this.config.execPath?.trim();
    if (override) return override;
    const execPath = processModule?.execPath;
    return typeof execPath === 'string' && execPath.trim().length > 0 ? execPath.trim() : null;
  }
}

function isChildProcessModule(value: unknown): value is ChildProcessModule {
  if (!value || typeof value !== 'object') return false;
  return typeof (value as { spawn?: unknown }).spawn === 'function';
}

function isPathModule(value: unknown): value is PathModule {
  if (!value || typeof value !== 'object') return false;
  const mod = value as { join?: unknown; dirname?: unknown };
  return typeof mod.join === 'function' && typeof mod.dirname === 'function';
}
