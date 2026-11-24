import { validateServerConfig, type ServerConfigValidationResult } from '../serverConfig';
import { DEFAULT_SERVER_HOST, DEFAULT_SERVER_PATH, DEFAULT_SERVER_PORT } from '../config';

type CliArgument = {
  present: boolean;
  value?: string;
};

const readArgument = (args: readonly string[], name: string): CliArgument => {
  const index = args.indexOf(name);
  if (index < 0) return { present: false };
  const value = args[index + 1];
  if (typeof value !== 'string' || value.startsWith('--')) return { present: true };
  return { present: true, value };
};

const withDefault = (argument: CliArgument, fallback: string): unknown =>
  argument.present ? argument.value : fallback;

export const resolveSidecarServerConfig = (
  args: readonly string[],
  environment: Readonly<Record<string, string | undefined>> = {},
): ServerConfigValidationResult => {
  const host = readArgument(args, '--host');
  const port = readArgument(args, '--port');
  const path = readArgument(args, '--path');
  const token = readArgument(args, '--token');
  const rawPort = withDefault(port, String(DEFAULT_SERVER_PORT));

  return validateServerConfig({
    host: withDefault(host, DEFAULT_SERVER_HOST),
    port: typeof rawPort === 'string' ? Number(rawPort) : Number.NaN,
    path: withDefault(path, DEFAULT_SERVER_PATH),
    token: token.present ? token.value : environment.ASHFOX_TOKEN,
  });
};
