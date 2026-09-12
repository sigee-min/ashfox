# Ashfox brand and positioning

For contributors maintaining Ashfox product messaging and presentation.


Research and implementation notes, 2026-09-09. This is a maintainer proposal,
not a second repository policy. The development manifest remains authoritative.

## Positioning

**Assets as Code. Built for voxel games.**

Ashfox is the open-source Assets as Code toolkit for voxel games. Define models,
textures and sounds in source, version them in Git, and build them with Ashfox.
Use “Assets as Code” on first mention; “AaC” is optional shorthand afterward.
Keep Ashfox as the product name. Voxel games are the initial audience; Minecraft
is a concrete delivery target alongside engine-neutral bundles.

Lead with the source workflow. Show its outputs immediately. Explain the CLI,
compiler and source workflow where they help a user act.
Describe AI as the authoring collaborator without promising a particular model's
output quality. Frontier examples mean technically advanced, inspectable assets,
not claims of frontier-model performance.

## What the research suggests

| Reference | Observed practice | Application to Ashfox |
| --- | --- | --- |
| [OpenTofu core workflow](https://opentofu.org/docs/intro/core-workflow/) | A short write/plan/apply loop expands to branches and review for teams. | Teach define/inspect/review/build before enumerating commands; inspect the merged build again. |
| [DVC getting started](https://doc.dvc.org/start) | Introduce versioning and pipeline tasks through concrete steps, with separate handling of data artifacts. | Make source ownership explicit and keep delivery artifacts outside the editable source path. Ashfox does not replace DVC or Git LFS. |
| [Pulumi continuous delivery](https://www.pulumi.com/docs/iac/operations/continuous-delivery/) | Connect infrastructure code to existing CI/CD workflows. | Offer an incremental path from local CLI commands to PR evidence and trusted delivery jobs. |
| [GitHub Actions secure use](https://docs.github.com/en/actions/reference/security/secure-use) | Treat workflow inputs and third-party execution as security boundaries. | Give PR validation minimal permissions and isolate publication credentials; do not execute untrusted PR code in a privileged context. |
| [OpenGitOps principles](https://opengitops.dev/) | GitOps includes automatic pulling and continuous reconciliation. | Use “Assets as Code”; do not imply that a CLI build provides a continuously reconciling deployment controller. |

These are design inferences from primary documentation, not evidence that another
project uses Ashfox or that its operating model transfers without adaptation.

## Presentation applied now

- README: category and domain, actual asset previews, stable installation and one
  PNG, the working loop, advanced examples, and receiving-game guides.
- Landing: the category beside a live Griffin, a four-step source workflow,
  native-size pixel examples, explicit sound playback, readable source excerpts,
  advanced creature examples, and delivery choices.
- Documentation: one public Assets as Code guide connecting source ownership,
  Git review, evidence, pinned builds and releases. Existing technical guides
  own detailed commands and contracts.
- Metadata: matching product title and description on the landing page. Existing
  social imagery is preserved; a dedicated sharing-image refresh is separate.

## Operate the product with evidence

1. Keep examples executable. Validate source closures and exported products in
   CI. Render showcase media through the actual renderer and retain provenance.
   Pair each advanced example with source, output and a clear description.
2. Ship complete slices. A release should include the behavior, a tested example,
   documentation and compatibility notes. Product versions follow release-please.
3. Keep stable onboarding runnable. Promote install links only after the public
   release and its artifacts are verified. Separate development-only commands
   from the capabilities of the pinned public release.
4. Give issues a reproducible shape. Request the source or smallest reproducer,
   CLI/toolchain versions, expected output and actual evidence. Route compiler,
   renderer and integration failures to their owning component.
5. Evaluate adoption through first-success reports: installation failures, time
   to first export in observed usability sessions, evidence attached to issues,
   and whether an example imports successfully. No telemetry is added here.

## Next product work, not current promises

Prioritize a reusable CI example that uploads previews and build receipts before
building a hosted service. Then evaluate PR-level before/after comparison and
artifact lineage in a game build. A PR bot, automatic merge-to-delivery pipeline,
semantic diff viewer and cross-platform byte-identical builds are not currently
claimed by the brand.

The advanced-example bar is inspectability: a working source graph, concrete
outputs and reviewable motion/texture evidence. Add new examples to demonstrate
a missing capability, not to inflate a gallery count.
