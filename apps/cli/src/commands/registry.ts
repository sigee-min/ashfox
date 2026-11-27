import { BuildFailure } from '@ashfox/asset-build';
import { runDevCommand } from '../dev/cli';
import { runDocsCommand } from '../docs/cli';
import { runLibraryCommand } from '../library/cli';
import { runMediaCommand } from '../observe/cli';
import { runOnboarding } from '../onboarding/cli';
import { runBuildCommand } from './build';
import { runCheckCommand } from './check';

type CliVerb = 'init' | 'doctor' | 'check' | 'render' | 'build' | 'dev' | 'library' | 'docs';

interface CliCommandContext {
  readonly command: string;
  readonly args: readonly string[];
  readonly executable: string;
  readonly signal: AbortSignal;
}

type CliCommandHandler = (context: CliCommandContext) => Promise<void> | void;

const CLI_COMMANDS: Readonly<Record<CliVerb, CliCommandHandler>> = Object.freeze({
  init: ({ args }) => {
    runOnboarding(args);
  },
  doctor: ({ args }) => {
    runOnboarding(args);
  },
  check: ({ args, executable, signal }) => runCheckCommand(args, executable, signal),
  render: ({ args, executable, signal }) => runMediaCommand(args, executable, signal),
  build: ({ args, executable, signal }) => runBuildCommand(args, executable, signal),
  dev: ({ args, signal }) => runDevCommand(args, signal),
  library: ({ args }) => {
    runLibraryCommand(args);
  },
  docs: ({ args }) => {
    runDocsCommand(args);
  },
});

const HELP_OR_VERSION = new Set(['help', '--help', '--version']);

/** Routes parsed CLI invocation to help/version onboarding or the closed 8-verb command table. */
export const dispatchCliCommand = async (context: CliCommandContext): Promise<void> => {
  if (HELP_OR_VERSION.has(context.command)) {
    runOnboarding(context.args);
    return;
  }
  if (!Object.hasOwn(CLI_COMMANDS, context.command)) {
    throw new BuildFailure(
      'cli.arguments',
      'Unknown or invalid command. Expected init, doctor, check, render, build, dev, library, or docs.',
      2,
    );
  }
  await CLI_COMMANDS[context.command as CliVerb](context);
};
