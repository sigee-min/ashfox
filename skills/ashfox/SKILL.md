---
name: ashfox
description: Create, refine, animate, and review voxel game assets as native .ashfox source with the Ashfox CLI. Use for model, texture, sound and game delivery work, not for changes to the Ashfox implementation.
---

# Ashfox

Author game assets as native `ashfox 1` `.ashfox` files under `assets/{models,sprites,vfx,sounds,structures,module}/` (outputs in `build/`). The installed CLI is the single offline authority—do not guess syntax or copy boilerplate; query `ashfox docs` and `ashfox library`.

## CLI Router

```sh
npx --no-install ashfox doctor --json                        # Check runtime, Chrome, OGG, and capabilities
npx --no-install ashfox docs                                  # List canonical topics
npx --no-install ashfox docs <topic>                          # agent|grammar|model|rig|surface|animation|vfx|sprite|sound|structure|hooks
npx --no-install ashfox library std list [prefix]             # Browse built-in "std/*" modules (core|model|sprite|vfx|sound|structure)
npx --no-install ashfox library std show <module>             # Inspect module exports & params; import via `import "std/..." as alias;`
npx --no-install ashfox library std eject <module> [--to dir] # Copy std module into assets/module/ to customize
npx --no-install ashfox check <input>                         # Validate, inspect IDs, and audit (0 Hard Gate failures, score >= 75, target >= 85)
npx --no-install ashfox render <source> --view <name> --output <file> # Render declared preview sheet/still/GIF
npx --no-install ashfox dev <input>                           # Live watch server + Three.js viewer + click-to-inspect
npx --no-install ashfox build <input> [--json] [--bindings ts|cs|gd]  # Build GLB/PNG/WAV/OGG/NBT/hooks/packs
```

## Rules

1. Run `ashfox doctor` first; if missing, follow `https://ashfox.io/docs/guides/install/`.
2. Before writing unfamiliar syntax, run `ashfox docs grammar` and `ashfox docs <topic>`.
3. Prefer `import "std/..."` over duplicating rigs, palettes, materials, VFX, sounds, interiors, or hook schemas.
4. Always run `ashfox check`, inspect `ashfox render` views (or `ashfox dev`) and built audio, and verify `ashfox build` outputs before reporting completion.
5. Run `scripts/sync.py` without `--install` to check skill updates; pass `--install` only when the user asks.
