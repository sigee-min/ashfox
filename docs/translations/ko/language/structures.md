# 구조물(Structure) 문법

구조물은 `.ashfox` 원본으로 매개변수형 건축물, 가구가 배치된 실내, 다중 건물 복합 단지를 정의합니다.
하나의 `structure` 또는 `compound` 원본으로 Minecraft Java Edition 구조물 템플릿(`.nbt`, `/place template`용), `COLOR_0` 복셀 AO·라이트맵과 커스텀 `.ashfox` 소품 인스턴싱이 베이크된 `1 block = 1.0m` GLB 메시, 그리고 게임 엔진과 `game_assets` 팩에서 소비하는 `.structure.json`(`PlayableStructureMeta`) 런타임 메타데이터를 함께 생성합니다.

## 단위와 헤더

공용 `ashfox 1` 헤더 아래 진입점 `structure`, 복합 단지 `compound`, 또는 재사용 `module`을 선언합니다.

| 단위 | 역할 | 허용 선언 |
| --- | --- | --- |
| `structure id { … }` | 빌드 가능한 건축물 진입점 | `import`, `density`, `seed`, `size`, `data_version`, `params`, `outputs`, `preview`, `palette`, `prefab`, `floor`, `staircase`, `roof`, `furnish`, `weathering`, `socket`, 복셀 연산 |
| `compound id { … }` | 다중 건물 배치 진입점 | `structure`와 동일하며 하위 `structure` 진입점을 import해 `compound_place`로 배치 |
| `module id { … }` | 공용 프리팹·가구 라이브러리 | `import`, `palette`, `export prefab`, `prefab` |

- `density = 1 | 2;`: 절차적 멀티타일 텍스처 해상도(`1`이면 `16px`, `2`이면 `32px`, 기본값 `2`).
- `seed = 101;`: `mix(...)` 팔레트, 풍화, 표면 입자에 쓰이는 결정론적 PRNG 시드.
- `size = (9b, 13b, 9b);`: 정수 복셀 크기(`1b..96b`, 전체 부피 `<= 131072`).
- `data_version = 3955;`: `.nbt`에 기록할 Minecraft Java DataVersion입니다(기본값 `3955`, Minecraft 1.21).
- `params { w = 13; half = floor(w / 2); }`: 스칼라 식과 `(x, z)` / `(x, y, z)` 좌표에서 쓰는 매개변수와 수학 함수(`floor`, `ceil`, `round`, `min`, `max`, `abs`, `clamp`).
- 좌표 `(x, y, z)`는 `0`부터 시작하는 복셀 격자이며 `+y`가 위쪽, `-z`가 북쪽(`forward = north`)입니다.

## 팔레트, 재질 믹스, 커스텀 모델 결합

`palette { … }` 안에서 Minecraft 블록 상태, 가중치 기반 `mix(...)` 팔레트, 커스텀 `.ashfox` 소품을 선언합니다.

{{source-code:0}}

- 모든 블록 상태는 `namespace:block_id[key=value,...]` 형식을 따릅니다. 솔버가 모서리 계단(`inner_left|inner_right|outer_left|outer_right`)과 울타리·담장·유리판 연결(`north|east|south|west`)을 자동 계산하며 `socket` 커넥터를 `.nbt` `minecraft:jigsaw` 블록 엔티티로 기록합니다.
- `mix("block" * weight, ...)`는 복셀마다 결정론적 시드 기반 표면 변주를 선택합니다(소수 비율 또는 `%` 지원).
- `asset(alias, "fallback")`은 GLB·`render` 미리보기에서는 import한 커스텀 `.ashfox` 모델(`model Name { … }`)을 인스턴싱 배치하고 `.nbt`에서는 지정한 Minecraft 폴백 상태로 기록합니다.

## 시맨틱 레이아웃과 건축 연산

`prefab Name { … }`(모듈에서는 `export prefab Name { … }`)와 `structure` / `compound` 최상위에서 `{ key = value; }` 블록으로 건축을 구성합니다.

