# 런타임 SDK (`--sdk three|unity|godot`)

Ashfox는 컴파일된 빌드 산출물과 함께 외부 의존성이 없는 엔진별 런타임 래퍼 코드를 생성할 수 있습니다. 단 한 줄의 임포트로 모델, LOD, `.hooks.json` 앵커, 물리 콜라이더, 가산(Additive) VFX, 끊김 없는 루프 오디오, 애니메이션 큐를 게임에 연결할 수 있습니다.

## SDK 파일 생성

`ashfox build`에 `--sdk` 플래그를 전달합니다(쉼표 구분 또는 반복 지정 가능):

```sh
npx --no-install ashfox build .ashfoxworkspace --sdk three --json
npx --no-install ashfox build .ashfoxworkspace --sdk three,unity,godot --json
```

또는 `.ashfoxworkspace`에 `sdk` 배열을 선언할 수 있습니다(기본값 `[]`):

```json
{
  "sdk": ["three", "godot"]
}
```

생성된 파일은 `<build.directory>/sdk/` 아래에 결정론적으로 출력됩니다:

| 타겟 | 생성 파일 | 런타임 기능 |
| --- | --- | --- |
| `three` | `ashfox-three.ts` | `GLTFLoader` + `MeshoptDecoder`, `MSFT_lod` -> `THREE.LOD`, `KHR_materials_unlit` 및 `ashfoxBlendMode === "additive"` -> `THREE.AdditiveBlending`, `.hooks.json` 앵커/콜라이더, 프레임 정확도 `ashfoxCues` (`vfx` 풀링, `loopStartSample`/`loopEndSample` 기반 WebAudio 3D `PositionalAudio`, `onCue` 월드 좌표 전달) |
| `unity` | `AshfoxRuntime.cs`, `AshfoxAssetActor.cs` | `MonoBehaviour` 매니페스트/훅/VFX 로더, `CapsuleCollider`/`BoxCollider` 자동 부착, VFX 풀링, `AudioSource` 3D 재생, `AnimationEvent` 큐 브리지 |
| `godot` | `ashfox_runtime.gd`, `ashfox_actor.gd` | Godot 4 `Node3D` 래퍼, `AnimationPlayer`, `Marker3D` 앵커, `CollisionShape3D`, `AudioStreamPlayer3D` (`LOOPSTART`/`LOOPLENGTH`), `cue_triggered` 시그널 |

## Three.js 빠른 시작

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

// 프레임 루프에서 호출:
runtime.update(dt);
```

- `actor.anchors`와 `actor.getAnchor(id)`는 `anchor_<id>` 씬 노드 또는 `.hooks.json` 앵커를 반환합니다.
- `actor.colliders`는 `.hooks.json` 또는 `assets.json`의 `capsule` / `box` 콜라이더 세트를 노출합니다.
- `actor.lod`는 `MSFT_lod` 티어(`*_LOD0`, `*_LOD1`, `*_LOD2`)가 존재할 때 `THREE.LOD` 그룹을 노출합니다.

## Unity C# 연동

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

## Godot 4 GDScript 연동

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
