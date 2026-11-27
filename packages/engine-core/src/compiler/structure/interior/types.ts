import type { Vec3 } from '../../../model/identity';
import type { CardinalFacing } from '../../../project/structure/contract';
import type {
  InteriorAuditReport,
  InteriorRadiosityConfig,
  InteriorRadiosityField,
  InteriorRoomInput,
  InteriorSubVoxelIR,
  InteriorSunShaftQuad,
  MountSurface,
  PlayableInteriorMeta,
  SubVoxelBoxIR,
  VanillaNbtLoweringIR,
} from './contract';

export interface TranslucentWindowPane {
  readonly id: string;
  readonly opening_id: string;
  readonly double_sided: true;
  readonly alpha: number;
  readonly color: string;
  readonly box: SubVoxelBoxIR;
}

export interface CustomPropMount {
  readonly id: string;
  readonly asset_alias: string;
  readonly at_16: Vec3;
  readonly mount_on: MountSurface;
  readonly facing: CardinalFacing;
  readonly rotation_y_deg: number;
  readonly zone_id?: string;
}

export interface CompiledInteriorRoom {
  readonly room_id: string;
  readonly input: InteriorRoomInput;
  readonly ir: InteriorSubVoxelIR;
  readonly radiosity: InteriorRadiosityField;
  readonly radiosity_config?: Partial<InteriorRadiosityConfig>;
  readonly sun_shafts: readonly InteriorSunShaftQuad[];
  readonly window_panes: readonly TranslucentWindowPane[];
  readonly nbt_lowering: VanillaNbtLoweringIR;
  readonly playable_meta: PlayableInteriorMeta;
  readonly audit: InteriorAuditReport;
  readonly custom_mounts: readonly CustomPropMount[];
}
