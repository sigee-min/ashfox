import type { HookSchemaDecl, HooksDocument } from '../contract';
import { CS_BINDING_STRATEGY } from './cs';
import { GD_BINDING_STRATEGY } from './gd';
import {
  sortedSchemas,
  type BindingTargetStrategy,
  type GeneratedBindingFile,
  type HookBindingOptions,
  type HookBindingTarget,
} from './shared';
import { TS_BINDING_STRATEGY } from './ts';

export type { GeneratedBindingFile, HookBindingOptions, HookBindingTarget } from './shared';

const BINDING_EMITTERS: Readonly<Record<HookBindingTarget, BindingTargetStrategy>> = Object.freeze({
  ts: TS_BINDING_STRATEGY,
  cs: CS_BINDING_STRATEGY,
  gd: GD_BINDING_STRATEGY,
});

export const generateHookBindings = (
  schemas: readonly HookSchemaDecl[],
  target: HookBindingTarget,
  options?: HookBindingOptions,
): GeneratedBindingFile => {
  const ordered = sortedSchemas(schemas);
  const strategy = BINDING_EMITTERS[target];
  return Object.freeze({
    target,
    extension: strategy.extension,
    fileName: strategy.fileName,
    content: strategy.emit(ordered, options),
    schemas: Object.freeze(ordered.map((schema) => schema.id)),
  });
};

export const generateBindingsFromDocument = (
  document: HooksDocument,
  target: HookBindingTarget,
  options?: HookBindingOptions,
): GeneratedBindingFile => generateHookBindings(document.schemas, target, options);

export const generateAllHookBindings = (
  schemas: readonly HookSchemaDecl[],
  options?: HookBindingOptions,
): Readonly<Record<HookBindingTarget, GeneratedBindingFile>> =>
  Object.freeze({
    ts: generateHookBindings(schemas, 'ts', options),
    cs: generateHookBindings(schemas, 'cs', options),
    gd: generateHookBindings(schemas, 'gd', options),
  });
