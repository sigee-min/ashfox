import type { FindingSink } from '../contract';

interface MinecraftResourceLocation {
  namespace: string;
  path: string;
}

export const RESOURCE_NAMESPACE_PATTERN = /^[a-z0-9_.-]+$/;
export const RESOURCE_PATH_PATTERN = /^[a-z0-9_./-]+$/;

export const validateResourceLocation = (
  location: MinecraftResourceLocation,
  path: string,
  add: FindingSink,
): void => {
  if (!RESOURCE_NAMESPACE_PATTERN.test(location.namespace)) {
    add({
      code: 'format.invalid_namespace',
      severity: 'error',
      message: `Minecraft namespace "${location.namespace}" is invalid.`,
      path: `${path}.namespace`,
      fix: 'Use lowercase letters, digits, underscore, dot, or hyphen.',
    });
  }
  if (
    !RESOURCE_PATH_PATTERN.test(location.path) ||
    location.path.startsWith('/') ||
    location.path.endsWith('/') ||
    location.path.includes('..')
  ) {
    add({
      code: 'format.invalid_resource_path',
      severity: 'error',
      message: `Minecraft resource path "${location.path}" is invalid.`,
      path: `${path}.path`,
      fix: 'Use a relative lowercase resource path without an extension or parent traversal.',
    });
  }
};
