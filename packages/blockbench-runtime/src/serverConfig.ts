import {
  CONFIG_HOST_REQUIRED,
  CONFIG_NON_LOOPBACK_TOKEN_REQUIRED,
  CONFIG_PATH_REQUIRED,
  CONFIG_PORT_RANGE,
} from './shared/messages';
import { normalizePath } from './shared/endpoint';

export type ServerConfig = {
  host: string;
  port: number;
  path: string;
  token?: string;
};

type ServerConfigInput = {
  host: unknown;
  port: unknown;
  path: unknown;
  token?: unknown;
};

export type ServerConfigValidationReason =
  'host_required' | 'port_out_of_range' | 'path_required' | 'non_loopback_token_required';

export type ServerConfigValidationResult =
  | { ok: true; config: ServerConfig }
  | { ok: false; reason: ServerConfigValidationReason; message: string };

const isLoopbackHost = (value: string): boolean => {
  const host = value.trim().toLowerCase();
  if (host === 'localhost' || host === '::1' || host === '[::1]' || host === '0:0:0:0:0:0:0:1') {
    return true;
  }

  const ipv4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(host);
  if (!ipv4) return false;
  const octets = ipv4.slice(1).map(Number);
  return octets.every((octet) => octet >= 0 && octet <= 255) && octets[0] === 127;
};

export const validateServerConfig = (input: unknown): ServerConfigValidationResult => {
  const candidate = input && typeof input === 'object' ? (input as Partial<ServerConfigInput>) : {};

  if (typeof candidate.host !== 'string' || candidate.host.trim().length === 0) {
    return { ok: false, reason: 'host_required', message: CONFIG_HOST_REQUIRED };
  }
  const host = candidate.host.trim();

  if (
    typeof candidate.port !== 'number' ||
    !Number.isSafeInteger(candidate.port) ||
    candidate.port < 1 ||
    candidate.port > 65535
  ) {
    return { ok: false, reason: 'port_out_of_range', message: CONFIG_PORT_RANGE };
  }

  if (typeof candidate.path !== 'string' || candidate.path.trim().length === 0) {
    return { ok: false, reason: 'path_required', message: CONFIG_PATH_REQUIRED };
  }
  const path = normalizePath(candidate.path);

  const token = typeof candidate.token === 'string' ? candidate.token.trim() : '';
  if (!isLoopbackHost(host) && token.length === 0) {
    return {
      ok: false,
      reason: 'non_loopback_token_required',
      message: CONFIG_NON_LOOPBACK_TOKEN_REQUIRED,
    };
  }

  const config: ServerConfig = {
    host: host === '[::1]' ? '::1' : host,
    port: candidate.port,
    path,
  };
  if (token.length > 0) config.token = token;
  return { ok: true, config };
};
