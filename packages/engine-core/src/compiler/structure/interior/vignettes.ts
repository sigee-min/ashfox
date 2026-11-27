import type { Vec3 } from '../../../model/identity';
import type {
  InteriorStoryKind,
  InteriorStorySpec,
  PlayableInteriorHook,
  StyleDna,
  SubVoxelBoxIR,
} from './contract';
import {
  box16,
  finalizeLocalBoxes,
  materialsForStyle,
  signedSeed,
  type LocalBoxDraft,
  type StyleMaterials,
} from './propsGeo';

const buildTavernMeal = (mat: StyleMaterials): readonly LocalBoxDraft[] => [
  box16('plate', 3, 0, 4, 10, 0.8, 11, mat.wood),
  box16('roast', 4.5, 0.8, 5.5, 8.5, 2.6, 9.5, 'terracotta'),
  box16('mug', 11, 0, 5, 13.5, 3.8, 7.5, mat.trim),
  box16('mug_handle', 13.5, 1, 5.8, 14.3, 3, 6.7, mat.metal),
  box16('candle', 4, 0, 12, 5.5, 3.5, 13.5, 'plaster_cream'),
  box16('flame', 4.3, 3.5, 12.3, 5.2, 5, 13.2, 'hearth_ember', 'emissive', '#ffb338'),
];

const buildTeaCeremony = (mat: StyleMaterials): readonly LocalBoxDraft[] => [
  box16('tray', 2, 0, 3, 14, 0.8, 13, mat.darkWood),
  box16('teapot', 6, 0.8, 6, 10, 4.4, 10, mat.metal),
  box16('spout', 10, 2, 7.5, 11.8, 3.5, 8.5, mat.metal),
  box16('cup_a', 3, 0.8, 4.5, 5, 2.5, 6.5, 'plaster_cream'),
  box16('cup_b', 3, 0.8, 9.5, 5, 2.5, 11.5, 'plaster_cream'),
  box16('whisk', 11.2, 0.8, 10, 13, 3.6, 11.8, 'birch_planks'),
];

const buildScholarStudy = (mat: StyleMaterials): readonly LocalBoxDraft[] => [
  box16('book_l', 3, 0, 5, 7, 1.2, 11, 'plaster_white'),
  box16('book_r', 7, 0, 5, 11, 1.2, 11, 'plaster_white'),
  box16('stack_1', 11.5, 0, 4, 15, 1.4, 8.5, mat.fabric),
  box16('stack_2', 11.8, 1.4, 4.3, 14.8, 2.8, 8.2, mat.darkWood),
  box16('inkwell', 3, 0, 12, 4.5, 1.8, 13.5, mat.metal),
  box16('lamp', 11.5, 0, 11, 14, 5.5, 13.5, mat.accent, 'emissive', mat.emissiveColor),
];

const buildModernWorkspace = (mat: StyleMaterials): readonly LocalBoxDraft[] => [
  box16('laptop_base', 4, 0, 6, 12, 0.6, 11, mat.metal),
  box16('laptop_screen', 4, 0.6, 10.6, 12, 5.6, 11.2, mat.accent, 'emissive', mat.emissiveColor),
  box16('pad', 5, 0, 3, 11, 0.4, 5.5, mat.darkWood),
  box16('mug', 12.5, 0, 4, 14.5, 2.8, 6, 'plaster_white'),
  box16('succulent', 2, 0, 9, 4, 2.2, 11, 'terracotta'),
  box16('leaf', 2.2, 2.2, 9.2, 3.8, 3.8, 10.8, 'leaves'),
];

const buildScifiDiagnostics = (mat: StyleMaterials): readonly LocalBoxDraft[] => [
  box16('pad', 3, 0, 4, 9, 0.8, 9, mat.metal),
  box16('pad_glow', 3.5, 0.8, 4.5, 8.5, 1.1, 8.5, mat.accent, 'emissive', mat.emissiveColor),
  box16('holo_ring', 9.5, 0, 6, 13.5, 1.2, 10, mat.metal),
  box16('holo_proj', 10, 1.2, 6.5, 13, 6, 9.5, mat.accent, 'translucent', mat.emissiveColor),
  box16('vial', 4, 0, 10.5, 6, 4.2, 12.5, mat.accent, 'emissive', mat.emissiveColor),
];

