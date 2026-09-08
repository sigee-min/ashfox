import type { AuthoredAssetWorkspace } from '../../../src/project/workspace';
import { workspaceFixture } from '../../project/workspace/fixtures';

const frame = 'frame { x = (1, 0, 0); y = (0, 1, 0); z = (0, 0, 1); }';

export const VALID_ASSET_SOURCE = `ashfox-model 1
asset wolf {
  export rig contract CreatureRig {
    handedness = right;
    ${frame}
    joint root {
      parent = none;
      role = root;
      ${frame}
      channels = (rotation, scale);
      mirror = none;
    }
  }
  export skeleton Wolf implements CreatureRig {
    bind root { parent-origin = (0u, 0u, 0u); ${frame} }
  }
  export surface contract Fur {
    atlas { width = 16px; height = 8px; }
    chart body box { width = 16px; height = 8px; coverage = opaque; }
    material = opaque;
  }
  export surface red_fur: Fur {
    material = opaque;
    texture atlas {
      atlas = (16px, 8px);
      background = shadow;
      background-alpha = 255;
      palette { shadow = #4a170f; body = (#4a170f, #a83a1f, #e06b32); }
      chart body box { origin = (0px, 0px); fill = body; }
      grain clustered { seed = 23; }
      tone voxel;
    }
  }
  export component Body {
    requires rig skeleton: CreatureRig;
    requires surface skin: Fur;
    bind bone root to skeleton.root;
    geometry {
      bone root {
        cube torso {
          origin = (-2u, 0u, -2u);
          size = (4u, 4u, 4u);
          surface = skin.body;
        }
      }
    }
  }
  export asset wolf {
    settings { density = 16; forward = north; }
    skeleton = Wolf;
    use Body as body { bind skeleton = CreatureRig; bind skin = red_fur; };
  }
}`;

export const validAssetWorkspace = (
  source = VALID_ASSET_SOURCE
): AuthoredAssetWorkspace => workspaceFixture([
  { path: 'wolf/main.ashfox', source }
], {
  root: 'wolf',
  packageName: 'wolf',
  entries: [{ name: 'wolf', path: 'main.ashfox' }]
});
