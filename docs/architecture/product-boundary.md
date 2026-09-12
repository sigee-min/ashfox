# Source and CLI product boundary

Ashfox has one asset production path: native source, CLI compilation and game
integration. This document explains that boundary; repository rules remain in the
[development manifest](../../development-manifest.json).

## Responsibilities

| Surface | Responsibility |
| --- | --- |
| Asset repository | Editable `.ashfox` files, imports and optional executable or JSON workspace configuration |
| Coding agent | Source edits, CLI execution and review of actual captures |
| CLI | Inspection, revision-guarded stdio sessions, capture, replay, validation and delivery |
| Game adapter | Read deterministic build paths and runtime manifests |
| Website | Product explanation, localized documentation and read-only examples |
| Shared renderer | Headless scene projection, animation sampling and PNG/GIF capture |

The public website owns no editable project, source mutation API, browser storage
contract or DOM command transport. Its model controls only change a preview's
viewpoint and playback. Game examples are consumers of generated artifacts.

The former browser authoring app, its runtime manifest and its documentation have
been removed. Old authoring URLs return 404; they do not forward to a replacement
editor or silently load the landing page. Public bundle tests verify that boundary.

The installable asset skill points to the user guides and installed CLI. It does
not connect to a page API. Skill distribution uses descriptor version 2, which
points to documentation and rejects the removed browser fields. Install the new
skill package to replace a version 1 browser skill; its old updater cannot accept
the new descriptor. Repository contributors use CONTRIBUTING.md instead.
Optional Blockbench compatibility remains separately owned and is not required
for source authoring, builds or game delivery.

## Evidence and automation

Showcase generation invokes CLI `inspect`, `capture` and `replay`, then encodes
movies with FFmpeg. It stages the complete media set before publishing and seals
source, renderer and artifact fingerprints. Build replay remains a reconstruction
of the finished model, not a record of source edits.

Some native example packages use the name `workbench`. Those names are source
identities, not web routes or browser APIs. They remain stable to preserve imports
and example build identities; removing a user interface does not rename assets.

## Agent onboarding

The first-screen hero copies a localized setup prompt without displaying its body.
Its button and status share a centered column; setup does not scroll to the footer.
It directs an existing coding agent to `/agent.md`; no skill installation is
required. `docs/agent.md` owns that entry guide. The site build fills its stable
package URL and version from the release authority, and publishes it as Markdown.
The guide routes agents to the public user references and installed CLI contract.
The optional skill shares this entry point. Human documentation remains accessible
from the header.
