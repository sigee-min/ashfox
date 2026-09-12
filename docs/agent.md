# Ashfox: start here, agent

You are helping a user create voxel game assets in their existing project.
Read this guide completely, then read the linked installation and workflow
guides before executing the setup. Fetch task-specific references yourself;
the user should not need to navigate documentation or install a skill first.
Respond in the user's language. No browser authoring session is needed.

## Understand the project

Read the project's own instructions and inspect its package manager, lockfile,
asset sources and build configuration. Preserve unrelated work and existing
conventions. Ashfox's contributor rules apply to developing Ashfox itself,
not to the user's asset project.

Check Node.js and the local CLI with `node --version`,
`npx --no-install ashfox --version` and `npx --no-install ashfox --help`.
Do not replace a working pinned installation just because a newer version exists.

## Install and verify

Read [installation](https://ashfox.io/docs/guides/install/) and
[agent workflow](https://ashfox.io/docs/guides/agent-workflow/) in full.
Node.js 20+ and npm are required. If the CLI is missing, install the published
stable package in the project using its existing package manager:

```sh
npm install --save-dev {{stableCli}}
npx --no-install ashfox --version
npx --no-install ashfox doctor
npx --no-install ashfox capabilities
```

This guide's stable release is {{stableVersion}}. The installed CLI's help and
capabilities describe what it actually supports; current documentation can
include unreleased features. Read the
[CLI reference](https://ashfox.io/docs/guides/cli/) and
[release notes](https://github.com/sigee-min/ashfox/releases) when they differ.
Do not invent flags or silently upgrade to unreleased code.
Preserve the package manifest and lockfile, and keep the CLI version pinned.
For projects using another language, Node is a build dependency, not a game
runtime requirement.

Set up missing prerequisites using the environment's supported installer when
authorized. Chrome/Chromium is needed for captures and replays; FFmpeg with
libvorbis is needed for OGG delivery. Install only the tools the task needs,
then rerun doctor. Respect the agent environment's permissions. If fetching,
installation or a required tool is blocked, report the specific missing access
and the smallest user action needed; do not claim setup or review succeeded.

## Read the references before authoring

Read [repository layout](https://ashfox.io/docs/guides/repository-layout/) and
[execution modes](https://ashfox.io/docs/guides/choose-a-format/), then read the
[DSL overview](https://ashfox.io/docs/language/reference/) and the complete
references relevant to the requested asset. Follow their linked examples.

| Task | Required reading |
| --- | --- |
| Models and reusable creatures | [Models](https://ashfox.io/docs/guides/models/), [values](https://ashfox.io/docs/language/values/), [syntax](https://ashfox.io/docs/language/syntax/), [components](https://ashfox.io/docs/language/components/), [textures](https://ashfox.io/docs/language/textures/) |
| Pixel items and sprites | [Sprite guide](https://ashfox.io/docs/guides/sprites/), [sprite DSL](https://ashfox.io/docs/language/sprites/) |
| Sound | [Sound guide](https://ashfox.io/docs/guides/sounds/), [sound DSL](https://ashfox.io/docs/language/sounds/) |
| Animation and visual review | [Animation](https://ashfox.io/docs/guides/animation/), [observation](https://ashfox.io/docs/guides/observe/), [authoring and review](https://ashfox.io/docs/guides/authoring-and-review/) |
| Configured builds and delivery | [Workspace](https://ashfox.io/docs/guides/workspace/), [game assets](https://ashfox.io/docs/guides/game-assets/), [automation](https://ashfox.io/docs/guides/automation/) |
| Minecraft integration | [Resource packs](https://ashfox.io/docs/guides/minecraft-packs/) |
| Repeated in-memory operations | [Stdio](https://ashfox.io/docs/guides/stdio/) |

When the task expands, read the newly relevant references before using unfamiliar
syntax. For diagnostics use [troubleshooting](https://ashfox.io/docs/guides/troubleshooting/).

## Create, review and deliver

Use grouped native `.ashfox` sources under `asset/` for new repositories.
Keep generated outputs under the root `build/`, ignored by Git. Follow an
existing project's conventions when present. Configure a supported workspace
only when needed; consult installed capabilities first. Do not overwrite an
existing configuration or run starter generation over existing assets.

After setup, continue the user's asset request. If none was provided, ask what
they want to make; do not manufacture an arbitrary asset or stop at a docs link.
Keep editable authority in `.ashfox` files and their imported modules. Inspect
identifiers, edit source, compile, and examine captures at useful angles and
native pixel size. Replay changed motions and listen to sound when the host
supports it. Compilation alone does not establish visual or audio quality.

Use `check`, `build`, and `verify` for configured delivery when supported.
Connect the consuming application through an adapter using deterministic output
paths or the generated runtime manifest. Never hand-edit generated artifacts.
Keep source, configuration and dependency locks ready for version control;
commit or publish only within the user's requested scope.

Return the outputs, what you actually inspected, and any receiving-game checks
still needed. Do not report a capture, listening review or game integration as
verified if you could not perform it.
