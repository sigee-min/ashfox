export interface ViewOptions {
  readonly format?: 'glb'|'gltf'|'java_block'|'geckolib5'|'bedrock'|'png'|'wav';
  readonly namespace?: string; readonly modelPath?: string;
  readonly width: number; readonly height: number;
  readonly camera: 'perspective' | 'native' | 'front' | 'back' | 'left' | 'right' | 'top' | 'bottom';
  readonly azimuth?: number; readonly elevation?: number; readonly zoom: number;
  readonly environment: 'studio' | 'day' | 'evening' | 'night';
  readonly background: 'environment' | 'transparent' | 'checker' | 'light' | 'dark';
  readonly clip?: string; readonly time: number; readonly fps: number; readonly duration?: number;
  readonly wireframe: boolean; readonly skeleton: boolean; readonly textures: boolean;
  readonly scale: number; readonly stage: 'final' | 'silhouette' | 'shade' | 'grain';
  readonly variant?: string; readonly node?: string; readonly texture?: string;
  readonly mode: 'motion' | 'turntable' | 'build';
}
export const DEFAULT_VIEW: ViewOptions = {
  width: 640, height: 360, camera: 'perspective', zoom: 1, environment: 'studio', background: 'environment',
  time: 0, fps: 10, wireframe: false, skeleton: false, textures: true, scale: 1, stage: 'final', mode: 'motion'
};
