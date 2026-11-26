# 모델 텍스처 스펙

모델 표면은 차트(및 선택적 고정 아틀라스 크기)를 정의하는 계약과 재질·픽셀로 구현하는 구체 표면의 두 선언입니다. 독립적인 [스프라이트 문법](sprites.md)과는 다릅니다.

## 계약과 구현

| 범위 | 선언 | 요구사항 |
| --- | --- | --- |
| `surface contract Skin` | `atlas { width = …; height = …; }` | 선택; 생략 시 2의 거듭제곱 아틀라스로 자동 패킹 |
| 계약 | `chart name box { coverage = …; }` | `width`/`height` 선택; 생략 시 바인딩된 형상에서 추론 |
| 계약 | `material = opaque;` | `opaque`, `cutout`, `double` |
| 계약 | `slot name: type;` | 닫힌 타입의 선택적 이름 있는 값 요구 |
| `surface red: Skin` | `material = opaque;` | 계약 재질 구현 |
| 표면 | `slot name = expression;` | 선언 slot에 호환값 제공 |
| 표면 | `texture atlas { … }` | 명시적인 텍스처 레시피 하나 |

[완전한 모델 표면](model.md#complete-source)에서 시작하세요. 너비·높이·원점에 [design 값](values.md)을 사용할 수 있습니다. 바인딩 시 차트 이름·coverage·재질을 검사하며 철자가 같다고 다른 계약이 같아지지는 않습니다.

## 텍스처 레시피 필드

| 문장 | 의미 |
| --- | --- |
| `atlas = (16px, 8px);` | 선택적 텍스처 크기; 생략 시 결정적 자동 패킹 |
| `density = 2;` | 선택적 아틀라스 PPU 배수(`1`, `2`, `4`; 기본 `1`, `creature`/`prop`은 `2` 권장) |
| `render_mode = emissive;` | 선택적 표면 셰이딩(`default` 또는 발광 코어·눈·룬용 `emissive`) |
| `background = shade;` | 차트 밖 팔레트 역할 |
| `background_alpha = 255;` | 정수 alpha `[0,255]` |
| `palette { shade = #2e2420; coat = ramp(#c94f2a, warm); }` | 단색, 3색 램프 `(#shadow, #base, #light)`, 또는 OKLCH 색조 이동 프리셋 `ramp(#hex, warm|cool|metal|gem|wood|stone|organic|cloth|emissive|vivid)` (어두운 색은 `luma >= 0.14` 권장) |
| `chart body box { fill = coat; }` | 차트 레시피; `origin` 생략 시 자동 패킹, 선택 `grain = clustered\|soft\|fur\|wood\|cloth\|brushed\|none;` |
| `grain clustered\|soft\|fur\|wood\|cloth\|brushed\|none { seed = 23; }` | 선택적 텍스처 기본 grain (`seed` 선택; 생략 시 `none`) |
| `tone voxel\|painterly;` | 선택적 셰이딩 모드(`voxel` 방향성 플랫 톤 또는 `painterly` 형태 추종 그라디언트) |
| `stamp eye { pixels = "ee/e."; e = shade; }` | 재사용 픽셀 기호 |

형상은 `surface = skin.body;`로 required surface 포트와 chart를 참조합니다. 큐브·평면마다 정확히 하나가 필요합니다. 계약에 차트 크기를 명시한 경우 `(w, h, d)` 박스는 `(2*w + 2*d, h + d)`와 일치해야 하며, 크기와 원점을 생략하면 컴파일러가 정확한 전개도를 추론해 결정적으로 패킹합니다.

`opaque` coverage는 불투명 픽셀, `binary`는 투명·불투명, `optional`은 필수 커버리지를 완화합니다. 재질과 함께 선택하세요. `cutout`·`double`은 명시적 재질이며 임의 분수 alpha 혼합의 별칭이 아닙니다.

## 면·패턴·커버리지

box 차트 면은 `north`, `south`, `east`, `west`, `up`, `down`입니다. `face <dir> { ... }` 안에서 `fill = <role>;` 재정의, `mirror = <other-dir>;` 수평 미러링, `grain = clustered|soft|none;` 설정을 할 수 있습니다. 면 로컬 스탬프 좌표는 아틀라스 원점이 아니라 해당 면의 왼쪽 위에서 시작합니다.

차트나 면은 다섯 가지 결정적 패턴을 지원합니다:

| 패턴 | 필수 및 선택 속성 | 용도 |
| --- | --- | --- |
| `pattern blotch` | `paint`, `scale` (`vec3<texel>` 1–128), `density` (`ratio` 0–1), `phase` | 유기적 털·돌 얼룩 클러스터 |
| `pattern gradient` | `to`, `axis` (`u\|v\|x\|y\|z`), 선택 `from`, `space` (`local\|model`), `soft` (`ratio`) | 2px 클러스터 형태 전환(배·등·모델 전체 명암) |
| `pattern border` | `paint`, 선택 `width` (`1px`–`16px`), `edges` (`all\|top\|bottom\|sides`) | 테두리, 벨트, 갑옷 외곽선, 목재 프레임 |
| `pattern stripe` | `paint`, `axis` (`u\|v\|x\|y\|z`), `period`, 선택 `width`, `phase` | 깃털, 갈비뼈, 줄무늬, 판자 |
| `pattern edge` | `paint`, 선택 `width`, `mode` (`highlight\|darken`) | 칠해진 차트 영역의 상단/좌측 림 또는 틈새 강조 |
| `pattern ao` | 선택 `strength` (`ratio` 0–1), `radius` (`unit` 또는 `texel` <= 16) | 인접 형상 기반 3D 접촉 앰비언트 오클루전 |

`blotch`, `gradient`, `border`, `stripe`, `edge` 패턴은 `stamp` 배치 앞에 와야 합니다. `ao`는 `grain` 전 `tone`과 함께 CPU에서 3D 틈새 음영을 누적합니다.

레시피 `coverage = …;`는 flat chart에만 속하며 face·box에는 쓸 수 없습니다. 따옴표 없는 이진 숫자가 행 순서로 정확히 `(width * density) * (height * density)`비트여야 합니다. binary 계약에는 이 마스크가 필요하며 opaque에는 0비트가 있을 수 없습니다. 계약의 `opaque|binary|optional` 열거형과 다른 픽셀 마스크입니다.

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
| `protect` | 기본 `true` (스탬프 셀 보호), `false` (tone/grain 변조 허용), 또는 음이 아닌 `texel` 여백 |

배치는 스탬프를 확대하지 않습니다. 전체 스탬프·보호 사각형이 면 안에 있어야 합니다. 반 texel에 걸친 중앙 배치는 반올림하지 않고 실패합니다. flip은 내용만 바꾸며 이후 명시적 스탬프는 보호 픽셀에도 덧칠할 수 있습니다.
