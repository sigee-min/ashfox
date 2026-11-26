# 구조물(Structure) 문법

구조물은 `.ashfox` 원본으로 Minecraft 건축물과 가구가 배치된 실내를 함께 정의합니다.
하나의 `structure` 원본으로 Minecraft Java Edition 구조물 템플릿(`.nbt`, `/place template`용)과 Unity 같은 오픈 월드 엔진용 GLB 메시(`1 block = 1.0m`, `exterior`/`interior`/`custom` 계층 포함)를 모두 생성합니다.

## 단위와 헤더

공용 `ashfox-model 1` 헤더 아래 진입점 `structure` 또는 재사용 `module`을 선언합니다.

| 단위 | 역할 | 허용 선언 |
| --- | --- | --- |
| `structure id { … }` | 빌드 가능한 건축물 진입점 | `import`, `size`, `data_version`, `palette`, `prefab`, `build` |
| `module id { … }` | 공용 프리팹·가구 라이브러리 | `import`, `palette`, `export prefab`, `prefab` |

- `size = (width, height, depth);`: 정수 격자 크기(`1..64`, 전체 부피 `<= 65536`). 생략 시 배치된 블록 경계에서 추론합니다.
- `data_version = 3955;`: `.nbt`에 기록할 Minecraft Java DataVersion입니다(기본값 `3955`, Minecraft 1.21).
- 좌표 `(x, y, z)`는 `0`부터 시작하는 복셀 격자이며 `+y`가 위쪽, `-z`가 북쪽(`forward = north`)입니다.

## 팔레트와 커스텀 모델 결합

`palette { … }` 안에서 Minecraft 블록 상태와 로컬 `.ashfox` 커스텀 소품을 매핑합니다.

```text
palette {
  wall = "minecraft:stone_bricks";
  door = "minecraft:spruce_door[facing=north,half=lower,hinge=left,open=false]";
  lantern = asset custom_lantern as "minecraft:lantern[hanging=false]";
}
```

- 모든 블록 상태는 `namespace:block_id[key=value,...]` 형식을 따라야 하며, 주요 건축·가구 블록(`stairs`, `slab`, `fence`, `wall`, `glass_pane`, `door`, `trapdoor`, `lantern`, `bed`, `chest`, `barrel`, `furnace`, `bookshelf`, `carpet`, `flower_pot`, `ladder`)은 전용 3D 형상과 16×16 아틀라스로 렌더링됩니다.
- `asset alias as "fallback"`은 GLB·`render` 미리보기에서는 import한 커스텀 `.ashfox` 모델을 배치하고 `.nbt`에서는 지정한 Minecraft 블록 상태(`facing` 자동 반영)로 기록합니다.

## 프리팹과 건축 연산

`prefab Name { … }`(모듈에서는 `export prefab Name { … }`)와 `build { … }` 블록에서 선언적으로 건축합니다.

| 연산 | 동작 |
| --- | --- |
| `set at = (x, y, z) block = key [facing = north\|south\|east\|west];` | 단일 블록 또는 커스텀 모델 배치 |
| `box from = … to = … block = key;` | 축 정렬 직육면체 채우기 |
| `hollow from = … to = … block = key;` | 바깥 6면만 채우고 내부는 유지 |
| `walls from = … to = … block = key;` | 수직 4면 외벽만 생성 |
| `frame from = … to = … block = key;` | 12개 외곽 기둥·보 뼈대 생성 |
| `carve from = … to = …;` | 영역을 `minecraft:air`로 비우기 |
| `roof style = gable\|hip\|pyramid axis = x\|z from = … to = … stair = k ridge = r [gable = g];` | 계단 방향·용마루·박공 벽 자동 생성 |
| `layer y = n origin = (x, z) { "…" } map { C = k; };` | Y 층별 ASCII 평면도 배치(`'.'`는 건너뜀) |
| `repeat axis = x\|y\|z count = n step = s { … }` | 축을 따라 일정 간격으로 반복 배치 |
| `mirror axis = x\|z center = n { … }` | `axis = n` 기준 좌우·전후 대칭(상태 방향 반전 포함) |
| `place Name [\| Alias.Name] at = (x, y, z) rotate …;` (`0\|90\|180\|270`) | 회전이 반영된 프리팹 인스턴스 배치 |

## 완전한 독립 실행 예제

{{source-code:1}}

## 검사, 단면 렌더링 및 내보내기

```sh
npx --no-install ashfox check examples/structure/medieval_cottage.ashfox --json
npx --no-install ashfox render --cutaway 4 examples/structure/medieval_cottage.ashfox --output cottage_inside.png
npx --no-install ashfox export --format java_structure examples/structure/medieval_cottage.ashfox --output cottage.nbt
npx --no-install ashfox export --format glb examples/structure/medieval_cottage.ashfox --output cottage.glb
```

단독 `ashfox build`는 `.nbt`(`java_structure`)를 생성하며, 워크스페이스 설정에서는 `java_structure`와 `glb`를 동시에 출력할 수 있습니다. 모든 구조물은 5개 하드 게이트(`visible_geometry`, `ground_contact`, `no_disconnected_floating_parts`, `enclosed_interior`, `valid_minecraft_ids`)와 100점 만점 감사(`>= 75` 통과, `>= 85` 우수)를 만족해야 하며, 미사용 팔레트 키·import·비공개 프리팹은 컴파일 단계에서 차단됩니다.
