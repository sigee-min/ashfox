import {
  exportCompatibilityOptions,
  listAgentCommandDefinitions
} from '@ashfox/engine-core';

import { canonicalFingerprint } from '../../application/canonicalFingerprint';
import { agentCommandProtocol } from './agentCommandProtocol';

const commands = listAgentCommandDefinitions().map((definition) => ({
  name: definition.name,
  purpose: definition.purpose,
  schemaHash: canonicalFingerprint(definition.inputSchema)
}));

const language = Object.freeze({
  header: 'ashfox-model 1' as const,
  fileKinds: Object.freeze(['module', 'asset'] as const),
  declarations: Object.freeze([
    'socket contract', 'rig contract', 'skeleton', 'surface contract',
    'surface', 'component', 'motion', 'asset', 'design'
  ] as const),
  rules: Object.freeze([
    'A portable .ashfoxworkspace file is the sole durable authority. It contains normalized .ashfox sources, package manifests, and one compiler lock.',
    'Every source begins with ashfox-model 1 and owns exactly one module or asset block.',
    'Design blocks own typed exact fields and named boolean checks. Reference local Design.field or imported alias.Design.field; dependency cycles, duplicate owners, failed checks, and dimensional mismatches fail closed.',
    'Design syntax: export design Dimensions { width: unit = 4u; size: vec3<unit> = (Dimensions.width, 4u, 4u); check positive = Dimensions.width > 0u; }. Vector fields support .x/.y/.z. Use a complete vec2<texel> design field for calculated chart origins.',
    'Share design dimensions explicitly across skeleton origins, component geometry, surface chart dimensions, atlas placement, and motion. Named unit vectors are construction datums, not additional rig joints or placement authorities.',
    'texels(length, pixelsPerUnit) requires a nonnegative unit length and positive integer density and rejects fractional texels. mirror_x/y/z(point, planeCoordinate) reflects only a unit point. box_origin(anchor, size, alignment) uses positive unit dimensions and explicit ratio components in [0,1].',
    'Imports are explicit path-and-alias bindings. Only explicitly exported declarations are available across files; design values do not replace nominal rig, socket, or surface contracts.',
    'A skeleton implements one rig contract exactly. A motion targets one rig contract. Components declare typed parameters plus required rig, socket, and surface contracts.',
    'An asset chooses one skeleton, explicit motions, component instances with named bindings, and explicit socket connections. There is no inheritance, structural duck typing, default binding, or name-based retargeting.',
    'Surface contracts own atlas size, named box or flat charts, coverage, material, and typed slots. Surface implementations explicitly bind those charts and texture recipes.',
    'Geometry uses lexical bones, cubes, planes, and locators. Cubes carry volume; planes are reserved for intentional zero-thickness features. Coplanar overlays and floating attachments are invalid.',
    'Motion tracks target exact rig joints and explicit rotation or scale channels. Delivery readiness requires one authored loop named idle.',
    'Stamp placement uses either at=(xpx,ypx), or anchor=top_left|top|top_right|left|center|right|bottom_left|bottom|bottom_right plus an explicit signed offset. Fixed pixel size is preserved; off-grid centers and overflow fail. Optional protect=Npx protects the stamp rectangle and margin from tone/grain without changing alpha coverage.',
    'The compiler rejects incomplete bindings, incompatible frames, orphan modules, import cycles, unsafe bounds, invalid UV, hidden data loss, and expansion over budget. It never invents geometry, charts, materials, or animation.',
    'Canonical ProjectDocument data is derived and read-only. Revise workspace source, then atomically recompile the whole workspace.'
  ] as const)
});

const minecraftStyle = Object.freeze({
  reference: 'https://blockbench.net/wiki/guides/minecraft-style-guide/',
  authoringSequence: Object.freeze([
    'Establish the nominal rig, sockets, reusable components, surfaces, motions, and asset entries before tuning detail.',
    'Use economical volume geometry for silhouette, attachment, depth, and occlusion; use a plane only when zero thickness is intentional.',
    'Give each surface a named atlas chart, adjacent color ramp, deterministic seeded grain, deliberate macro marks, and nearest sampling. Texture detail must support rather than replace readable geometry.',
    'Review perspective, native gameplay, front, side, top, nearest-neighbor detail, and every authored motion cycle before delivery.'
  ] as const),
  reviewChecklist: Object.freeze([
    'Silhouette, proportions, joint hierarchy, socket contact, and function read without labels.',
    'No floating parts, accidental intersections, coplanar overlays, z-fighting, mixels, or staircase curve approximations.',
    'Atlas charts are explicit, integer-aligned, within bounds, and use only their owning surface resources.',
    'Large flat color regions use connected within-ramp texel variation while focal marks and transparency remain protected.',
    'Every selected export target passes preflight without silent geometry, texture, or motion loss.'
  ] as const)
});

