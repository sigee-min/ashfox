# 모델 텍스처 스펙

모델 표면은 아틀라스·차트를 정의하는 계약과 재질·픽셀로 구현하는 구체 표면의 두 선언입니다. 독립적인 [스프라이트 문법](sprites.md)과는 다릅니다.

## 계약과 구현

| 범위 | 선언 | 요구사항 |
| --- | --- | --- |
| `surface contract Skin` | `atlas { width = …; height = …; }` | 명시적 texel 크기 |
| 계약 | `chart name box { width = …; height = …; coverage = …; }` | 큐브 UV 전개도, 평면은 `flat` |
| 계약 | `material = opaque;` | `opaque`, `cutout`, `double` |
| 계약 | `slot name: type;` | 닫힌 타입의 선택적 이름 있는 값 요구 |
| `surface red: Skin` | `material = opaque;` | 계약 재질 구현 |
| 표면 | `slot name = expression;` | 선언 slot에 호환값 제공 |
| 표면 | `texture atlas { … }` | 명시적인 텍스처 레시피 하나 |

[완전한 모델 표면](model.md#complete-source)에서 시작하세요. 너비·높이·원점에 [design 값](values.md)을 사용할 수 있습니다. 바인딩 시 차트 이름·크기·coverage·재질을 검사하며 철자가 같다고 다른 계약이 같아지지는 않습니다.

## 텍스처 레시피 필드

| 문장 | 의미 |
| --- | --- |
| `atlas = (16px, 8px);` | 계약과 일치하는 텍스처 크기 |
| `background = shade;` | 차트 밖 팔레트 역할 |
| `background-alpha = 255;` | 정수 alpha `[0,255]` |
| `palette { shade = #21100c; coat = (#7d2417, #c94f2a, #ef8141); }` | 단색 또는 3색 램프 |
| `chart body box { origin = (0px, 0px); fill = coat; }` | 명시적 아틀라스 배치·팔레트 역할 |
| `grain clustered { seed = 23; }` | 정확히 하나의 결정적 grain 선언 |
| `tone voxel;` | 선택적인 복셀 명암 |
| `stamp eye { pixels = "ee/e."; e = shade; }` | 재사용 픽셀 기호 |

형상은 `surface = skin.body;`로 required surface 포트와 chart를 참조합니다. 큐브·평면마다 정확히 하나가 필요합니다. 차트 UV는 아틀라스 안에 있고 형상과 일치해야 합니다. 모델 단위당 texel 하나일 때 `(w,h,d)` 박스의 전개도 크기는 `(2*w + 2*d, h + d)`입니다. 위치를 추측하거나 큐브와 별개로 차트 크기를 바꾸지 마세요. 자동 차트 패킹은 없습니다.

`opaque` coverage는 불투명 픽셀, `binary`는 투명·불투명, `optional`은 필수 커버리지를 완화합니다. 재질과 함께 선택하세요. `cutout`·`double`은 명시적 재질이며 임의 분수 alpha 혼합의 별칭이 아닙니다.

## 면·패턴·커버리지

box 면은 `north`, `south`, `east`, `west`, `up`, `down`입니다. 스탬프 좌표는 아틀라스가 아닌 면 왼쪽 위에서 시작하며 차트를 옮겨도 면 로컬 좌표는 유지됩니다.

chart·face에는 `paint`, `scale`, `density`, `phase`를 모두 가진 `pattern blotch`를 넣을 수 있습니다.

| 속성 | 타입과 범위 |
| --- | --- |
| `paint` | 팔레트 역할 |
| `scale` | 각 1–128 정수 texel 셋, 예: `(2px, 2px, 2px)` |
| `density` | 0–1 `ratio` |
| `phase` | 정수 0–4294967295 |

패턴은 스탬프 배치 앞에 오고 형상이 아닌 팔레트 픽셀을 제어합니다. 대응 계약과 완전한 레시피는 [기존 크리처 표면](../../examples/shared-creatures/creatures/surface.ashfox)을 참고하세요.

레시피 `coverage = …;`는 flat chart에만 속하며 face·box에는 쓸 수 없습니다. 따옴표 없는 이진 숫자가 행 순서로 정확히 `width * height`비트여야 합니다. binary 계약에는 이 마스크가 필요하며 opaque에는 0비트가 있을 수 없습니다. 계약의 `opaque|binary|optional` 열거형과 다른 픽셀 마스크입니다.

## 스탬프

레시피에서 한 번 정의하고 box의 face 안이나 flat chart에 직접 배치합니다. `pixels`는 `/`로 나눈 같은 너비 행의 문자열입니다. `.`은 투명, 소문자·숫자는 팔레트 매핑입니다. 쓰인 기호마다 정확히 한 매핑이 필요하고 사용하지 않는 매핑은 거부합니다.

같은 레시피 안의 조각입니다.

{{source-code:0}}

| 배치 속성 | 값과 의미 |
| --- | --- |
| `at` | anchor·offset 대신 명시적인 `vec2<texel>` |
| `anchor` | `top_left`, `top`, `top_right`, `left`, `center`, `right`, `bottom_left`, `bottom`, `bottom_right` |
| `offset` | anchor 사용 시 필수, 부호 있는 texel, 오른쪽·아래가 양수 |
| `flip` | 기본 `none`, `x`, `y`, `xy`, 사각형 안 내용 반사 |
| `protect` | 선택적인 음이 아닌 정수 texel 여백, 이후 tone·grain으로부터 보호 |

배치는 스탬프를 확대하지 않습니다. 전체 스탬프·보호 사각형이 면 안에 있어야 합니다. 반 texel에 걸친 중앙 배치는 반올림하지 않고 실패합니다. flip은 내용만 바꾸며 이후 명시적 스탬프는 보호 픽셀에도 덧칠할 수 있습니다. 크기 변경·반대 면 예제는 [픽셀 앵커](../guides/precision-modeling.md#fixed-size-marks-and-protected-detail)를 참고하세요.
