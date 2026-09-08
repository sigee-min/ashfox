import type * as THREE from 'three';
import type { ProjectAssets } from '../application/projectAssets';

export interface ProjectSceneOptions {
  assets: ProjectAssets;
  showSkeleton: boolean;
  showTextures?: boolean;
  showWireframe: boolean;
  untexturedColor?: string;
}

export interface ProjectSceneProjection {
  /** Exact source document projected into this scene; internal ownership guard. */
  readonly documentReference: object;
  root: THREE.Group;
  objectsByNodeId: Map<string, THREE.Group>;
  selectable: THREE.Object3D[];
  readiness: {
    status: 'pending' | 'ready' | 'failed';
    error: string | null;
  };
  ready: Promise<void>;
  dispose: () => void;
}