export const agentManifest = {
  protocol: agentCommandProtocol.protocol,
  workbench: agentCommandProtocol.workbench,
  href: agentCommandProtocol.href,
  description:
    'Machine guide for authoring a strongly typed multi-file Ashfox asset workspace, compiling one entry, and completing independent visual review.',
  setup: {
    manifest: 'Fetch this JSON directly and keep the controlled browser on the workbench.',
    ready:
      'Inspect the active workspace, then ask exactly: "What would you like to create?" Do not mutate it before the answer.'
  },
  pageApi: {
    global: 'ashfox',
    inspectMethod: 'inspect',
    runMethod: 'run',
    presentMethod: 'present',
    captureMethod: 'capture',
    inspect: {
      current:
        'window.ashfox.inspect() returns a bounded revision, workspace hash, selected entry/build identity, counts, readiness, blocker, next actions, and target metadata. It never returns source bytes.',
      command:
        'window.ashfox.inspect({kind:"command",name:"workspace.apply"}) returns the exact current write schema.',
      exportTarget:
        'window.ashfox.inspect({kind:"export-target",adapter:{target:"glb"|"gltf",modelPath:"..."}}) validates one current target without producing artifact bytes. Minecraft targets also require namespace.',
      workspace:
        'Read source only with {kind:"workspace",read:{expectedWorkspaceHash,path,offset,maxCodeUnits}} where maxCodeUnits <= 2048. Preview one staged change with {kind:"workspace",candidate:{entry:{packageName,entryName},changes}} and present its short-lived token using {review:"preview",previewToken}.',
      nodes:
        'Discover canonical node IDs with {kind:"nodes",expectedRevision,expectedWorkspaceHash,expectedBuildKey,offset:0,limit:32}. Results include id, name, kind, parentId, and visibility in stable ID order; follow nextOffset until null. Limits are 1..32. Use the same current-build guards for subsequent measurement and surface reads.',
      measurement:
        'Read rest-pose world bounds, dimensions, and signed ground gap with {kind:"measurement",expectedRevision,expectedWorkspaceHash,expectedBuildKey,nodeId,scope:"node"|"subtree",groundY,tolerance}. Evidence includes complete primitives, including hidden and alpha-cutout areas; it is not an exact visual silhouette or pairwise collision test.',
      surface:
        'Read face UV, rotation, texture dimensions, and sampling with {kind:"surface",expectedRevision,expectedWorkspaceHash,expectedBuildKey,nodeId}. All guards must match the current build. Never infer full-motion clearance from rest-pose measurements.',
      rule:
        'Canonical inspection is read-only evidence, never an authoring surface. Correct the owning workspace source and recompile.'
    },
    run: {
      call:
        'await window.ashfox.run({requestId:"stable-unique-id",operations:[{name:"workspace.apply",payload:{entry:{packageName,entryName},changes:{expectedWorkspaceHash,writes,deletes}}}]})',
      contract:
        'Submit exactly one operation. workspace.apply is the only asset write and atomically validates every entry before selecting the requested one.'
    },
    present: {
      call: 'await window.ashfox.present({review:"next"})',
      accept:
        'await window.ashfox.present({review:"accept",frameNonce:<frameNonce>,checkIds:[...reviewCheckIds]})',
      reject:
        'await window.ashfox.present({review:"reject",frameNonce:<frameNonce>,issues:[...],failedCheckIds:[...reviewCheckIds]})',
      contract:
        'Review only the materialized selected entry. Rejection requires a new atomic workspace revision.'
    },
    capture: {
      build:
        'After all revision-bound reviews are accepted, call `await window.ashfox.capture({kind:"build"})`. The Build replay starts from an empty scene, places every visible element in deterministic canonical element order, applies each element\'s complete owning texture set atomically, activates canonical authored idle motion when available, and holds on the complete model.'
    }
  },
  authoring: {
    authority:
      'The portable workspace and explicit selected entry are the only authoring authority. AssetProject build identity binds the exact workspace closure to the derived canonical document.',
    language,
    minecraftStyle,
    rules: [
      'Translate the request into a cohesive package of small nominal modules and explicit asset entries; do not ask the human to edit derived data.',
      'Reuse exported rig, socket, component, surface, and motion declarations across entries instead of copying model bodies.',
      'Keep all dependencies explicit and all component arguments and bindings named. Reject missing or extra bindings rather than guessing.',
      'Keep shape and attachment in geometry, material ownership and texel detail in surfaces, and temporal behavior in rig-bound motion.',
      'Preserve the established block silhouette, pixel density, palette ramps, focal stamps, and texture-led detail. Use design relations to reduce coordinate duplication; do not add geometry for paint marks or approximate smooth curves with staircase voxels.',
      'Measure the current product before changing source. Use named design checks for authored relations, inspect the rebuilt geometry and face UV after applying, and review native gameplay plus nearest-neighbor detail. Compiler success does not certify style.',
      'Preview the staged workspace before applying it, then use the current workspace hash for the single compare-and-swap write.',
      'Apply every Minecraft style review check at gameplay scale and nearest-neighbor detail scale.',
      'Inspect one requested export target before delivery. No target adapter may become a second source authority.'
    ]
  },
  workflow: [
    { stage: 'start', instruction: 'Inspect the selected entry and ask what the user wants.' },
    { stage: 'design', instruction: 'Plan shared contracts, reusable implementations, entry-specific assembly, surfaces, and motion.' },
    { stage: 'author', instruction: 'Write complete module and entry sources and validate one staged workspace candidate.' },
    { stage: 'apply', instruction: 'Apply one exact workspace change set with the current workspace hash.' },
    { stage: 'review', instruction: 'Review every required static camera and motion cycle.' },
    { stage: 'capture', instruction: 'After acceptance, produce the deterministic Build replay.' },
    { stage: 'deliver', instruction: 'Preflight the user-selected export target, then let the user export.' }
  ],
  recovery: {
    invalidInput: 'Correct the exact diagnostic span in its owning workspace file.',
    invalidState: 'Re-inspect the current hash and entry, then restage the complete change set.',
    visual: 'Translate the visible issue into an explicit geometry, surface, or motion source revision.'
  },
  compatibility: {
    options: exportCompatibilityOptions(),
    contract:
      'Export adaptation is delivery-only and never creates a second geometry, surface, rig, or motion authority.'
  },
  commands
} as const;
