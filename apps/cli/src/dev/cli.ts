import { spawn } from 'node:child_process';
import { BuildFailure } from '@ashfox/asset-build';
import { startDevSession } from './watch';

export interface DevCliOptions {
  readonly input: string;
  readonly port: number;
  readonly open: boolean;
}

const DEFAULT_PORT = 4173;

export const parseDevArgs = (args: readonly string[]): DevCliOptions => {
  let port = DEFAULT_PORT;
  let open = true;
  const positionals: string[] = [];
  for (let i = 1; i < args.length; i++) {
    const arg = args[i]!;
    if (arg === '--no-open') {
      open = false;
      continue;
    }
    if (arg === '--port') {
      const raw = args[i + 1];
      const parsed = raw ? Number(raw) : NaN;
      if (!Number.isInteger(parsed) || parsed < 0 || parsed > 65535) {
        throw new BuildFailure('cli.arguments', 'Invalid --port value; expected 0..65535', 2);
      }
      port = parsed;
      i += 1;
      continue;
    }
    if (arg.startsWith('--')) {
      throw new BuildFailure('cli.arguments', `Unknown option "${arg}" for ashfox dev`, 2);
    }
    positionals.push(arg);
  }
  if (positionals.length !== 1) {
    throw new BuildFailure(
      'cli.arguments',
      'Usage: ashfox dev <workspace|file.ashfox> [--port 4173] [--no-open]',
      2,
    );
  }
  return { input: positionals[0]!, port, open };
};

const openBrowserUrl = (url: string): void => {
  const cmd =
    process.platform === 'darwin'
      ? ['open', [url]]
      : process.platform === 'win32'
        ? ['cmd', ['/c', 'start', '', url]]
        : ['xdg-open', [url]];
  const child = spawn(cmd[0] as string, cmd[1] as string[], {
    detached: true,
    stdio: 'ignore',
  });
  child.unref();
};

export const runDevCommand = async (
  args: readonly string[],
  signal: AbortSignal,
): Promise<void> => {
  const { input, port, open } = parseDevArgs(args);
  const session = await startDevSession(input, port, signal);
  process.stdout.write(`Ashfox Dev listening at ${session.url}\n`);
  if (open) openBrowserUrl(session.url);
  await new Promise<void>((resolve) => {
    if (signal.aborted) {
      resolve();
      return;
    }
    signal.addEventListener('abort', () => resolve(), { once: true });
  });
  await session.close();
};
