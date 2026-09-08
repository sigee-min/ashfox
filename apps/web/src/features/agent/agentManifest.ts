import {
  exportCompatibilityOptions,
  listAgentCommandDefinitions
} from '@ashfox/engine-core';

import { canonicalFingerprint } from '../../application/canonicalFingerprint';
import { agentCommandProtocol } from './agentCommandProtocol';
import type { InspectRequest } from './types';

// Valid request shapes, not live project credentials or reusable node IDs.
const exampleGuards = {
  expectedRevision: 'revision:example',
  expectedWorkspaceHash: `sha256:${'0'.repeat(64)}`,
  expectedBuildKey: `sha256:${'0'.repeat(64)}`
} as const;

const commands = listAgentCommandDefinitions().map((definition) => ({
  name: definition.name,
  purpose: definition.purpose,
  schemaHash: canonicalFingerprint(definition.inputSchema)
}));

const language = Object.freeze({
  header: 'ashfox-model 1' as const,
  fileKinds: Object.freeze(['module', 'asset'] as const),
  declarations: Object.freeze([
    'design', 'socket contract', 'rig contract', 'skeleton',
    'surface contract', 'surface', 'component', 'motion', 'asset'
  ] as const),
  rules: Object.freeze([
    'Every source begins with ashfox-model 1 and owns exactly one module or asset block.',
    'Design blocks own typed exact fields and named boolean checks. Reference local Design.field or imported alias.Design.field; dependency cycles, duplicate owners, failed checks, and dimensional mismatches fail closed.',
    'Design syntax: export design Dimensions { width: unit = 4u; size: vec3<unit> = (Dimensions.width, 4u, 4u); check positive = Dimensions.width > 0u; }. Vector fields support .x/.y/.z. Use a complete vec2<texel> design field for calculated chart origins.',
    'Share design dimensions across skeleton origins, geometry, charts, and motion. Construction datums are values, not additional rig joints or placement authorities. Current asset density is exactly 16 (one texel per model unit); texels does not change that setting.',
    'texels(length, pixelsPerUnit) requires a nonnegative unit length and positive integer density and rejects fractional texels. mirror_x/y/z(point, planeCoordinate) reflects only a unit point. box_origin(anchor, size, alignment) uses positive unit dimensions and explicit ratio components in [0,1].',
    'Imports are explicit path-and-alias bindings. Only explicitly exported declarations are available across files; design values do not replace nominal rig, socket, or surface contracts.',
    'A skeleton implements one rig contract exactly. A motion targets one rig contract. Components declare typed parameters plus required rig, socket, and surface contracts.',
    'An asset chooses one skeleton, explicit motions, component instances with named bindings, and explicit socket connections. There is no inheritance, structural duck typing, default binding, or name-based retargeting.',
    'Surface contracts own atlas size, named box or flat charts, coverage, material, and typed slots. Surface implementations explicitly bind those charts and texture recipes.',
    'Geometry uses lexical bones, cubes, planes, and locators. Cubes carry volume; planes are reserved for intentional zero-thickness features. Coplanar overlays and floating attachments are invalid.',
    'Motion tracks target exact rig joints and explicit rotation or scale channels. Delivery readiness requires one authored loop named idle.',
    'Stamp placement uses either at=(xpx,ypx), or anchor=top_left|top|top_right|left|center|right|bottom_left|bottom|bottom_right plus an explicit signed offset. Fixed pixel size is preserved; off-grid centers and overflow fail. Optional protect=Npx protects the stamp rectangle and margin from tone/grain without changing alpha coverage.',
    'The compiler rejects incomplete bindings, incompatible frames, orphan modules, import cycles, unsafe bounds, invalid UV, hidden data loss, and expansion over budget. It never invents geometry, charts, materials, or animation.',
    'The header alone does not establish compatibility: workspace locks must use the current compiler fingerprint returned by inspect. Prior locks have no compatibility reader or implicit migration.'
  ] as const)
});

