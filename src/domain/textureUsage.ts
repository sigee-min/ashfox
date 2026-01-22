import { CubeFaceDirection, TextureUsageResult } from '../ports/editor';

type NormalizedFace = { face: CubeFaceDirection; uv: [number, number, number, number] | null };
type NormalizedCube = { id: string | null; name: string; faces: NormalizedFace[] };
type NormalizedTexture = { id: string | null; name: string; cubes: NormalizedCube[] };

const FACE_ORDER: CubeFaceDirection[] = ['north', 'south', 'east', 'west', 'up', 'down'];
const FACE_INDEX = new Map<CubeFaceDirection, number>(FACE_ORDER.map((face, idx) => [face, idx]));

const compareStrings = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

const sortKey = (name: string, id?: string | null) => `${name}|${id ?? ''}`;

const normalizeFaces = (faces: NormalizedFace[]): NormalizedFace[] =>
  faces
    .slice()
    .sort((a, b) => (FACE_INDEX.get(a.face) ?? 0) - (FACE_INDEX.get(b.face) ?? 0));

const normalizeUsage = (usage: TextureUsageResult): { textures: NormalizedTexture[] } => {
  const textures = usage.textures
    .map((texture) => {
      const cubes = texture.cubes
        .map((cube) => {
          const faces = normalizeFaces(
            cube.faces.map((face) => ({
              face: face.face,
              uv: face.uv ? [...face.uv] : null
            }))
          );
          return { id: cube.id ?? null, name: cube.name, faces };
        })
        .sort((a, b) => compareStrings(sortKey(a.name, a.id), sortKey(b.name, b.id)));
      return { id: texture.id ?? null, name: texture.name, cubes };
    })
    .sort((a, b) => compareStrings(sortKey(a.name, a.id), sortKey(b.name, b.id)));
  return { textures };
};

export const computeTextureUsageId = (usage: TextureUsageResult): string =>
  hashText(JSON.stringify(normalizeUsage(usage)));

const hashText = (value: string): string => {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
};
