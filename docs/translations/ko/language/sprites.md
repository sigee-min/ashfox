# 스프라이트 문법 레퍼런스

네이티브 스프라이트는 `16×16`, `32×32`, 또는 `64×64` 결정적 정사각형 PNG(`32×32` 권장)를 생성합니다. 지원 프로필은 `item`, `tile`, `icon`, `decal`입니다. CPU 오딧, `preview inspect`, 빌드 명령은 [스프라이트 제작](../guides/sprites.md)을 참고하세요.

## 루트와 리터럴 문법

`ashfox 1` 다음에 `sprite name { … }`를 씁니다. 루트 필수 속성은 `profile`, `canvas`, `palette`이며 레이어는 원본 순서대로 이름 있는 선언입니다.

| 형태 | 예제 |
| --- | --- |
| 대입 | `canvas = (32px, 32px);` |
| 중첩 레코드 | `palette { glint = #ffffff; }` |
| 목록 | `points = [(10px, 15px), (17px, 22px), (28px, 11px)];` |
| 빈 목록 | `patches = [];` |
| 참조 | `material = shared.steel;` |

픽셀 좌표(`canvas`, `at`, `axis`, 도형 점·위치·반지름·두께)에는 `px`를 사용합니다(정수 또는 `0.5px` 단위 중심/반지름). `contrast`, `specular`, `amount`, `density`, `jitter`, `seed` 등 단위 없는 수치에는 `px`를 쓰지 않으며 백분율(`%`)은 비율 필드에 허용됩니다.

## 레이어 선언

레이어 ID는 고유(`[a-z][a-z0-9_]{0,47}`)하며 선언 순서대로 합성됩니다.

| 레이어 | 필드 | 의미 |
| --- | --- | --- |
| `fill name` | `material`, `pattern`, 선택 `grain` | 전체 캔버스를 심리스 래핑 패턴으로 채움 (`tile` 용도) |
| `rect`/`ellipse`/`capsule`/`polygon`/`line name` | 도형 필드, `material`, `shade`, 선택 `grain`, `mirror`, `pattern`, `clip` | 파라메트릭 도형을 직접 선언해 래스터화 (`points`, `cx`/`cy`/`rx`/`ry`, `from`/`to`/`radius` 등) |
| `part name` | `mask`, `material`, `at`, `shade`, 선택 `grain`, `mirror`, `pattern`, `patches` | 재사용 마스크 명암 및 보호 패치 |
| `pattern name` | `material`, `pattern`, 선택 `clip` (`occupied` 또는 `canvas`) | 2D 표면 패턴(`solid`, `gradient`, `blotch`, `stripe`, `brick`, `plank`, `voronoi`, `dither`, `crack`) |
| `outline name` | `mode` (`sel_out`, `dark`, `colored`), 선택 `color`, `strength` (`1..3`), `inner_rim` | 실루엣 인식 픽셀 아웃라인과 좌상단 내측 림 하이라이트 |
| `paint name` | `at`, `rows`, `colors` | 팔레트 바인딩 ASCII 픽셀 |
| `stamp name` | `stamp`, `at`, `flip`, `colors` | 재사용 스탬프 배치 (`none`, `x`, `y`, `xy`) |
| `erase name` | `shape` 또는 (`at`, `rows`) | 영역 지우기 |

## 재사용 선언과 OKLCH 램프

`sprite` 또는 `module` 내부에 `export mask`, `export stamp`, `export material`을 선언합니다. 상대 경로 `import "./shared.ashfox" as shared;`를 지원합니다.

- `mode = auto; base = #rrggbb; preset = <preset>;`는 OKLCH 색조 이동 5단 램프를 자동 생성합니다(`warm`, `cool`, `metal`, `gem`, `wood`, `stone`, `organic`, `cloth`, `emissive`, `vivid`).
- `mode = explicit; colors = [#c0, #c1, #c2];` (또는 5색)은 sRGB 휘도가 감소하지 않아야 하며 양 끝 색이 달라야 합니다. 어두운 톤이 뭉개지지 않도록 상대 휘도 `0.14` 이상을 권장합니다.

## 명암과 입자

- `shade`: `form` (`flat`, `round`, `bevel`, `cylinder`, `facet`), `light` (`top_left` 등 8방향), `contrast` (`0..3`), 선택 `specular` (`0..2`), `bevel`/`cylinder`의 경우 `axis`.
- `grain`: `mode` (`none`, `clustered`, `soft`, `directional`), `directional`일 때 `axis` (`horizontal`, `vertical`, `diagonal`), `amount` (`0..2`), `seed` (`0..4294967295`).

## 완전한 재사용 스프라이트

`badge.ashfox`로 저장하세요:

{{source-code:0}}

{{source-code:1}}

추가 재질과 타일·아이템 예제는 [공용 아이템 모듈](../../examples/items/assets/module/shared.ashfox)과 [아이템 워크스페이스](../../examples/items/.ashfoxworkspace), 여러 개를 묶어 출력하려면 [워크스페이스 설정](../guides/workspace.md)을 참고하세요.
