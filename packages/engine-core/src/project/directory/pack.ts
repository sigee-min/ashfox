/** Delivery declarations reference named exports, never generated disk paths. */
export interface JavaResourcePack {
  readonly name: string;
  readonly format: 'minecraft_java';
  readonly directory: string;
  /** Informational project version; format fields below control emitted bytes. */
  readonly minecraftVersion: string;
  readonly metadata: Readonly<{ description: string }> & (
    Readonly<{ format: 'legacy'; packFormat: number }> |
    Readonly<{ format: 'range'; minFormat: readonly [number, number]; maxFormat: readonly [number, number] }>
  );
  readonly itemDefinitions: 'legacy' | 'modern';
  readonly archive: boolean;
  readonly icon: string | null;
  readonly models: readonly string[];
  readonly items: readonly Readonly<{ source: string; id: string; parent: 'generated' | 'handheld' }>[];
  readonly sounds: readonly Readonly<{
    source: string; id: string; replace: boolean; subtitle: string | null;
    volume: number; pitch: number; stream: boolean;
    variants: 'all' | readonly Readonly<{ id: string; weight: number }>[];
  }>[];
}

/** Engine-neutral files and runtime catalog. Import settings are explicit hints. */
export interface GameAssetPack {
  readonly name: string;
  readonly format: 'game_assets';
  readonly directory: string;
  readonly archive: boolean;
  readonly audio: 'wav' | 'ogg';
  readonly unitsPerMeter: number;
  readonly pixelsPerUnit: number;
  readonly spriteFilter: 'nearest' | 'linear';
  readonly assets: readonly Readonly<{ id: string; source: string; path: string }>[];
}
export type DirectoryPack = JavaResourcePack | GameAssetPack;
