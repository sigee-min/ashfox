import type { HttpRequest, McpServerConfig } from './types';
import {
  MCP_HOST_NOT_ALLOWED,
  MCP_HOST_REQUIRED,
  MCP_ORIGIN_NOT_ALLOWED,
} from '../../shared/messages';

type EndpointAuthority = NonNullable<McpServerConfig['endpoint']>;

type ParsedAuthority = {
  hostname: string;
  port: number;
};

export type IngressSecurityFailure = {
  code: 'host_required' | 'host_not_allowed' | 'origin_not_allowed';
  message: string;
};

const parsePort = (raw: string | undefined): number | null => {
  if (raw === undefined) return 80;
  if (!/^[0-9]+$/.test(raw)) return null;
  const port = Number(raw);
  return Number.isInteger(port) && port >= 1 && port <= 65_535 ? port : null;
};

const parseAuthority = (raw: string): ParsedAuthority | null => {
  if (raw.length === 0 || raw.trim() !== raw || raw.includes(',')) return null;
  if (raw.startsWith('[')) {
    const match = /^\[([^\]]+)\](?::([0-9]+))?$/.exec(raw);
    if (!match) return null;
    const port = parsePort(match[2]);
    if (port === null) return null;
    return { hostname: match[1].toLowerCase(), port };
  }
  const match = /^([^:]+)(?::([0-9]+))?$/.exec(raw);
  if (!match || /[\s/@?#\\]/.test(match[1])) return null;
  const port = parsePort(match[2]);
  if (port === null) return null;
  return { hostname: match[1].toLowerCase(), port };
};

const isLoopbackAuthorityHost = (hostname: string): boolean => {
  if (hostname === 'localhost') return true;
  if (hostname === '::1' || hostname === '0:0:0:0:0:0:0:1') return true;
  const octets = hostname.split('.');
  if (octets.length !== 4 || octets.some((part) => !/^[0-9]{1,3}$/.test(part))) {
    return false;
  }
  const values = octets.map(Number);
  return values.every((value) => value <= 255) && values[0] === 127;
};

const isAllowedHost = (authority: ParsedAuthority, endpoint: EndpointAuthority): boolean => {
  if (authority.port !== endpoint.port) return false;
  const configuredHost = endpoint.host
    .trim()
    .toLowerCase()
    .replace(/^\[|\]$/g, '');
  const authorityHost = authority.hostname.replace(/^\[|\]$/g, '');
  if (isLoopbackAuthorityHost(configuredHost)) {
    return isLoopbackAuthorityHost(authorityHost);
  }
  return authorityHost === configuredHost;
};

const isAllowedOrigin = (raw: string, endpoint: EndpointAuthority): boolean => {
  if (raw.length === 0 || raw.trim() !== raw || raw.includes(',')) return false;
  try {
    const url = new URL(raw);
    if (
      url.protocol !== 'http:' ||
      url.username ||
      url.password ||
      url.pathname !== '/' ||
      url.search ||
      url.hash
    ) {
      return false;
    }
    const port = url.port ? Number(url.port) : 80;
    return isAllowedHost({ hostname: url.hostname, port }, endpoint);
  } catch (_err) {
    return false;
  }
};

export const validateIngressSecurity = (
  req: HttpRequest,
  config: McpServerConfig,
): IngressSecurityFailure | null => {
  const endpoint = config.endpoint;
  if (!endpoint) return null;
  const hostRaw = req.headers.host;
  if (!hostRaw) {
    return { code: 'host_required', message: MCP_HOST_REQUIRED };
  }
  const authority = parseAuthority(hostRaw);
  if (!authority || !isAllowedHost(authority, endpoint)) {
    return { code: 'host_not_allowed', message: MCP_HOST_NOT_ALLOWED };
  }
  const origin = req.headers.origin;
  if (!origin) return null;
  const hasValidToken = Boolean(
    config.token && req.headers.authorization === `Bearer ${config.token}`,
  );
  if (!hasValidToken && !isAllowedOrigin(origin, endpoint)) {
    return { code: 'origin_not_allowed', message: MCP_ORIGIN_NOT_ALLOWED };
  }
  return null;
};
