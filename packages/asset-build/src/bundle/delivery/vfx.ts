import { encodeUtf8 } from '@ashfox/internal-contracts';
import { json } from '../../shared/digest';
import { BuildFailure, type Artifact } from '../contract';
import type {
  DeliveryArtifacts,
  DeliveryTarget,
  ProductByKind,
  ProductDeliveryStrategy,
} from './contract';

const compileVfxArtifacts = (
  target: DeliveryTarget,
  product: ProductByKind['vfx'],
): DeliveryArtifacts => {
  if (target.format !== 'glb') throw new BuildFailure('export.format', target.name);
  const files: Artifact[] = [
    { path: `${target.name}.glb`, bytes: product.glb },
    { path: `${target.name}.vfx.json`, bytes: encodeUtf8(json(product.spec)) },
    { path: `${target.name}.flipbook.json`, bytes: encodeUtf8(json(product.vfx.flipbookManifest)) },
  ];
  if (product.particles.length === 1) {
    files.push({
      path: `${target.name}.particle.json`,
      bytes: encodeUtf8(json(product.particles[0]!)),
    });
  } else {
    product.particles.forEach((particle, idx) => {
      files.push({
        path: `${target.name}.${idx}.particle.json`,
        bytes: encodeUtf8(json(particle)),
      });
    });
  }
  return { files };
};

export const vfxDeliveryStrategy: ProductDeliveryStrategy<ProductByKind['vfx']> = {
  kind: 'vfx',
  assertGate: () => undefined,
  compileArtifacts: compileVfxArtifacts,
  buildMetadata: (product) => ({
    durationSeconds: product.vfx.durationSeconds,
    fps: product.vfx.fps,
    drawCalls: product.vfx.stats.drawCalls,
    triangles: product.vfx.stats.triangles,
    particleCount: product.vfx.stats.particleCount,
  }),
};
