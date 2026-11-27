import type { ProjectDocument } from '../../model/document';
import { cubeUnrotatedBounds, type SceneNode } from '../../model/scene';
import type { AshfoxNamedBlock, AshfoxStatement } from '../program/syntax/blockAst';
import { parseAshfoxProgram } from '../program/syntax/blockParser';

export interface StructureInspectInput {
  readonly grid: {
    readonly rooms: readonly {
      readonly name: string;
      readonly from: readonly [number, number, number];
      readonly to: readonly [number, number, number];
    }[];
  };
  readonly playableMeta: {
    readonly lights: readonly {
      readonly id: string;
      readonly position: readonly [number, number, number];
    }[];
    readonly zones: readonly {
      readonly id: string;
      readonly from: readonly [number, number, number];
      readonly to: readonly [number, number, number];
    }[];
    readonly sockets: readonly {
      readonly id: string;
      readonly position: readonly [number, number, number];
    }[];
  };
}

export interface SourceFileInput {
  readonly path: string;
  readonly source: string;
}

export interface SourceInspectRef {
  readonly id: string;
  readonly symbol: string;
  readonly kind: string;
  readonly file: string;
  readonly line: number;
  readonly column: number;
  readonly sourceRef: string;
  readonly position?: readonly [number, number, number];
  readonly dims?: readonly [number, number, number];
}

const SOUND_DECL_RE = /^\s*(?:export\s+)?(sound|voice|seq)\s+([a-zA-Z_][a-zA-Z0-9_]*)\b/;

const makeRef = (
  symbol: string,
  kind: string,
  file: string,
  line: number,
  column: number,
  id = symbol,
): SourceInspectRef => ({
  id,
  symbol,
  kind,
  file,
  line,
  column,
  sourceRef: `${file}:${line}:${column}`,
});

const scanSoundLines = (file: SourceFileInput, out: SourceInspectRef[]): void => {
  const lines = file.source.split(/\r?\n/);
  for (let idx = 0; idx < lines.length; idx++) {
    const line = lines[idx]!;
    const match = SOUND_DECL_RE.exec(line);
    if (!match) continue;
    const kind = match[1]!;
    const name = match[2]!;
    const column = Math.max(1, line.indexOf(kind) + 1);
    out.push(makeRef(name, kind, file.path, idx + 1, column));
  }
};

const walkNamedBlock = (
  stmt: AshfoxNamedBlock,
  file: string,
  prefix: string,
  out: SourceInspectRef[],
): void => {
  const symbol = stmt.name ? (prefix ? `${prefix}.${stmt.name}` : stmt.name) : stmt.blockKind;
  out.push(
    makeRef(
      symbol,
      stmt.blockKind,
      file,
      stmt.span.start.line,
      stmt.span.start.column,
      stmt.name ?? symbol,
    ),
  );
  const nextPrefix = stmt.name ? symbol : prefix;
  for (const child of stmt.block.statements) {
    walkStatement(child, file, nextPrefix, out);
  }
};

const walkStatement = (
  stmt: AshfoxStatement,
  file: string,
  prefix: string,
  out: SourceInspectRef[],
): void => {
  if (stmt.kind === 'export') {
    walkNamedBlock(stmt.declaration, file, prefix, out);
  } else if (stmt.kind === 'named-block') {
    walkNamedBlock(stmt, file, prefix, out);
  }
};

const collectFileAstRefs = (file: SourceFileInput, out: SourceInspectRef[]): void => {
  const parsed = parseAshfoxProgram(file.source, file.path);
  if (!parsed.file) {
    scanSoundLines(file, out);
    return;
  }
  const { top } = parsed.file;
  out.push(makeRef(top.name, top.kind, file.path, top.span.start.line, top.span.start.column));
  if (top.kind === 'sound') {
    scanSoundLines(file, out);
    return;
  }
  for (const stmt of top.block.statements) {
    walkStatement(stmt, file.path, '', out);
  }
};

