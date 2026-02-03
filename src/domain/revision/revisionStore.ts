import { SessionState } from '../../session';

export class RevisionStore {
  private readonly cache = new Map<string, SessionState>();
  private readonly order: string[] = [];
  private readonly limit: number;

  constructor(limit: number) {
    this.limit = limit;
  }

  hash(snapshot: SessionState): string {
    return hashSnapshot(snapshot);
  }

  track(snapshot: SessionState): string {
    const revision = hashSnapshot(snapshot);
    this.remember(snapshot, revision);
    return revision;
  }

  remember(snapshot: SessionState, revision: string): void {
    if (!revision) return;
    const cloned = cloneSnapshot(snapshot);
    if (!this.cache.has(revision)) {
      this.order.push(revision);
      if (this.order.length > this.limit) {
        const oldest = this.order.shift();
        if (oldest) this.cache.delete(oldest);
      }
    }
    this.cache.set(revision, cloned);
  }

  get(revision: string): SessionState | null {
    return this.cache.get(revision) ?? null;
  }
}

const hashSnapshot = (snapshot: SessionState): string => {
  const data = {
    id: snapshot.id ?? '',
    format: snapshot.format ?? '',
    formatId: snapshot.formatId ?? '',
    name: snapshot.name ?? '',
    dirty: snapshot.dirty ?? null,
    meta: snapshot.meta
      ? {
          facePaint: snapshot.meta.facePaint?.map((entry) => ({
            material: entry.material,
            palette: entry.palette ?? null,
            seed: entry.seed ?? null,
            cubeIds: entry.cubeIds ?? null,
            cubeNames: entry.cubeNames ?? null,
            faces: entry.faces ?? null,
            scope: entry.scope ?? null,
            mapping: entry.mapping ?? null,
            padding: entry.padding ?? null,
            anchor: entry.anchor ?? null
          }))
        }
      : null,
    bones: snapshot.bones.map((b) => [
      b.id ?? '',
      b.name,
      b.parent ?? '',
      b.pivot,
      b.rotation ?? null,
      b.scale ?? null
    ]),
    cubes: snapshot.cubes.map((c) => [
      c.id ?? '',
      c.name,
      c.bone,
      c.from,
      c.to,
      c.uv ?? null,
      c.inflate ?? null,
      c.mirror ?? null
    ]),
    textures: snapshot.textures.map((t) => [
      t.id ?? '',
      t.name,
      t.path ?? '',
      t.width ?? 0,
      t.height ?? 0,
      t.contentHash ?? '',
      t.namespace ?? null,
      t.folder ?? null,
      t.particle ?? null,
      t.visible ?? null,
      t.renderMode ?? null,
      t.renderSides ?? null,
      t.pbrChannel ?? null,
      t.group ?? null,
      t.frameTime ?? null,
      t.frameOrderType ?? null,
      t.frameOrder ?? null,
      t.frameInterpolate ?? null,
      t.internal ?? null,
      t.keepSize ?? null
    ]),
    animations: snapshot.animations.map((a) => [
      a.id ?? '',
      a.name,
      a.length,
      a.loop,
      a.fps ?? null,
      a.channels?.length ?? 0,
      a.triggers?.length ?? 0
    ])
  };
  return hashString(JSON.stringify(data));
};

const hashString = (value: string): string => {
  let hash = 5381;
  for (let i = 0; i < value.length; i += 1) {
    hash = ((hash << 5) + hash) ^ value.charCodeAt(i);
  }
  return (hash >>> 0).toString(16);
};

const cloneSnapshot = (snapshot: SessionState): SessionState => ({
  ...snapshot,
  meta: snapshot.meta
    ? {
        facePaint: snapshot.meta.facePaint?.map((entry) => ({
          material: entry.material,
          palette: entry.palette ? [...entry.palette] : undefined,
          seed: entry.seed,
          cubeIds: entry.cubeIds ? [...entry.cubeIds] : undefined,
          cubeNames: entry.cubeNames ? [...entry.cubeNames] : undefined,
          faces: entry.faces ? [...entry.faces] : undefined,
          scope: entry.scope,
          mapping: entry.mapping,
          padding: entry.padding,
          anchor: entry.anchor ? ([entry.anchor[0], entry.anchor[1]] as [number, number]) : undefined
        }))
      }
    : undefined,
  bones: snapshot.bones.map((bone) => ({ ...bone })),
  cubes: snapshot.cubes.map((cube) => ({ ...cube })),
  textures: snapshot.textures.map((tex) => ({ ...tex })),
  animations: snapshot.animations.map((anim) => ({
    ...anim,
    channels: anim.channels ? anim.channels.map((ch) => ({ ...ch, keys: [...ch.keys] })) : undefined,
    triggers: anim.triggers ? anim.triggers.map((tr) => ({ ...tr, keys: [...tr.keys] })) : undefined
  })),
  animationsStatus: snapshot.animationsStatus
});



