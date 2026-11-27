# 모델 애니메이션

“호기심 있게 둘러보기, 천천히 날개 펴기, 짧은 인사를 추가하고 발은 고정해라”처럼 동작이 전달할 의미를 에이전트에게 알려주세요. 각각 선택할 수 있도록 이름 있는 클립을 요청합니다.

`check`로 클립 이름을 찾고, 포즈(`clip = "NAME"; time = SECONDS;`)나 전체 주기(`kind = gif; clip = "NAME";`)를 `preview` 블록에 선언한 뒤 `render --view <name>`으로 확인합니다. 예를 들면 다음과 같습니다.

{{source-code:0}}

![여우 꼬리 흔들기 클립](/media/guides/fox-motion.gif)

아래는 에이전트가 작성할 원본을 설명합니다. **조각 예제**는 기존 파일 안에 넣는 코드이며 완전한 시작 예제는 문서 끝에 연결되어 있습니다.

## 먼저 관절 배치하기

skeleton 바인딩은 **부모 관절 좌표계의 `parent_origin`**을 사용합니다. 루트는 모델 좌표입니다. 회전하지 않은 몸통이 `(0u, 13u, 0u)`, 어깨의 모델 위치가 `(6.5u, 19.5u, 0u)`라면 `parent_origin = (6.5u, 6.5u, 0u)`입니다. 부모는 자식과 함께 이 오프셋을 회전·반사합니다. 과거 속성 `origin`은 추측하지 않고 거부합니다. 무기는 리그에서 손 관절 아래에 두고 원점을 손잡이에 놓으세요. 전체 동작으로 회전 방향·손 접촉·발 고정을 확인합니다.

## motion 만들기

움직이는 관절의 rig contract를 대상으로 motion을 선언합니다. 사용하는 모든 채널(`position`, `rotation`, `scale`)을 rig가 허용해야 하며, 선택적으로 `limits`, `chain`, `ik_limb`, `anchor` 메타데이터를 선언할 수 있습니다.

**조각 예제 — motion 선언 하나:**

{{source-code:1}}

`duration`은 양수, `fps`는 정수 1–240입니다. 재사용 리그 동작은 기본적으로 정지 공간 기준 상대(`rest_relative = true`)입니다. 키 시간은 길이 안에 있고 엄격히 증가해야 합니다.

### 위치·회전·크기 트랙

대상은 `<관절>.position`, `<관절>.rotation` 또는 `<관절>.scale` 형식을 사용합니다.

**조각 예제 — 회전과 크기:**

{{source-code:2}}

회전은 도 단위 세 값(`vec3<degree>`), 위치는 모델 공간 오프셋(`vec3<unit>`), 크기는 양수 ratio 세 값(`vec3<ratio>`)이며 대상 관절의 `channels`에 해당 채널이 있어야 합니다.

키마다 보간(`linear`, `step`, `smooth`, `ease_in`, `ease_out`, `ease_in_out`, `cubic`, `snap`, `anticipate`, `overshoot`, `bounce`, `elastic`, `catmullrom`)과 선택적 매개변수(예: `overshoot(strength = 1.4)`)를 명시합니다. 보간 단어는 값 뒤, 세미콜론 앞에 놓이며 회전 트랙은 쿼터니언 네이티브 SLERP로 베이크됩니다.

## 절차적 파동, IK, 보조 물리, 전투 및 큐

`motion` 본문에서 고수준 애니메이션 블록을 함께 조합할 수 있습니다.

{{source-code:3}}

`layer` 블록(`mode = override | additive;`, `weight`, `mask = [...]`), 이름 있는 `pose` / `at <t> pose <name>` 키, 표정 스왑 `expression <slot> { at 0.00s = neutral; at 1.45s..1.58s = blink; }` (`expression_slot`과 결합해 추가 드로우 콜 없이 베이크), 전투 타이밍 연산(`squash`, `smear`, `hitstop`, `recoil`), 그리고 `gltf.animations[i].extras.ashfoxCues`로 출력되는 타임라인 `cue`(`sound`, `vfx`, `event`)를 활용할 수 있습니다.

