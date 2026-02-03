import type { CubeStat, TextureGroup } from './types';

export const resolveTextureNames = (
  baseName: string,
  textureCount: number,
  existingNames: Set<string>,
  notes: string[],
  options?: { preferBaseName?: boolean; reuseExisting?: boolean }
): string[] => {
  const names: string[] = [];
  const preferBaseName = options?.preferBaseName === true;
  const reuseExisting = options?.reuseExisting === true;
  const suffixBase = textureCount > 1 ? '_part' : '';
  for (let i = 0; i < textureCount; i += 1) {
    const base =
      textureCount > 1
        ? i === 0 && preferBaseName
          ? baseName
          : `${baseName}${suffixBase}${i + 1}`
        : baseName;
    const canReuse = reuseExisting && existingNames.has(base);
    const name = canReuse ? base : ensureUniqueName(base, existingNames);
    if (name !== base && !canReuse) {
      notes.push(`Texture name "${base}" already exists; using "${name}".`);
    }
    names.push(name);
    existingNames.add(name);
  }
  return names;
};

const ensureUniqueName = (base: string, existingNames: Set<string>): string => {
  if (!existingNames.has(base)) return base;
  let suffix = 2;
  let candidate = `${base}_${suffix}`;
  while (existingNames.has(candidate)) {
    suffix += 1;
    candidate = `${base}_${suffix}`;
  }
  return candidate;
};

export const splitTextureGroups = (cubes: CubeStat[], names: string[]): TextureGroup[] => {
  const groups: TextureGroup[] = names.map((name) => ({ name, cubes: [], area: 0 }));
  const sorted = [...cubes].sort((a, b) => {
    if (b.area !== a.area) return b.area - a.area;
    return a.cube.name.localeCompare(b.cube.name);
  });
  sorted.forEach((entry) => {
    const target = groups.reduce((min, group) => (group.area < min.area ? group : min), groups[0]);
    target.cubes.push(entry.cube);
    target.area += entry.area;
  });
  return groups;
};
