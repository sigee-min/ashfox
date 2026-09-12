# 스프라이트 문법 레퍼런스

네이티브 스프라이트는 투명 16×16 PNG 하나를 만듭니다. `minecraft-item-v1`은 래스터 규칙을 고정하며 PNG는 어떤 게임에서도 사용할 수 있습니다. 미리보기·출력 명령은 [스프라이트 제작](../guides/sprites.md)을 참고하세요.

## 루트와 리터럴 문법

`ashfox-model 1` 다음에 `sprite name { … }`를 씁니다. 루트 필수 속성은 `profile`, `canvas`, `palette`이며 레이어는 원본 순서대로 이름 있는 선언입니다. 생성용 `id`, `op`, `format`, `layers` 속성을 직접 쓰지 마세요.

| 형태 | 예제 |
| --- | --- |
| 대입 | `canvas = (16px, 16px);` |
| 중첩 레코드 | `palette { edge = #392b59; }` |
| 목록 | `rows = ["ee", "e."];` |
| 빈 목록 | `patches = [];` |
| 참조 | `mask = shared.apple_body;` |

숫자는 음이 아닌 정수입니다. `at`, `canvas`, `axis`와 그 벡터에만 `px`를 허용하고 다른 숫자는 무단위입니다. 산술식·모델 design·함수 호출은 없습니다. 문자열은 공용 모델 lexer를 따르며 이름 필드에는 따옴표 있는·없는 열거값과 참조를 받습니다. `"clustered-v1"`, `"warm-v1"`처럼 하이픈이 있으면 따옴표로 감싸세요. `tx`, 소수, 음수 위치는 리터럴이 아닙니다.

스프라이트 ID·레이어 ID·팔레트 이름은 `[a-z][a-z0-9_]{0,47}`입니다. 팔레트는 최대 RGB 32색입니다. rows는 높이 1–16, 너비 1–16의 직사각형이며 색 행은 ASCII 문자와 `.`, 마스크·erase는 `1`과 `.`을 씁니다. 모든 색 문자에는 매핑이 필요합니다.

## 레이어 레코드

빈 `patches`를 포함해 아래 필드는 모두 필수이고 레이어 ID는 고유합니다. 좌표 `[x,y]`는 캔버스 왼쪽 위 기준이며 전체 레이어가 안에 들어와야 합니다.

| 레이어 | 필드 | 의미 |
| --- | --- | --- |
| `paint name` | `at`, `rows`, `colors` | 팔레트 문자 칠하기. `.`은 아래 픽셀 유지 |
| `erase name` | `at`, `rows` | `1`은 지우고 `.`은 유지 |
| `stamp name` | `stamp`, `at`, `flip`, `colors` | 재사용 스탬프. flip은 `none`, `x`, `y`, `xy` |
| `part name` | `mask`, `material`, `at`, `shade`, `grain`, `patches` | 재사용 점유 형상에 명암 후 의도한 패치 |

뒤 레이어가 앞을 덮을 수 있습니다. 점만 있는 행은 지우기가 아닙니다. 현재 프로필은 스프라이트당 최대 64레이어이며 워크스페이스의 제한 없는 export 개수와 별개입니다.

## 재사용 선언

sprite 또는 가져온 sprite module 안에 둡니다. 재사용 선언에는 export가 필요합니다. `import "./shared.ashfox" as shared;` 후 `shared.name`으로 참조합니다. 상대 경로를 명시하며 패키지 이름 import는 지원하지 않습니다. 설정된 워크스페이스에는 모듈을 등록합니다.

| 선언 | 정확한 필드 |
| --- | --- |
| `export mask name` | `rows`: `1`·`.`의 비어 있지 않은 형상 |
| `export material name` | `ramp`: 아래 두 레코드 중 하나 |
| `export stamp name` | `rows`, `slots`: 사용한 점 아닌 문자를 중복 없이 정확히 나열 |

명시적 램프는 `mode = explicit; colors = [#shadow, #base, #light];`에 실제 여섯 자리 색을 씁니다. 휘도는 감소하지 않아야 하고 양 끝 색은 달라야 합니다. 생성 램프는 `mode = generated; base = #rrggbb;`와 `preset = warm-v1;` 또는 `neutral-v1`입니다.

## Part 명암과 상세

| 레코드 | 필드와 값 |
| --- | --- |
| `shade` | form `flat|round|bevel`, light `top_left`, contrast 정수 0–2 |
| bevel의 `shade.axis` | 마스크 사각형 안의 서로 다른 로컬 픽셀 점 둘. bevel에만 필수 |
| `grain` | mode `clustered-v1`, amount 정수 0 또는 1, seed 정수 0–4294967295 |
| 패치 각각 | `id`, `at`, `rows`, `colors`, protect 정수 0–2 |

패치 좌표는 part 로컬이며 색 픽셀은 점유 마스크 칸 안에 있어야 합니다. part마다 최대 16패치입니다. 리터럴 레코드만 쓰며 모델 텍스처의 anchor 문법은 받지 않습니다.

## 완전한 재사용 스프라이트

`badge.ashfox`로 저장하세요. import 모듈은 필요 없습니다.

{{source-code:0}}

{{source-code:1}}

추가 마스크·재질·스탬프는 [공용 아이템 모듈](../../examples/items/src/shared.ashfox), 한 프로젝트에서 여러 개를 출력하려면 [워크스페이스 설정](../guides/workspace.md)을 참고하세요.