## 반복과 길이 설정하기

허용되는 반복값 세 가지 중 선택합니다.

| 원본 값 | 재생 동작 |
| --- | --- |
| `once` | 길이 끝까지 재생 후 정지 |
| `loop` | 처음으로 돌아가 반복 |
| `hold_on_last_frame` | 끝까지 재생 후 마지막 포즈 유지 |

첫·마지막 키를 의도적으로 정하세요. 반복 idle은 시작·끝 포즈를 맞추면 연결이 자연스럽습니다.

## 동작 할당과 선택

여러 에셋이 공유할 motion은 재사용 모듈에 선언하고 별칭으로 import합니다. 에셋 조립에서 각 동작을 명시적으로 할당하세요.

**조각 예제 — 여러 동작 가져오기와 할당:**

{{source-code:4}}

여러 다른 동작을 선택할 수 있지만 각 동작은 한 번만 할당하며 모두 선택된 skeleton의 rig를 대상으로 해야 합니다. component의 rig 포트도 같은 계약에 연결해야 합니다.

`check`로 클립 이름과 길이를 확인한 뒤, `preview` 블록(`kind = gif; clip = "NAME";` 또는 `clip = "NAME"; time = SECONDS;`)을 선언해 `render --view <name>`으로 재생하세요.

## Griffin의 여섯 클립

검증된 Griffin 예제는 `animation` 모듈에서 여섯 이름을 export합니다. 일반 소스 선언이므로 할당 시 모듈 별칭과 함께 사용하세요.

| 클립 | 동작 | 길이 |
| --- | --- | ---: |
| `idle` | 부드러운 대기 | `3s` |
| `look_around` | 고개를 돌려 양쪽 관찰 | `4s` |
| `wing_display` | 날개를 들어 포즈 유지 | `3.6s` |
| `wing_flap` | 양쪽 날개를 빠르게 퍼덕임 | `1.6s` |
| `greeting` | 고개 끄덕임과 꼬리 흔들기 | `3s` |
| `alert` | 자극에 반응해 방향 전환 | `2.4s` |

`showcase/assets/models/griffin_boss.ashfox`, `showcase/assets/models/goblin_raider.ashfox`, 그리고 내장 표준 라이브러리 모듈(`ashfox library std list model/rig`, `ashfox library std list model/motion`)을 참고하세요. 완전한 번들은 [게임 프로젝트](/downloads/game-assets.zip)에 있습니다.

여섯 동작 모두 정지 공간 기준 상대입니다. 대상은 `head`, `wing_left`, `wing_right`, `tail` 등 의미 있는 리그 관절입니다.

## 모든 동작 리뷰하기

원본 변경 후 할당된 모든 클립의 전체 주기를 확인하세요. 시작·끝 포즈, 가장 큰 움직임, 실제 게임 크기의 동작을 검사합니다. 양쪽에서 반사된 부착물을 보고 타임라인을 탐색해 갑자기 튀는 키를 찾으세요.

크기 트랙은 부품이 보이며 세 성분이 모두 양수인지, 회전은 최대 각도에서 피벗·부착을 확인합니다. 유효한 원본인데 잘못 보이면 시각적 문제를 설명하고 소유 트랙·관절 바인딩·정지 포즈를 수정하세요. 검증만으로 애니메이션 품질을 인증하지 않습니다.

## 완전한 원본

[언어 레퍼런스의 완전한 원본](../language/model.md)은 rig·skeleton·surface·component·motion·조립을 갖춘 작은 애니메이션 큐브입니다. 독립 시작 파일이 필요할 때 사용하세요. 이 페이지는 동작 조각이므로 주변 surface·component 선언을 의도적으로 생략합니다.
