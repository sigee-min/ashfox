import { RigTemplateKind } from '../spec';

type RigTemplatePart = {
  id: string;
  size: [number, number, number];
  offset: [number, number, number];
  inflate?: number;
  mirror?: boolean;
  pivot?: [number, number, number];
  parent?: string;
};

const BLOCK_ENTITY_BASE: RigTemplatePart[] = [
  { id: 'root', size: [16, 16, 16], offset: [0, 0, 0] }
];

export function buildRigTemplate(kind: RigTemplateKind, parts: RigTemplatePart[]): RigTemplatePart[] {
  if (kind === 'block_entity') return merge(parts, BLOCK_ENTITY_BASE);
  return parts;
}

function merge(customParts: RigTemplatePart[], template: RigTemplatePart[]): RigTemplatePart[] {
  const ids = new Set(customParts.map((p) => p.id));
  const merged = [...template.filter((t) => !ids.has(t.id)), ...customParts];
  return merged;
}


