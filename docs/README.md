# Ashfox Docs

Ashfox persists one asset authority: a closed workspace of exact
`ashfox-model 1` source modules, package manifests, and a content-addressed
lock. Opening, changing, inspecting, capturing, and exporting rebuild
immutable entry products from that workspace. There is no editable generated
model.

## Start

1. Follow [Get started](guides/ai-agent-quick-start.md).
2. Describe the asset and its visible relationships in ordinary language.
3. Review native and enlarged viewport captures.
4. Export only after mechanical verification and independent visual review.

## Guides

- [Create and refine](guides/authoring-and-review.md)
- [Precision modeling](guides/precision-modeling.md)
- [Save and export](guides/save-and-export.md)
- [Choose an export format](guides/choose-a-format.md)
- [Troubleshooting](guides/troubleshooting.md)

## Architecture

- [Codebase map](architecture/codebase.md) defines authority and dependency
  direction.
- [Asset codebase](architecture/asset-codebase.md) defines packages, nominal
  reuse, compiler-private typed forms, entry builds, and deliberate exclusions.
- [Asset language](architecture/asset-language.md) defines modules, contracts,
  components, surfaces, motions, and explicit assembly.
- [Review and delivery](architecture/review.md) separates rendered judgment and
  target delivery from source authority.

These names identify one exact-current contract, not selectable runtime
pipelines or compatibility aliases. Only the current explicit source reader
is executable.

## Local data

The Workbench stores the closed workspace locally in the browser. Artifacts
leave it only when explicitly downloaded or exported.