const nodeDims = (node: SceneNode): readonly [number, number, number] | undefined => {
  if (node.kind === 'cube') {
    const b = cubeUnrotatedBounds(node);
    return [b.to[0] - b.from[0], b.to[1] - b.from[1], b.to[2] - b.from[2]];
  }
  if (node.kind === 'plane') return [node.size[0], node.size[1], 0];
  return undefined;
};

const findMatchingNode = (
  ref: SourceInspectRef,
  nodes: readonly SceneNode[],
  byName: ReadonlyMap<string, SceneNode[]>,
): SceneNode | undefined => {
  const direct = byName.get(ref.id)?.[0] ?? byName.get(ref.symbol)?.[0];
  if (direct) return direct;
  const slashPath = ref.symbol.replace(/\./g, '/');
  const slashIndex = slashPath.indexOf('/');
  const subPath = slashIndex >= 0 ? slashPath.slice(slashIndex + 1) : '';
  const pathHit = nodes.find(
    (n) =>
      n.name === slashPath ||
      n.name.endsWith(`/${slashPath}`) ||
      (subPath.length > 0 && (n.name === subPath || n.name.endsWith(`/${subPath}`))),
  );
  if (pathHit) return pathHit;
  const leafSuffix = `/${ref.id}`;
  return nodes.find((n) => n.name.endsWith(leafSuffix));
};

const enrichWithDocument = (
  refs: SourceInspectRef[],
  document: ProjectDocument,
): SourceInspectRef[] => {
  const nodes = Object.values(document.scene.nodes);
  const byName = new Map<string, SceneNode[]>();
  for (const node of nodes) {
    const list = byName.get(node.name) ?? [];
    list.push(node);
    byName.set(node.name, list);
  }
  return refs.map((ref) => {
    const matched = findMatchingNode(ref, nodes, byName);
    if (!matched) return ref;
    const dims = nodeDims(matched);
    return {
      ...ref,
      id: matched.id,
      position: matched.transform.position,
      ...(dims ? { dims } : {}),
    };
  });
};

const enrichWithStructure = (
  refs: SourceInspectRef[],
  structure: StructureInspectInput,
): SourceInspectRef[] => {
  const rooms = new Map(structure.grid.rooms.map((r) => [r.name, r]));
  const lights = new Map(structure.playableMeta.lights.map((l) => [l.id, l]));
  const zones = new Map(structure.playableMeta.zones.map((z) => [z.id, z]));
  const sockets = new Map(structure.playableMeta.sockets.map((s) => [s.id, s]));
  return refs.map((ref) => {
    const room = rooms.get(ref.id) ?? rooms.get(ref.symbol);
    if (room) {
      return {
        ...ref,
        position: room.from,
        dims: [room.to[0] - room.from[0], room.to[1] - room.from[1], room.to[2] - room.from[2]],
      };
    }
    const socket = sockets.get(ref.id) ?? sockets.get(ref.symbol);
    if (socket) return { ...ref, position: socket.position, dims: [1, 1, 1] };
    const light = lights.get(ref.id);
    if (light) return { ...ref, position: light.position };
    const zone = zones.get(ref.id);
    if (zone) {
      return {
        ...ref,
        position: zone.from,
        dims: [zone.to[0] - zone.from[0], zone.to[1] - zone.from[1], zone.to[2] - zone.from[2]],
      };
    }
    return ref;
  });
};

export const collectInspectRefs = (
  files: readonly SourceFileInput[],
  options?: {
    readonly document?: ProjectDocument;
    readonly structure?: StructureInspectInput;
  },
): readonly SourceInspectRef[] => {
  const raw: SourceInspectRef[] = [];
  for (const file of files) {
    if (file.path.endsWith('.ashfox')) collectFileAstRefs(file, raw);
  }
  let enriched = options?.document ? enrichWithDocument(raw, options.document) : raw;
  if (options?.structure) enriched = enrichWithStructure(enriched, options.structure);
  return Object.freeze(enriched);
};
