import { compileBundle, checkSnapshot } from '../bundle/compile';
import { BuildFailure, type Snapshot } from '../bundle/contract';
import { createVorbisEncoder } from './vorbis';
type CheckedWorkspace = ReturnType<typeof checkSnapshot>;

const assertBindingHasNoLoop = (
  packFormat: string,
  sourceName: string,
  checked: CheckedWorkspace,
): void => {
  const target = checked.config.exports.find((e) => e.name === sourceName);
  const product = checked.products.find(
    (p) =>
      p.entry.packageName === target?.entry.packageName &&
      p.entry.entryName === target?.entry.entryName,
  );
  if (product?.kind === 'sound' && product.sounds.some((s) => s.playback.kind === 'loop'))
    throw new BuildFailure(
      packFormat === 'minecraft_java' ? 'sound.loop.target' : 'sound.loop.codec',
      `${sourceName}: loop audio requires WAV game delivery`,
    );
};

const assertNoLoopPackBindings = (checked: CheckedWorkspace): void => {
  for (const pack of checked.config.packs ?? []) {
    const bindings =
      pack.format === 'minecraft_java' ? pack.sounds : pack.audio === 'ogg' ? pack.assets : [];
    for (const binding of bindings) assertBindingHasNoLoop(pack.format, binding.source, checked);
  }
};

const requiresVorbisEncoder = (snapshot: Snapshot): boolean =>
  Boolean(
    snapshot.config.packs?.some((pack) =>
      pack.format === 'minecraft_java'
        ? pack.sounds.length > 0
        : pack.audio === 'ogg' &&
          pack.assets.some((a) =>
            snapshot.config.exports.some((e) => e.name === a.source && e.format === 'wav'),
          ),
    ),
  );

export const compileNodeBundle = async (
  snapshot: Snapshot,
  toolchain: string,
  signal?: AbortSignal,
) => {
  const checked = checkSnapshot(snapshot);
  assertNoLoopPackBindings(checked);
  const encoder = requiresVorbisEncoder(snapshot) ? await createVorbisEncoder(signal) : undefined;
  return compileBundle(snapshot, toolchain, encoder, checked);
};
