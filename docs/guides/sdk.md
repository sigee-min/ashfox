# Runtime SDKs (`--sdk three|unity|godot`)

Ashfox can emit zero-dependency engine runtime wrappers alongside your compiled build outputs so your game can load models, LODs, `.hooks.json` anchors, physics colliders, additive VFX, gapless looping audio, and animation cues with one import.

## Generate SDK files

Pass `--sdk` to `ashfox build` (comma-separated or repeated):

```sh
npx --no-install ashfox build .ashfoxworkspace --sdk three --json
npx --no-install ashfox build .ashfoxworkspace --sdk three,unity,godot --json
```

Or declare `sdk` in `.ashfoxworkspace` (defaults to `[]`):

```json
{
  "sdk": ["three", "godot"]
}
```

Generated files are written deterministically to `<build.directory>/sdk/`:

| Target | Emitted files | Runtime focus |
| --- | --- | --- |
| `three` | `ashfox-three.ts` | `GLTFLoader` + `MeshoptDecoder`, `MSFT_lod` -> `THREE.LOD`, `KHR_materials_unlit` & `ashfoxBlendMode === "additive"` -> `THREE.AdditiveBlending`, `.hooks.json` anchors & colliders, frame-accurate `ashfoxCues` (`vfx` pooling, WebAudio 3D `PositionalAudio` w/ `loopStartSample`/`loopEndSample`, `onCue` world position) |
| `unity` | `AshfoxRuntime.cs`, `AshfoxAssetActor.cs` | `MonoBehaviour` manifest/hooks/VFX loader, `CapsuleCollider`/`BoxCollider` attachment, VFX object pool, `AudioSource` 3D playback, `AnimationEvent` cue bridge |
| `godot` | `ashfox_runtime.gd`, `ashfox_actor.gd` | Godot 4 `Node3D` wrapper with `AnimationPlayer`, `Marker3D` anchors, `CollisionShape3D`, `AudioStreamPlayer3D` (`LOOPSTART`/`LOOPLENGTH`), and `cue_triggered` signal |

## Three.js quickstart

```ts
import * as THREE from 'three';
import { createAshfoxRuntime } from './dist/build/sdk/ashfox-three';

const runtime = createAshfoxRuntime({
  scene,
  audioListener,
  manifestUrl: './dist/game/game-assets/assets.json',
});

const goblin = await runtime.spawn('creature.goblin_raider', { position: [4, 0, -2] });
goblin.onCue('melee_hitbox', (cue) => {
  applyDamageCone(cue.worldPosition, cue.data);
});
goblin.play('flame_cleave');

// Inside your frame loop:
runtime.update(dt);
```

- `actor.anchors` and `actor.getAnchor(id)` resolve `anchor_<id>` scene nodes or `.hooks.json` anchors.
- `actor.colliders` exposes the fitted `capsule` or `box` collider set from `.hooks.json` or `assets.json`.
- `actor.lod` exposes the `THREE.LOD` group when `MSFT_lod` tiers (`*_LOD0`, `*_LOD1`, `*_LOD2`) are present.

## Unity C# integration

```csharp
using Ashfox.Runtime;
using UnityEngine;

public class EncounterSpawner : MonoBehaviour
{
    public AshfoxRuntime runtime;
    public GameObject goblinPrefab;

    void Start()
    {
        runtime.LoadManifestFromStreamingAssets("assets.json");
        var actor = runtime.Spawn("creature.goblin_raider", goblinPrefab, new Vector3(4, 0, -2), Quaternion.identity);
        actor.OnCue += cue => Debug.Log($"Cue {cue.name} at {cue.worldPosition}");
        actor.Play("flame_cleave");
    }
}
```

## Godot 4 GDScript integration

```gdscript
extends Node3D

@onready var runtime := AshfoxRuntime.new()

func _ready() -> void:
	add_child(runtime)
	runtime.load_manifest("res://game-assets/assets.json")
	var goblin := runtime.spawn("creature.goblin_raider", preload("res://goblin.tscn"), Vector3(4, 0, -2))
	goblin.cue_triggered.connect(func(cue_name, world_pos, payload): print(cue_name, world_pos, payload))
	goblin.play("flame_cleave")
```
