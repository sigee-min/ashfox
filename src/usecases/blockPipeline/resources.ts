import type { BlockResource } from '../../domain/blockPipeline';
import type { ResourceStore } from '../../ports/resources';
import { stripPrefix } from './validators';

export type BlockResourceEntry = {
  uri: string;
  kind: BlockResource['kind'];
  name: string;
  mimeType: string;
  text: string;
};

export const collectBlockAssets = (resources: BlockResource[]) => {
  const blockstates: Record<string, unknown> = {};
  const models: Record<string, unknown> = {};
  const items: Record<string, unknown> = {};
  resources.forEach((resource) => {
    if (resource.kind === 'blockstate') {
      blockstates[resource.name] = resource.json;
    } else if (resource.kind === 'model') {
      models[resource.name] = resource.json;
    } else if (resource.kind === 'item') {
      items[resource.name] = resource.json;
    }
  });
  return { blockstates, models, items };
};

export const buildBlockResourceEntries = (namespace: string, resources: BlockResource[]): BlockResourceEntry[] =>
  resources.map((resource) => ({
    uri: buildBlockResourceUri(namespace, resource),
    kind: resource.kind,
    name: resource.name,
    mimeType: 'application/json',
    text: JSON.stringify(resource.json, null, 2)
  }));

export const resolveVersionedEntries = (
  store: ResourceStore,
  entries: BlockResourceEntry[]
): { suffix: string; entries: BlockResourceEntry[] } | null => {
  for (let version = 2; version < 100; version += 1) {
    const suffix = `_v${version}`;
    const next = entries.map((entry) => ({ ...entry, uri: appendUriSuffix(entry.uri, suffix) }));
    if (next.every((entry) => !store.has(entry.uri))) {
      return { suffix, entries: next };
    }
  }
  return null;
};

const buildBlockResourceUri = (namespace: string, resource: BlockResource): string => {
  if (resource.kind === 'blockstate') {
    return `bbmcp://blockstate/${namespace}/${resource.name}`;
  }
  if (resource.kind === 'model') {
    const modelName = stripPrefix(resource.name, 'block/');
    return `bbmcp://model/block/${namespace}/${modelName}`;
  }
  const itemName = stripPrefix(resource.name, 'item/');
  return `bbmcp://model/item/${namespace}/${itemName}`;
};

const appendUriSuffix = (uri: string, suffix: string): string => {
  const idx = uri.lastIndexOf('/');
  if (idx < 0) return `${uri}${suffix}`;
  return `${uri.slice(0, idx + 1)}${uri.slice(idx + 1)}${suffix}`;
};
