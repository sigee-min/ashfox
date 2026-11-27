import type { GlbPerformanceMetrics } from '@ashfox/engine-core';
import type { Artifact, AssetMetadata } from '../contract';
import {
  evaluateGlbBudget,
  type CompiledProduct,
  type DeliveryCompileContext,
  type DeliveryTarget,
  type ProductByKind,
  type ProductDeliveryStrategy,
  type ProductKind,
} from './contract';
import { modelDeliveryStrategy } from './model';
import { soundDeliveryStrategy } from './sound';
import { spriteDeliveryStrategy } from './sprite';
import { structureDeliveryStrategy } from './structure';
import { vfxDeliveryStrategy } from './vfx';

export type ProductDeliveryRegistry = {
  readonly [K in ProductKind]: ProductDeliveryStrategy<ProductByKind[K]>;
};

export const PRODUCT_DELIVERY_REGISTRY: ProductDeliveryRegistry = Object.freeze({
  model: modelDeliveryStrategy,
  sprite: spriteDeliveryStrategy,
  sound: soundDeliveryStrategy,
  structure: structureDeliveryStrategy,
  vfx: vfxDeliveryStrategy,
});

export interface DeliveredTargetResult {
  readonly files: readonly Artifact[];
  readonly lineageTemplate?: Record<string, unknown>;
  readonly performance?: GlbPerformanceMetrics;
}

const deliverWithStrategy = async <TProduct extends CompiledProduct>(
  strategy: ProductDeliveryStrategy<TProduct>,
  target: DeliveryTarget,
  product: TProduct,
  context: DeliveryCompileContext,
): Promise<DeliveredTargetResult> => {
  strategy.assertGate(target.name, product);
  const { files, lineageTemplate } = await strategy.compileArtifacts(target, product, context);
  const performance = evaluateGlbBudget(target, strategy.performanceKind?.(product), files);
  return {
    files,
    ...(lineageTemplate ? { lineageTemplate } : {}),
    ...(performance ? { performance } : {}),
  };
};

export const deliverProductTarget = (
  target: DeliveryTarget,
  product: CompiledProduct,
  context: DeliveryCompileContext,
): Promise<DeliveredTargetResult> => {
  switch (product.kind) {
    case 'model':
      return deliverWithStrategy(PRODUCT_DELIVERY_REGISTRY.model, target, product, context);
    case 'sprite':
      return deliverWithStrategy(PRODUCT_DELIVERY_REGISTRY.sprite, target, product, context);
    case 'sound':
      return deliverWithStrategy(PRODUCT_DELIVERY_REGISTRY.sound, target, product, context);
    case 'structure':
      return deliverWithStrategy(PRODUCT_DELIVERY_REGISTRY.structure, target, product, context);
    case 'vfx':
      return deliverWithStrategy(PRODUCT_DELIVERY_REGISTRY.vfx, target, product, context);
  }
};

export const buildProductMetadata = (
  product: CompiledProduct,
  performance?: GlbPerformanceMetrics,
): AssetMetadata => {
  switch (product.kind) {
    case 'model':
      return PRODUCT_DELIVERY_REGISTRY.model.buildMetadata(product, performance);
    case 'sprite':
      return PRODUCT_DELIVERY_REGISTRY.sprite.buildMetadata(product, performance);
    case 'sound':
      return PRODUCT_DELIVERY_REGISTRY.sound.buildMetadata(product, performance);
    case 'structure':
      return PRODUCT_DELIVERY_REGISTRY.structure.buildMetadata(product, performance);
    case 'vfx':
      return PRODUCT_DELIVERY_REGISTRY.vfx.buildMetadata(product, performance);
  }
};