const buildHearthPrep = (mat: StyleMaterials): readonly LocalBoxDraft[] => [
  box16('board', 2, 0, 4, 9, 1.2, 11, mat.wood),
  box16('loaf', 4, 1.2, 6, 7.5, 3, 9, 'oak_planks'),
  box16('cauldron', 10, 0, 6, 14.5, 4.5, 10.5, mat.metal),
  box16('herbs', 3, 0, 12, 7, 2.2, 14, 'leaves'),
];

const buildAlchemyBrew = (mat: StyleMaterials): readonly LocalBoxDraft[] => [
  box16('stand', 3, 0, 5, 7, 5.5, 9, mat.metal),
  box16('flask', 3.5, 1.2, 5.5, 6.5, 4.8, 8.5, 'window_glow', 'translucent', '#82ff6b'),
  box16('core', 4.2, 1.6, 6.2, 5.8, 3.4, 7.8, 'window_glow', 'emissive', '#82ff6b'),
  box16('mortar', 9, 0, 5, 12, 2.5, 8, mat.stone),
  box16('scroll', 8, 0, 10, 13.5, 1.4, 12.5, 'plaster_cream'),
];

const STORY_BUILDERS: Readonly<
  Record<InteriorStoryKind, (mat: StyleMaterials) => readonly LocalBoxDraft[]>
> = {
  tavern_meal: buildTavernMeal,
  tea_ceremony: buildTeaCeremony,
  scholar_study: buildScholarStudy,
  modern_workspace: buildModernWorkspace,
  scifi_diagnostics: buildScifiDiagnostics,
  hearth_prep: buildHearthPrep,
  alchemy_brew: buildAlchemyBrew,
};

const HAS_EMISSIVE_STORY = new Set<InteriorStoryKind>([
  'tavern_meal',
  'scholar_study',
  'modern_workspace',
  'scifi_diagnostics',
  'alchemy_brew',
]);

export interface StoryCompileResult {
  readonly boxes: readonly SubVoxelBoxIR[];
  readonly hooks: readonly PlayableInteriorHook[];
}

/** Compiles a narrative story micro-vignette seated at exact 1/16 surface_y_16. */
export const compileStoryVignette = (
  spec: InteriorStorySpec,
  styleDna: StyleDna,
  roomSeed: number,
): StoryCompileResult => {
  const mat = materialsForStyle(styleDna.furn);
  const seed = spec.seed ?? roomSeed;
  const rotDeg = signedSeed(seed, `story:${spec.id}`) * 10 * styleDna.organic;
  const origin16: Vec3 = [spec.center_xz_16[0] - 8, spec.surface_y_16, spec.center_xz_16[1] - 8];
  const drafts = STORY_BUILDERS[spec.kind](mat);
  const boxes = finalizeLocalBoxes(spec.id, drafts, origin16, 16, 16, spec.facing, rotDeg).map(
    (b) => ({ ...b, semantic_tag: `story:${spec.kind}` }),
  );
  const worldPos: Vec3 = [
    spec.center_xz_16[0] / 16,
    spec.surface_y_16 / 16,
    spec.center_xz_16[1] / 16,
  ];
  const hooks: PlayableInteriorHook[] = [
    {
      kind: 'station',
      id: `${spec.id}:station`,
      position: worldPos,
      facing: spec.facing,
      station_kind: spec.kind,
    },
  ];
  if (HAS_EMISSIVE_STORY.has(spec.kind)) {
    hooks.push({
      kind: 'toggle_light',
      id: `${spec.id}:light`,
      position: worldPos,
      color: mat.emissiveColor,
      default_on: true,
      light_id: `${spec.id}:flame`,
    });
  }
  return { boxes, hooks };
};
