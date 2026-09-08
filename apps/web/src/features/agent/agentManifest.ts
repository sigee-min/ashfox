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
    'Begin every source with ashfox-model 1 and exactly one module or asset block. Use the linked language reference for declaration and binding syntax.',
    'Share exact dimensions through design fields. Imports require explicit paths, aliases, and exported declarations; rig, socket, and surface bindings are nominal.',
    'Skeleton binds require parent-origin in the parent joint frame; roots use the model frame. The ambiguous bind property origin is rejected. Place physical hinges using parent-frame offsets and verify grip contact, planted feet, and rotation direction across the entire motion.',
    'Skeletons implement rig contracts; components own geometry; surfaces own charts and pixels; motions target rig joints with rotation or scale tracks. Assets bind these declarations explicitly.',
    'Current asset density is 16, or one texel per model unit. Calculated texel positions must be integral. Use the precision reference for design expressions and fixed-size anchored stamps.',
    'Stamp anchors position the rectangle; flip = none|x|y|xy reflects its contents in face-local pixel axes without moving it. Use explicit reflection for paired asymmetric marks; anchors alone do not mirror pixels.',
    'Delivery requires an authored loop named idle. Review every authored motion cycle.',
    'The compiler validates bindings, frames, graph closure, bounds, UV, and budgets. Resolve diagnostics in source; it does not infer missing assembly or repair visual defects.',
    'Saved workspace locks must match the current compiler fingerprint. The edit API regenerates local locks; it does not migrate incompatible saved files.'
  ] as const)
});

const minecraftStyle = Object.freeze({
  reference: 'https://blockbench.net/wiki/guides/minecraft-style-guide/',
  authoringSequence: Object.freeze([
    'Preserve the established silhouette, palette, pixel density, and focal marks unless the user requests a change.',
    'Use economical volume geometry for silhouette, attachment, depth, and occlusion; use a plane only when zero thickness is intentional.',
    'Give each surface a named atlas chart, adjacent color ramp, deterministic seeded grain, deliberate macro marks, and nearest sampling. Texture detail must support rather than replace readable geometry.',
    'Review perspective, native gameplay, front, left, right, top, nearest-neighbor detail, and every authored motion cycle before delivery.'
  ] as const),
  reviewChecklist: Object.freeze([
    'Silhouette, proportions, joint hierarchy, socket contact, and function read without labels.',
    'Check for unintended gaps, intersections, z-fighting, and inconsistent pixel scale.',
    'Atlas charts are explicit, integer-aligned, within bounds, and use only their owning surface resources.',
    'Texture detail supports the requested style and keeps focal marks readable.',
    'Every selected export target passes preflight without silent geometry, texture, or motion loss.'
  ] as const)
});

export const agentManifest = {
  schemaVersion: 1,
  protocol: agentCommandProtocol.protocol,
  workbench: agentCommandProtocol.workbench,
  href: agentCommandProtocol.href,
  description:
    'Runtime contract for creating, refining, and reviewing assets in Ashfox Workbench.',
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
    transport: {
      inputSelector: `[${agentCommandProtocol.inputAttribute}]`,
      resultSelector: `meta[${agentCommandProtocol.resultAttribute}]`,
      resultAttribute: agentCommandProtocol.resultAttribute,
      contract:
        'When the browser tool cannot evaluate window.ashfox, use only these two transport nodes. Fill the current input element with one JSON envelope {requestId,method,payload}; the browser locator fill emits input and starts the request. Read the result meta\'s data-agent-command-port-result attribute as one JSON envelope {requestId,result}. Send one request at a time and accept only a response with the matching outer requestId.',
      envelope:
        'method is inspect, run, present, or capture. For inspect, present, and capture, payload is that method\'s request. For run, payload contains operations only; the outer requestId becomes the run requestId, so do not put requestId inside the run payload. The bridge removes and replaces the input after every fill; query the input selector again before the next call.',
      restriction:
        'The input and result selectors are a transport-only DOM exception. Do not read any other DOM, canvas, source, IndexedDB, or browser storage to recover state or author an asset.',
      example: `async function callAgent(browser, method, payload, timeoutMs = 600000) {
  const requestId = 'agent-' + crypto.randomUUID();
  const inputSelector = '[data-agent-command-port-input]';
  const input = browser.locator(inputSelector).first();
  await input.fill(JSON.stringify({ requestId, method, payload }));
  const resultSelector = 'meta[data-agent-command-port-result]';
  const resultAttribute = 'data-agent-command-port-result';
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const serialized = await browser.locator(resultSelector).getAttribute(resultAttribute);
    if (serialized) {
      const envelope = JSON.parse(serialized);
      if (envelope.requestId === requestId) return envelope.result;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('Timed out waiting for the matching Ashfox response.');
}

const overview = await callAgent(browser, 'inspect', undefined);
const result = await callAgent(browser, 'run', {
  operations: [{ name: 'workspace.apply', payload: { entry, changes } }]
});`
    },
    inspect: {
      current:
        'window.ashfox.inspect() returns a bounded revision, workspace hash, selected entry/build identity, counts, readiness, workflow guidance, and target metadata. It never returns source bytes. The overview data.workflow object reports stage, remainingVisualReviews, remainingVisualReviewCount, and visualReviewsTruncated; data.blocker and data.nextActions remain the actionable blocker and next-step guidance. Use the count and truncation flag rather than assuming the returned review-key list is complete.',
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
        'Preview with {kind:"workspace",candidate:{entry:{packageName,entryName},changes:{expectedWorkspaceHash,writes,deletes,manifest?}}}. A successful response envelope can contain data.valid=false: check it and diagnostics. Only valid candidates have a previewToken; show it with present({review:"preview",previewToken}). Candidate inspection changes neither the project nor the viewport. Tokens are bounded session resources tied to the exact base build; restage if a token is evicted or the base changes. Delivery presentation always restores the current canonical document.',
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
        'Use each returned frameNonce and review check IDs only for the frame actually observed. Never accept an unseen frame or cycle. Review the materialized selected entry. Left and right are separate required views relative to the asset forward direction; compare paired details and accept intentional asymmetry only when it fits the request. The retired side camera is rejected. Rejection requires a new atomic workspace revision.'
    },
    capture: {
      build:
        'After all revision-bound reviews are accepted, call `await window.ashfox.capture({kind:"build"})`. The Build replay starts from an empty scene, places every visible element in deterministic canonical element order, applies each element\'s complete owning texture set atomically, activates canonical authored idle motion when available, and holds on the complete model.'
    }
  },
  authoring: {
    authority:
      'Edit workspace source through workspace.apply. The engine builds the selected entry and maintains the lock. Save .ashfoxworkspace for future editing; generated models are read-only.',
    language,
    minecraftStyle,
    rules: [
      'Use the existing request and make routine design choices from context. Ask only when missing information materially changes the result. Use the smallest source organization that fits the task.',
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
    { stage: 'capture', instruction: 'When delivering a finished asset, produce Build replay after every required review is accepted.' },
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
