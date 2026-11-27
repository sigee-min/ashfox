import { evaluateSpriteQuality, formatSpriteGateFailure } from '@ashfox/engine-core';
import { BuildFailure } from '../contract';
import { appendHooksArtifact, type ProductByKind, type ProductDeliveryStrategy } from './contract';

export const spriteDeliveryStrategy: ProductDeliveryStrategy<ProductByKind['sprite']> = {
  kind: 'sprite',
  assertGate: (targetName, product) => {
    const audit = evaluateSpriteQuality(product.sprite);
    if (!audit.passed) {
      throw new BuildFailure('quality.gate', formatSpriteGateFailure(targetName, audit), 3);
    }
  },
  compileArtifacts: (target, product) => ({
    files: appendHooksArtifact(
      [{ path: `${target.name}.png`, bytes: product.sprite.png }],
      target.name,
      product.hooks,
    ),
  }),
  buildMetadata: (product) => ({
    width: product.sprite.receipt.width,
    height: product.sprite.receipt.height,
  }),
};
