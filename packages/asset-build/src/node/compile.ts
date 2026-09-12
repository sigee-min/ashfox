import { compileBundle } from '../bundle/compile';
import type { Snapshot } from '../bundle/contract';
import { createVorbisEncoder } from './vorbis';
export const compileNodeBundle = async (
  snapshot: Snapshot,
  toolchain: string,
  signal?: AbortSignal,
) => {
  const needsEncoder = snapshot.config.packs?.some((pack) =>
    pack.format === 'minecraft_java'
      ? pack.sounds.length > 0
      : pack.audio === 'ogg' &&
        pack.assets.some((a) =>
          snapshot.config.exports.some((e) => e.name === a.source && e.format === 'wav'),
        ),
  );
  const encoder = needsEncoder ? await createVorbisEncoder(signal) : undefined;
  return compileBundle(snapshot, toolchain, encoder);
};
