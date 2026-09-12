const fallback = (title: string, file: string) =>
  `# ${title}\n\nGuide content is not bundled in this build. (guide=${file})`;

const modelingFallback = [
  '# Blockbench modeling compatibility',
  '',
  'Canonical Ashfox assets are native .ashfox source files; edit source and inspect, capture, build and export with the Ashfox CLI.',
  '',
  'This optional Blockbench reference is only for an explicitly requested live compatibility-session edit. add_bone, add_cube, add_mesh, and related mutations never become canonical Ashfox geometry or a second workspace authority.'
].join('\n');

export const GUIDE_FALLBACKS: Record<string, string> = {
  'modeling-workflow': modelingFallback,
  rigging: fallback('Rigging Guide (Animation-Ready)', 'rigging'),
  'animation-workflow': fallback('Animation Workflow (Low-level)', 'animation-workflow'),
  'texture-workflow': fallback('Texture Workflow (UV-first)', 'texture-workflow'),
  'uv-atlas': fallback('UV Atlas Guide', 'uv-atlas'),
  'texture-spec': fallback('Texture + UV Spec (Summary)', 'texture-spec'),
  'llm-texture-strategy': fallback('LLM Texture Strategy (Summary)', 'llm-texture-strategy'),
  'vision-fallback': fallback('Vision Fallback (Preview + Texture)', 'vision-fallback'),
  'entity-workflow': fallback('Entity Workflow (GeckoLib-first)', 'entity-workflow')
};
