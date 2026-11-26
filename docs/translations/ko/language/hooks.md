# 훅과 스키마

Ashfox 에셋은 `model`, `structure`, `sprite`, `sound` 단위 전반에 걸쳐 도메인 중립적인 훅(`schema`, `anchor`, `volume`, `cue`, `meta`, `zone`, `mc_block`)으로 게임플레이 의미론을 공유합니다.

## 설계 규칙

- **모듈화된 스키마 정의**: 재사용 가능한 `schema` 블록은 `module` 파일(`assets/module/*.ashfox`)에 작성하고 `export schema`로 내보냅니다. 엔트리 파일(`model`, `structure`, `sprite`, `sound`)은 인라인 스키마를 정의하지 않고 모듈 스키마를 `import`하여 인스턴스만 부착합니다.
- **암묵적 결합 배제**: 스키마 문법은 `ashfox 1` 언어 자체에 정의되며 특정 게임명이나 에셋명에 종속되지 않습니다.
- **내장 `std.*` 스키마**: `std.entry`, `std.road`, `std.wall_join`, `std.courtyard`, `std.sit`, `std.door_hinge`, `std.hitbox`, `std.sfx`는 별도 `import` 없이 바로 사용할 수 있습니다.

## 모듈에서 스키마 선언하기

```text
ashfox 1
module gameplay_rules {
  export schema LootSpawn : anchor {
    field tier : enum(common, rare, epic) = common;
    field chance : float(0..1) = 0.65;
    field table : string;
    field prefab? : asset;
    mc_block = "minecraft:chest[facing=${facing}]";
  }

  export schema StormShelter : volume {
    field shield_ratio : float(0..1) = 1.0;
  }

  export schema MeleeHitbox : cue {
    field arc_deg : deg(10..360) = 110deg;
    field damage : number = 20;
  }

  export schema AiHearing : meta {
    field radius : float(0..120);
  }
}
```

### 지원되는 필드 타입

- 기본 타입: `string`, `bool`, `number`, `int`, `int(min..max)`, `float`, `float(min..max)`, `asset`
- 단위 숫자: `unit` / `u`, `block` / `b`, `pixel` / `px`, `deg` (`deg(min..max)`), `second` / `s` / `ms`
- 벡터: `vec2`, `vec3`
- 열거형: `enum(value_a, value_b, ...)` (사용 시 따옴표 없는 식별자 사용)
- 선택 필드: 필드 이름 뒤에 `?` 추가 (예: `field prefab? : asset;`)

## 에셋의 훅 선언

- **`anchor <id> : <schema> { ... }`**: 3D(`u`, `b`) 또는 2D 스프라이트(`px`) 좌표계의 점 마커입니다. 선택적으로 `bone = <id>;`, `room = <id>;`, `floor = <id>;` 부모 연결과 `at = (...);`, `facing = north|south|east|west|up|down;`를 지정합니다.
- **`volume <id> : <schema> { ... }`**: `from`/`to` 또는 `from`/`size` 기반 공간 영역으로, 선택적 `bone`/`room`/`floor` 부모 및 `enclosure = enclosed|semi_open|open;`를 지원합니다.
- **`cue <id> : <schema> { ... }`**: `clip = <name>;`과 `at = <time>` 또는 `at = <from>..<to>`로 지정하는 타임라인 마커/구간입니다.
- **`meta <id> : <schema> { ... }`**: `target = <asset|sound>;` 또는 전역 속성에 바인딩되는 타입화된 메타데이터입니다.
- **`zone <id> [: std.courtyard] { ... }`**: `enclosure = enclosed|semi_open|open;`을 가지는 구조물 동선/공간 구역입니다.
- **`mc_block <anchor_id> = "<blockstate>";`**: Minecraft `.nbt` 변환 시 특정 구조물 앵커에 대해 스키마의 `mc_block` 템플릿을 재정의합니다.

## 독립 실행 가능한 구조물 훅 예제

{{source-code:0}}

## 출력 및 엔진 바인딩

- **사이드카 JSON**: 훅이 선언된 에셋을 빌드하면 출력 옆에 `<target>.hooks.json`이 생성됩니다.
- **glTF**: 3D 모델과 구조물은 추가 드로우 콜 없이 `anchor_<id>` 빈 노드(`bone` 지정 시 해당 본 노드의 자식)를 추가하며, 정규화된 훅 페이로드를 `extras.ashfox.hooks`에 기록합니다.
- **타입 코드 생성**: `--bindings ts|cs|gd` (예: `ashfox build --bindings ts,cs,gd`)를 전달하면 `<build>/bindings/` 아래에 TypeScript(`.d.ts`), Unity C#(`.cs`), Godot GDScript(`.gd`) 바인딩이 생성됩니다.
