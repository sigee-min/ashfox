export type NativeModuleOptions = {
  message?: string;
  detail?: string;
  optional?: boolean;
};

type NativeModuleLoader = (name: string, options?: NativeModuleOptions) => unknown;

declare const requireNativeModule: NativeModuleLoader | undefined;

export const loadNativeModule = <T>(name: string, options?: NativeModuleOptions): T | null => {
  if (typeof requireNativeModule !== 'function') return null;
  try {
    const mod = requireNativeModule(name, options);
    return mod ? (mod as T) : null;
  } catch (_err) {
    return null;
  }
};