const minecraftStyle = Object.freeze({
  reference: 'https://blockbench.net/wiki/guides/minecraft-style-guide/',
  authoringSequence: Object.freeze([
    'Preserve the established silhouette, palette ramps, pixel density, and focal marks unless the user requests a change. Choose shared designs and nominal contracts before tuning detail.',
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
  schemaVersion: 2,
  protocol: agentCommandProtocol.protocol,
  workbench: agentCommandProtocol.workbench,
  href: agentCommandProtocol.href,
  description:
    'Machine guide for authoring a strongly typed multi-file Ashfox asset workspace, compiling one entry, and completing independent visual review.',
  setup: {
    manifest: 'Use https://ashfox.io/workbench/ and fetch https://ashfox.io/workbench/agent-manifest.json through direct HTTP. Keep the controlled browser on the app. Use a development URL only when the user explicitly selects it, with the manifest from that same Workbench.',
    ready:
      'Inspect the active workspace and use the request already provided. Ask what to create or change only when the task is missing. Read-only requests do not authorize workspace mutation.'
  },
  documentation: {
    rule: 'Resolve these paths against the connected Workbench origin and fetch via direct HTTP. Read the workflow before the first write, the language guide for unfamiliar declarations, and precision for linked dimensions or pixel marks. These are shipped from the same source revision as this manifest; do not substitute production docs for a development session.',
    resources: [
      { href: '/workbench/reference/guides/agent-workflow.md', purpose: 'Complete discovery, source read, preview, apply, and recovery workflow.' },
      { href: '/workbench/reference/architecture/asset-language.md', purpose: 'Current declaration syntax, ownership, imports, and bindings.' },
      { href: '/workbench/reference/guides/precision-modeling.md', purpose: 'Complete executable model with shared dimensions and fixed-pixel anchors.' }
    ]
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
      identity:
        'From a successful overview use data.revision as expectedRevision, data.workspaceHash as expectedWorkspaceHash, and data.build.buildKey as expectedBuildKey. Never combine guards from different observations or reuse them after a workspace change.',
      command:
        'window.ashfox.inspect({kind:"command",name:"workspace.apply"}) returns the exact current write schema.',
      finding:
        'Read a current finding with window.ashfox.inspect({kind:"finding",path:"<finding path>"}). Use the returned diagnostic location; canonical-phase failures may point to the entry root.',
      exportTarget:
        'window.ashfox.inspect({kind:"export-target",adapter:{target:"glb",modelPath:"model.glb"}}) preflights one target without producing artifact bytes. Choose a target named in compatibility.options; Minecraft targets also require namespace. Profile/version metadata is read-only, not request fields.',
      workspace:
        'Discover source with {kind:"workspace",catalog:{expectedWorkspaceHash,offset:0,limit:32}}. Read source with {kind:"workspace",read:{expectedWorkspaceHash,path,offset,maxCodeUnits}} or metadata with {kind:"workspace",document:{expectedWorkspaceHash,document:"manifest"|"lock",offset,maxCodeUnits}}. Use exactly one selector; maxCodeUnits is 1..2048. Follow pagination/chunks, never guess paths or read DOM/storage.',
      candidate:
        'Preview with {kind:"workspace",candidate:{entry:{packageName,entryName},changes:{expectedWorkspaceHash,writes,deletes,manifest?}}}. A successful response envelope can contain data.valid=false: check it and diagnostics. Only valid candidates have a previewToken; show it with present({review:"preview",previewToken}). Candidate inspection does not change the project.',
      nodes:
        'Discover canonical node IDs with {kind:"nodes",expectedRevision,expectedWorkspaceHash,expectedBuildKey,offset:0,limit:32}. Results include id, name, kind, parentId, and visibility in stable ID order; follow nextOffset until null. Limits are 1..32. Use the same current-build guards for subsequent measurement and surface reads.',
      measurement:
        'Read rest-pose model-space axis-aligned bounds, dimensions, and signed ground gap with {kind:"measurement",expectedRevision,expectedWorkspaceHash,expectedBuildKey,nodeId,scope:"node"|"subtree",groundY,tolerance}. groundY must be finite and tolerance finite and nonnegative. Evidence includes full hidden/alpha-cutout primitives, not visible silhouette, collision, or full-motion clearance.',
      surface:
        'Read face UV, rotation, pixel span, texture dimensions, sampling, and content identity with {kind:"surface",expectedRevision,expectedWorkspaceHash,expectedBuildKey,nodeId}. The node must be a cube or plane; inspection does not return source charts or a pixel dump.',
      rule:
        'Canonical inspection is read-only evidence, never an authoring surface. Correct the owning workspace source and recompile.',
      examples: {
        usage: 'Request shapes only: replace every example guard with the current overview identity and nodeId with an ID discovered from that build.',
        requests: [
          { kind: 'workspace', catalog: { expectedWorkspaceHash: exampleGuards.expectedWorkspaceHash, offset: 0, limit: 32 } },
          { kind: 'workspace', document: { expectedWorkspaceHash: exampleGuards.expectedWorkspaceHash, document: 'manifest', offset: 0, maxCodeUnits: 2048 } },
          { kind: 'nodes', ...exampleGuards, offset: 0, limit: 32 },
          { kind: 'measurement', ...exampleGuards, nodeId: 'node:example',
            scope: 'subtree', groundY: 0, tolerance: 0.001 },
          { kind: 'surface', ...exampleGuards, nodeId: 'node:example' }
        ] satisfies readonly InspectRequest[]
      }
    },
    run: {
      call:
        'await window.ashfox.run({requestId:"stable-unique-id",operations:[{name:"workspace.apply",payload:{entry:{packageName,entryName},changes:{expectedWorkspaceHash,writes,deletes}}}]})',
      contract:
        'Submit exactly one workspace.apply operation. Write source and optionally replace the full workspace manifest. The engine regenerates local lock hashes and dependency pins before atomically validating every entry. changes.lock is rejected, not ignored. CAS dependency bytes/pins are immutable; installing or replacing external packages is not an edit command.'
    },
    present: {
      call: 'await window.ashfox.present({review:"next"})',
      accept:
        'await window.ashfox.present({review:"accept",frameNonce:<frameNonce>,checkIds:[...reviewCheckIds]})',
      reject:
        'await window.ashfox.present({review:"reject",frameNonce:<frameNonce>,issues:[...],failedCheckIds:[...reviewCheckIds]})',
      contract:
        'Use each returned frameNonce and review check IDs only for the frame actually observed. Never accept an unseen frame or cycle. Review the materialized selected entry; rejection requires a new atomic workspace revision.'
    },
    capture: {
      build:
        'After all revision-bound reviews are accepted, call `await window.ashfox.capture({kind:"build"})`. The Build replay starts from an empty scene, places every visible element in deterministic canonical element order, applies each element\'s complete owning texture set atomically, activates canonical authored idle motion when available, and holds on the complete model.'
    }
  },
  authoring: {
    authority:
      'One portable .ashfoxworkspace is durable authority: normalized source files, package manifests, and an exact compiler lock. The selected entry chooses a product; AssetProject binds its build identity to the derived read-only ProjectDocument. This runtime manifest governs asset operation, not repository development policy.',
    language,
    minecraftStyle,
    rules: [
      'Use the smallest coherent source organization: one file for a small study, shared exported designs and nominal modules when reuse warrants it. Do not force every edit into a new package or ask the human to edit derived data.',
      'Keep shape and attachment in geometry, material ownership and texel detail in surfaces, and temporal behavior in rig-bound motion.',
      'Use exact design relations to reduce duplicated coordinates and fixed-size stamps for focal paint marks. Precision does not mean smooth CAD solids, automatic fitting, or extra geometry for painted detail.',
      'Compiler success and numeric checks do not certify style. Rendered review remains independent; do not accept evidence solely because a measurement passes.'
    ]
  },
  workflow: [
    { stage: 'start', instruction: 'Inspect the current workspace and requested scope. Use existing user intent; stop after evidence for a read-only task.' },
    { stage: 'design', instruction: 'For edits, discover affected nodes and inspect relevant geometry/UV evidence before choosing source owners. Plan exact shared values, contracts, surfaces, assembly, and motion only as needed.' },
    { stage: 'author', instruction: 'Read catalog, relevant sources, and the current manifest in bounded chunks. Prepare complete writes and optional manifest changes; do not author lock hashes. Validate data.valid, then visually inspect the staged preview before applying the same candidate.' },
    { stage: 'apply', instruction: 'Apply one exact workspace change set with the current workspace hash.' },
    { stage: 'verify', instruction: 'Refresh the current identity. Reinspect changed dimensions and face UV; failed observations belong to a new source revision, never a derived-data patch.' },
    { stage: 'review', instruction: 'Follow present({review:"next"}) through every required static camera and motion cycle; judge the rendered result against its returned checks.' },
    { stage: 'capture', instruction: 'After acceptance, produce the deterministic Build replay.' },
    { stage: 'deliver', instruction: 'Preflight the user-selected export target, then let the user export.' }
  ],
  recovery: {
    invalidInput: 'Correct the reported owning path/span; an entry-root span may identify a whole-product invariant. Remove retired changes.lock inputs. Persisted-file lock errors are not repaired by the edit API. Do not guess compatibility aliases or patch generated output.',
    invalidState: 'Refresh the overview and all dependent guards, reread affected source, and restage. Do not blindly resubmit a rejected or stale operation.',
    responseTooLarge: 'Reduce source maxCodeUnits or node limit as appropriate. Follow returned chunk/pagination boundaries; a bounded rejection is not an empty model.',
    visual: 'Translate the visible issue into its owning design, geometry, surface, or motion source revision.',
    unavailable: 'Report missing connection, information, or required user choice. Do not replace the live contract with remembered syntax or expand the task to bypass a blocker.'
  },
  compatibility: {
    options: exportCompatibilityOptions(),
    contract:
      'Export adaptation is delivery-only and never creates a second geometry, surface, rig, or motion authority.'
  },
  commands
} as const;