| 연산 | 동작 |
| --- | --- |
| `floor name { y = 0b; height = 4b; [jetty = 1b;] … }` | 한 층(`height >= 3b`) 단위로 방과 파사드 범위 지정 및 선택적 목재 `jetty` 돌출(`0b..2b`) |
| `room id { from = (x, z); size = (w, d); kind = …; floor = k; wall = k; … }` | 시맨틱 방 선언(`living\|workshop\|bedroom\|tavern\|tower\|hallway\|courtyard`) |
| `facade <targets> { door { … } window { … } arch { … } bay_window { … } arcade { … } }` | 문(`porch { … }` 포함), 덧창 창문, `bay_window`, `arcade`, 아치 배치 |
| `staircase { in_room = r; style = straight\|l_turn\|u_turn\|spiral; at = (x, z); … }` | 최소 머리 공간(`>= 2b`)과 상층 바닥 개구부를 갖춘 계단 생성 |
| `roof { on = r; style = gable\|hip\|pyramid\|spire; axis = x\|z; … }` | 처마·트림·도머·굴뚝이 포함된 경사 지붕 및 `spire` 첨탑 생성 |
| `furnish room { place_anchor { … } hang { … } }` | 모서리·벽·중앙 기준 가구 프리팹 앵커 배치 및 천장 조명 매달기 |
| `weathering { ground_moss { … } corner_quoin { … } chimney_soot { … } }` | 시드 기반 바닥 이끼·모서리 굄돌·굴뚝 그을음 풍화 적용 |
| `socket id { kind = …; room = r; wall = …; normal = …; }` | `.structure.json`과 `.nbt` 지그소 엔티티용 월드 연결 소켓 정의 |
| `compound_place alias { at = (x, y, z); rotate = 0\|90\|180\|270; }` | `compound` 단위 안에 import한 하위 `structure` 배치 |
| `set`, `box`, `hollow`, `walls`, `frame`, `carve`, `layer`, `repeat`, `mirror`, `place` | 저수준 복셀, ASCII 평면도(`layer { at = …; rows = […]; map { … } }`), 반복·대칭, 프리팹 배치 |

## 완전한 표준 예제

{{source-code:1}}

## 검사, 미리보기 시트 및 빌드

```sh
npx --no-install ashfox check examples/structure/.ashfoxworkspace --json
npx --no-install ashfox render --view cutaway examples/structure/assets/structures/medieval_cottage.ashfox --output cottage_cutaway.png
npx --no-install ashfox build examples/structure/.ashfoxworkspace --json
```

단독 `ashfox build`는 선언된 `outputs = [...];`(또는 `outputs { ... }`)를 따르며 기본값으로 같은 `.ashfox` 원본에서 `.nbt`(`java_structure`)와 `1 block = 1.0m` `.glb`, 그리고 `.structure.json`(`PlayableStructureMeta` 충돌체·시맨틱 구역·조명·소켓·상호작용 요소)을 함께 생성합니다. GLB 빌드는 은면·트림 스트립 컬링, 서브복셀 아틀라스 배칭, 반복 커스텀 소품 GPU 인스턴싱(`EXT_mesh_gpu_instancing`), 3단계 시맨틱 LOD(`_LOD0`, 삼각형 `<= 25%` 단순 외피 `_LOD1`, 단일 드로우 정점 컬러 원거리 헐 `_LOD2` 및 `MSFT_lod`/`extras.ashfox.lod`)를 적용하며 구조물은 `<= 18` 드로우 콜 / `<= 18,000` 삼각형 / `<= 350 KB`(`compound`는 `<= 28` / `<= 45,000` / `<= 1.1 MB`) 예산 내에서 출력됩니다. 모든 구조물은 6개 하드 게이트(`visible_geometry`, `ground_contact`, `structural_continuity`, `playable_circulation`, `weatherproof_enclosure`, `valid_minecraft_ids`)와 4개 축 100점 감사(`architecture`, `facade`, `interior`, `craft`, `>= 75` 통과, `>= 85` 우수)를 만족해야 합니다. `preview exterior { sheet = exterior; }`, `preview cutaway { sheet = cutaway; }`, `preview interior { sheet = interior; }`를 선언해 외관 입면·층별 수평 단면·실내 눈높이 시점을 점검할 수 있으며, 미사용 팔레트 키·import·비공개 프리팹은 컴파일 단계에서 차단됩니다.
