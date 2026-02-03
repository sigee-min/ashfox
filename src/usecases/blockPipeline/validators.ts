import type { BlockVariant } from '../../types/blockPipeline';

const DEFAULT_BLOCK_NAMESPACE = 'mod';
const VALID_RESOURCE_TOKEN = /^[a-z0-9._-]+$/;

export const normalizeBlockNamespace = (value?: string): string => {
  const trimmed = String(value ?? '').trim();
  return trimmed.length > 0 ? trimmed : DEFAULT_BLOCK_NAMESPACE;
};

export const normalizeBlockVariants = (variants?: BlockVariant[]): BlockVariant[] => {
  const list: BlockVariant[] = Array.isArray(variants) && variants.length > 0 ? variants : ['block'];
  const valid: BlockVariant[] = ['block', 'slab', 'stairs', 'wall'];
  const set = new Set<BlockVariant>();
  list.forEach((variant) => {
    if (valid.includes(variant)) {
      set.add(variant);
    }
  });
  return Array.from(set);
};

export const isValidResourceToken = (value: string): boolean => VALID_RESOURCE_TOKEN.test(value);

export const stripPrefix = (value: string, prefix: string): string =>
  value.startsWith(prefix) ? value.slice(prefix.length) : value;
