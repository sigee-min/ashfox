import { ToolError } from '../../types';
import {
  AssignTextureCommand,
  BoneCommand,
  CubeCommand,
  DeleteBoneCommand,
  DeleteCubeCommand,
  SetFaceUvCommand,
  TextureUsageQuery,
  TextureUsageResult,
  UpdateBoneCommand,
  UpdateCubeCommand
} from '../../ports/editor';
import { Logger } from '../../logging';
import { withAdapterError } from './adapterErrors';
import { buildTextureUsageResult } from './BlockbenchTextureUsage';
import { getCubeApi, getTextureApi } from './blockbenchAdapterUtils';
import { collectCubes } from './outlinerLookup';
import { BlockbenchBoneAdapter } from './geometry/BoneAdapter';
import { BlockbenchCubeAdapter } from './geometry/CubeAdapter';
import { BlockbenchTextureAssignAdapter } from './geometry/TextureAssignAdapter';
import { BlockbenchUvAdapter } from './geometry/UvAdapter';
import { ADAPTER_CUBE_TEXTURE_API_UNAVAILABLE } from '../../shared/messages';

export class BlockbenchGeometryAdapter {
  private readonly log: Logger;
  private readonly bones: BlockbenchBoneAdapter;
  private readonly cubes: BlockbenchCubeAdapter;
  private readonly textures: BlockbenchTextureAssignAdapter;
  private readonly uvs: BlockbenchUvAdapter;

  constructor(log: Logger) {
    this.log = log;
    this.bones = new BlockbenchBoneAdapter(log);
    this.cubes = new BlockbenchCubeAdapter(log);
    this.textures = new BlockbenchTextureAssignAdapter(log);
    this.uvs = new BlockbenchUvAdapter(log);
  }

  addBone(params: BoneCommand): ToolError | null {
    return this.bones.addBone(params);
  }

  updateBone(params: UpdateBoneCommand): ToolError | null {
    return this.bones.updateBone(params);
  }

  deleteBone(params: DeleteBoneCommand): ToolError | null {
    return this.bones.deleteBone(params);
  }

  addCube(params: CubeCommand): ToolError | null {
    return this.cubes.addCube(params);
  }

  updateCube(params: UpdateCubeCommand): ToolError | null {
    return this.cubes.updateCube(params);
  }

  deleteCube(params: DeleteCubeCommand): ToolError | null {
    return this.cubes.deleteCube(params);
  }

  assignTexture(params: AssignTextureCommand): ToolError | null {
    return this.textures.assignTexture(params);
  }

  setFaceUv(params: SetFaceUvCommand): ToolError | null {
    return this.uvs.setFaceUv(params);
  }

  getTextureUsage(params: TextureUsageQuery): { result?: TextureUsageResult; error?: ToolError } {
    return withAdapterError(
      this.log,
      'texture usage',
      'texture usage failed',
      () => {
        const cubeApi = getCubeApi();
        const textureApi = getTextureApi();
        if ('error' in cubeApi || 'error' in textureApi) {
          return { error: { code: 'not_implemented', message: ADAPTER_CUBE_TEXTURE_API_UNAVAILABLE } };
        }
        const { TextureCtor } = textureApi;
        const textures = Array.isArray(TextureCtor.all) ? TextureCtor.all : [];
        const cubes = collectCubes();
        return buildTextureUsageResult(params, { textures, cubes });
      },
      (error) => ({ error })
    );
  }
}


