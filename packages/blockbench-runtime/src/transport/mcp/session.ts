import { SseConnection } from './types';
import {
  MCP_MAX_SESSIONS,
  MCP_MAX_SSE_CONNECTIONS,
  MCP_MAX_SSE_CONNECTIONS_PER_SESSION,
} from '../limits';

export type McpSession = {
  id: string;
  generation: number;
  closed: boolean;
  protocolVersion: string;
  initialized: boolean;
  createdAt: number;
  lastSeenAt: number;
  sseConnections: Set<SseConnection>;
  sseReservations: number;
};

export class SessionStore {
  private readonly sessions = new Map<string, McpSession>();
  private nextGeneration = 1;
  private totalSseConnections = 0;
  private totalSseReservations = 0;
  private readonly maxSessions: number;
  private readonly maxSseConnections: number;
  private readonly maxSseConnectionsPerSession: number;

  constructor(
    maxSessions = MCP_MAX_SESSIONS,
    maxSseConnections = MCP_MAX_SSE_CONNECTIONS,
    maxSseConnectionsPerSession = MCP_MAX_SSE_CONNECTIONS_PER_SESSION,
  ) {
    this.maxSessions = normalizePositiveLimit(maxSessions, MCP_MAX_SESSIONS);
    this.maxSseConnections = normalizePositiveLimit(maxSseConnections, MCP_MAX_SSE_CONNECTIONS);
    this.maxSseConnectionsPerSession = normalizePositiveLimit(
      maxSseConnectionsPerSession,
      MCP_MAX_SSE_CONNECTIONS_PER_SESSION,
    );
  }

  create(id: string, protocolVersion: string): McpSession {
    const available = this.tryCreate(id, protocolVersion);
    if (available) return available;
    const oldest = this.sessions.values().next().value as McpSession | undefined;
    if (oldest) this.close(oldest);
    return this.tryCreate(id, protocolVersion) as McpSession;
  }

  tryCreate(id: string, protocolVersion: string): McpSession | null {
    const existing = this.sessions.get(id);
    if (existing) this.close(existing);
    if (this.sessions.size >= this.maxSessions) return null;
    const now = Date.now();
    const session: McpSession = {
      id,
      generation: this.nextGeneration++,
      closed: false,
      protocolVersion,
      initialized: false,
      createdAt: now,
      lastSeenAt: now,
      sseConnections: new Set(),
      sseReservations: 0,
    };
    this.sessions.set(id, session);
    return session;
  }

  get size(): number {
    return this.sessions.size;
  }

  get sseConnectionCount(): number {
    return this.totalSseConnections;
  }

  get sseReservationCount(): number {
    return this.totalSseReservations;
  }

  get(id: string): McpSession | null {
    return this.sessions.get(id) ?? null;
  }

  touch(session: McpSession) {
    if (!this.isActive(session)) return;
    session.lastSeenAt = Date.now();
  }

  attachSse(session: McpSession, connection: SseConnection): boolean {
    if (
      !this.isActive(session) ||
      session.sseConnections.size >= this.maxSseConnectionsPerSession ||
      this.totalSseConnections + this.totalSseReservations >= this.maxSseConnections
    ) {
      connection.close();
      return false;
    }
    session.sseConnections.add(connection);
    this.totalSseConnections += 1;
    return true;
  }

  reserveSse(session: McpSession): boolean {
    if (!this.isActive(session)) return false;
    if (
      session.sseConnections.size + session.sseReservations >= this.maxSseConnectionsPerSession ||
      this.totalSseConnections + this.totalSseReservations >= this.maxSseConnections
    ) {
      return false;
    }
    session.sseReservations += 1;
    this.totalSseReservations += 1;
    return true;
  }

  attachReservedSse(session: McpSession, connection: SseConnection): boolean {
    if (!this.isActive(session) || session.sseReservations <= 0) {
      connection.close();
      return false;
    }
    session.sseReservations -= 1;
    this.totalSseReservations = Math.max(0, this.totalSseReservations - 1);
    session.sseConnections.add(connection);
    this.totalSseConnections += 1;
    return true;
  }

  releaseSseReservation(session: McpSession): boolean {
    if (!this.isActive(session) || session.sseReservations <= 0) {
      return false;
    }
    session.sseReservations = Math.max(0, session.sseReservations - 1);
    this.totalSseReservations = Math.max(0, this.totalSseReservations - 1);
    return true;
  }

  detachSse(session: McpSession, connection: SseConnection) {
    if (session.sseConnections.delete(connection)) {
      this.totalSseConnections = Math.max(0, this.totalSseConnections - 1);
    }
  }

  pruneStale(ttlMs: number, now: number = Date.now()): number {
    if (!Number.isFinite(ttlMs) || ttlMs <= 0) return 0;
    const cutoff = now - ttlMs;
    let removed = 0;
    for (const session of Array.from(this.sessions.values())) {
      if (session.sseConnections.size > 0) {
        for (const conn of Array.from(session.sseConnections)) {
          if (conn.isClosed()) {
            session.sseConnections.delete(conn);
            this.totalSseConnections = Math.max(0, this.totalSseConnections - 1);
          }
        }
      }
      if (session.sseConnections.size > 0 || session.sseReservations > 0) {
        continue;
      }
      if (session.lastSeenAt >= cutoff) continue;
      this.close(session);
      removed += 1;
    }
    return removed;
  }

  close(session: McpSession) {
    if (session.closed) return;
    session.closed = true;
    for (const conn of session.sseConnections) {
      conn.close();
    }
    this.totalSseConnections = Math.max(0, this.totalSseConnections - session.sseConnections.size);
    this.totalSseReservations = Math.max(0, this.totalSseReservations - session.sseReservations);
    session.sseConnections.clear();
    session.sseReservations = 0;
    if (this.sessions.get(session.id) === session) {
      this.sessions.delete(session.id);
    }
  }

  private isActive(session: McpSession): boolean {
    return !session.closed && this.sessions.get(session.id) === session;
  }
}

const normalizePositiveLimit = (value: number, fallback: number): number =>
  Number.isSafeInteger(value) && value > 0 ? value : fallback;
