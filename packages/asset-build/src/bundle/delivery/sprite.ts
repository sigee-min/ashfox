import { evaluateSpriteQuality, formatSpriteGateFailure } from '@ashfox/engine-core';
import { encodeUtf8 } from '@ashfox/internal-contracts';
import { json } from '../../shared/digest';
import { BuildFailure, type Artifact } from '../contract';
import { appendHooksArtifact, type ProductByKind, type ProductDeliveryStrategy } from './contract';

export const spriteDeliveryStrategy: ProductDeliveryStrategy<ProductByKind['sprite']> = {
  kind: 'sprite',
  assertGate: (targetName, product) => {
    const audit = evaluateSpriteQuality(product.sprite);
    if (!audit.passed) {
      throw new BuildFailure('quality.gate', formatSpriteGateFailure(targetName, audit), 3);
    }
  },
  compileArtifacts: (target, product) => {
    const files: Artifact[] = [{ path: `${target.name}.png`, bytes: product.sprite.png }];
    if (product.sprite.nineSlice) {
      files.push({
        path: `${target.name}.sprite.json`,
        bytes: encodeUtf8(json({ nineSlice: product.sprite.nineSlice })),
      });
    }
    return { files: appendHooksArtifact(files, target.name, product.hooks) };
  },
  buildMetadata: (product) => ({
    width: product.sprite.receipt.width,
    height: product.sprite.receipt.height,
  }),
};
