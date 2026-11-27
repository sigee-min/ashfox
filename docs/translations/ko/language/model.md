# 모델 문법 레퍼런스

Ashfox 원본은 에셋의 형상·표면·리그·동작을 정의하고 [CLI](../guides/cli.md)로 직접 컴파일합니다. 정확한 `ashfox 1` 헤더 뒤에 소스 단위 하나를 쓰세요.

예제는 구분해서 표시합니다. **조각**은 큰 원본 안에 넣는 부분이고 **완전한 원본**은 헤더·단위·선언·조립을 포함해 작은 에셋 파일 하나로 쓸 수 있습니다.

상세 스펙은 [값과 표현식](values.md), [컴포넌트와 소켓](components.md), [모델 텍스처](textures.md)에 있습니다. 다른 에셋 종류는 [스프라이트](sprites.md), [사운드](sounds.md), [구조물](structures.md) 선언과 `ashfox 1` 헤더를 공유합니다.

## 1. 소스 단위

재사용 `module`과 진입점 `model` 단위를 설명합니다. 다른 종류는 [스프라이트](../guides/sprites.md)·[사운드](../guides/sounds.md)를 보세요. 단위 안의 선언은 export하여 다른 단위가 참조할 수 있습니다.

**조각 — 두 소스 단위 형태:**

{{source-code:0}}

{{source-code:1}}

블록은 중괄호, 속성 대입은 `;`로 끝냅니다. component `use`도 닫는 중괄호 뒤 `;`가 필요합니다. 파일당 단위 하나를 유지하고 모든 파일은 `ashfox 1`로 시작합니다.

### Import와 이름

import는 따옴표 경로와 로컬 별칭입니다. 가져온 선언은 `alias.name`, 같은 단위는 로컬 이름을 씁니다.

**조각 — 재사용 애니메이션 모듈 가져오기:**

{{source-code:2}}

경로·별칭·선언 이름·필수 바인딩을 명시합니다. 비슷한 이름으로 rig·surface·chart·joint를 고르지 않습니다. 다른 단위나 진입점 조립에서 쓸 선언에는 `export`를 붙이세요.

## 2. 값과 선언

대입은 `name = expression;`입니다. 일반 리터럴 단위는 다음과 같습니다.

| 리터럴 | 의미 |
| --- | --- |
| `4u` | 위치·크기 모델 단위 |
| `16px`, `16tx` | 텍스처 픽셀 |
| `12deg` | 도 단위 회전 |
| `1.5s` | 초 단위 동작 시간 |
| `0.5`, `50%` | 크기 또는 강도 비율 |
| `16` | density·fps 같은 정수 |
| `true`, `false` | 불리언 |
| `#d16b3a` | 색 |

벡터는 `(0u, 4u, 0u)`, `(0deg, 10deg, 0deg)`, `(1, 1, 1)` 같은 괄호를 사용합니다. 이름 있는 값·산술·비교·벡터 `.x`, `.y`, `.z`를 쓸 수 있습니다. 주변 선언의 기대 단위를 유지하세요. `4u`와 `4px`는 다릅니다.

지원 선언은 다음과 같습니다.

- `design`: 정확한 공유 치수와 이름 있는 검사. 완전한 검증 패턴은 [정밀 모델링](../guides/precision-modeling.md).
- `rig contract`, `skeleton`: 동작 관절과 구체 정지 프레임.
- `surface contract`, `surface`: 차트 배치·재질·픽셀.
- `component`: 타입 포트를 갖는 재사용 형상.
- `motion`: 이름 있는 관절 트랙.
- `settings`, `skeleton`, `motions`, `use`, `connect`: `model` 본문에서 직접 지정하는 스켈레톤·동작·component 인스턴스와 선택적 socket 연결.

## 3. 형상과 표면

### 컴포넌트와 형상

component는 재사용 형상 트리를 소유합니다. 보통 rig contract·surface contract를 하나씩 요구하고 형상 본을 관절에 연결하며 큐브·평면마다 차트를 지정합니다.

**조각 — rig에 연결된 component:**

{{source-code:3}}

형상 노드는 다음처럼 중첩합니다.

| 노드 | 필수 속성 | 유용한 선택 속성 |
| --- | --- | --- |
| `bone` | 없음 | `position`, `rotation`, `pivot`, `visible` |
| `cube` | `origin`, `size`, surface chart 하나 | `position`, `rotation`, `pivot`, `visible`, `inflate`, `mirror`, `mirror_x` |
| `plane` | `origin`, `size`, `u_axis`, `v_axis`, surface chart 하나 | `position`, `rotation`, `pivot`, `visible`, `mirror_x` |
| `locator` | 없음 | `position`, `rotation`, `visible` |
| cube 안 `face` | 없음 | `enabled`, `rotation` |

bone에는 bone·cube·plane·locator가 들어갑니다. cube에는 `north`, `south`, `east`, `west`, `up`, `down` face가 들어가며 면 회전은 `0`, `90`, `180`, `270`입니다. `cube`나 `plane`에 `mirror_x = <id>;`를 주면 `x = 0` 대칭 형제 노드를 합성합니다.

cube·plane 크기는 양수여야 합니다. plane의 size는 unit 두 성분이고 `u_axis`·`v_axis`는 서로 다른 부호 있는 단위 축입니다. 바인딩된 본은 이미 rig에서 배치를 받으므로 충돌하는 position·rotation·pivot을 추가하지 마세요.

### 표면 계약과 표면

surface contract는 아틀라스와 형상이 쓸 이름 있는 chart를, 구체 surface는 재질·텍스처 레시피를 제공합니다. 차트 크기는 계약의 일부이며 큐브 box chart는 UV 전개도와 정확히 맞아야 합니다.

**조각 — 차트 계약과 구체 표면:**

{{source-code:4}}

chart는 `box`·`flat`, coverage는 `opaque`·`binary`·`optional`, material은 `opaque`·`cutout`·`double`입니다. 레시피에는 atlas·background·palette·chart와 정확히 하나의 `grain clustered { seed = ...; }`가 있습니다. `tone voxel`로 예제의 픽셀 명암을 사용하고 면 로컬 stamp로 의도한 무늬를 추가하세요. 정밀 가이드는 정확한 픽셀 무늬·앵커 스탬프를 보여줍니다.

## 4. 리그와 스켈레톤

rig contract는 관절 이름·부모 관계·로컬 프레임·허용 채널·선택적 대칭 파트너를 선언합니다. skeleton은 각 관절의 구체 정지 원점·프레임으로 구현합니다.

**조각 — rig와 skeleton:**

{{source-code:5}}

관절은 `position`, `rotation`, `scale` 채널 조합(예: `channels = (position, rotation);`)과 선택적 `limits`, `chain`, `ik_limb`, `anchor` 메타데이터를 선언합니다. motion은 허용 채널만 사용합니다. parent·mirror는 관절 이름(없으면 생략 또는 `none`, 항등 `handedness = right`와 항등 `frame`도 생략 가능)입니다. 프레임은 부호 있는 직교 축이고 skeleton bind마다 정지 `parent_origin`과 비항등 프레임을 명시합니다.

바인딩의 **`parent_origin`**은 부모 관절 프레임 기준이고 루트는 모델 프레임입니다. 회전 없는 몸통 y가 `13u`, 어깨 모델 y가 `19.5u`, x가 `6.5u`라면 `(6.5u, 6.5u, 0u)`를 사용합니다. 부모 프레임은 자식 배치 전에 이 오프셋을 회전·반사합니다. 모호한 skeleton `origin`은 별칭 없이 거부합니다. 형상·socket frame의 origin은 각 문서화된 공간을 유지합니다.

## 5. 동작

motion은 움직일 rig contract를 이름으로 지정합니다. 트랙은 관절 하나의 `position`, `rotation` 또는 `scale`을 대상으로 합니다.

**조각 — 정지 공간 기준 상대 회전:**

{{source-code:6}}

속성 규칙입니다.

- `duration`: 양의 초.
- `fps`: 정수 1–240.
- `loop`: `once`, `loop`, `hold_on_last_frame`.
- `rest_relative`: 기본값이 `true`입니다.

키 시간은 길이 안에서 엄격히 증가합니다. 각 키 끝에는 보간 커브(`linear`, `step`, `smooth`, `ease_in`, `ease_out`, `ease_in_out`, `cubic`, `snap`, `anticipate`, `overshoot`, `bounce`, `elastic`, `catmullrom`)와 선택적 인자를 붙여 다음 키까지 구간을 제어합니다.

위치는 `vec3<unit>`, 회전은 `vec3<degree>`(쿼터니언 네이티브 SLERP로 베이크), 크기는 `(1, 1, 1)` 같은 양의 `vec3<ratio>`이며 관절이 해당 채널을 허용해야 합니다. 동작에는 `wave`, `pose`, `at ... pose`, `layer`, `ik`(`foot_lock`), `secondary`(`chain`/`joint`), 전투 연산(`squash`, `smear`, `hitstop`, `recoil`), 그리고 `cue`(`sound`, `vfx`, `event`) 블록도 사용할 수 있습니다.

## 6. 조립

`model` 단위는 본문에서 직접 구체 skeleton 하나, 서로 다른 motion 0개 이상(`motions = [...]`), component 인스턴스 1개 이상을 선택하고 고정 density·forward를 설정합니다.

**조각 — skeleton·motion·component 선택:**

{{source-code:7}}

현재 density는 `16`, forward는 `north`, `south`, `east`, `west`입니다. 선택적 `profile`(`creature`, `prop`, `block`)은 `ashfox check`의 품질 감사 가중치를 지정합니다. `use`는 이름 있는 인스턴스를 만들고 모든 required 포트를 연결합니다. 조립의 `skeleton`은 구체 구현, `use`의 rig 포트 바인딩은 대응 rig contract를 지정합니다. `motions = [...]`에 여러 동작을 나열할 수 있으며 모두 skeleton과 같은 rig를 사용하고 한 번씩만 나타나야 합니다.

소켓 부착에는 명시적 계약과 제공·요구 endpoint를 연결합니다. 방향은 `provider.port -> required.port`이며 가까운 형상으로 부착을 추론하지 않습니다.

**조각 — 명시적 소켓 연결:**

{{source-code:8}}

### 작성 컨벤션과 위생 규칙

컴파일 단계에서 독립 진입점과 워크스페이스 전반의 모듈형 `.ashfox` 구조 위생을 강제합니다.

- `asset.unused-import` — 어떤 선언도 참조하지 않는 import 별칭을 제거합니다.
- `asset.unused-declaration` — 진입점의 미사용 선언이나 모듈의 미사용 비공개 선언을 제거합니다.
- `asset.texture.unused-stamp` — 선언한 모든 `stamp`는 최소 한 차트 면에서 사용하거나 삭제해야 합니다.
- `asset.monolithic-entry` — 과도하게 큰 진입점이나 인라인 표면이 포함된 대형 크리처(프리미티브 20개 이상)는 `rig`, `surface`, `body` 모듈로 분리하세요.
- `asset.mixed-module-concerns` — 하나의 import 모듈 파일 안에 리그·동작, 구체 surface, 형상 component를 함께 섞지 마세요.

## 완전한 원본

작은 애니메이션 큐브의 완전한 단일 파일입니다. 큰 형상·공유 치수·픽셀 앵커에는 위 절이나 [정밀 모델링](../guides/precision-modeling.md)을 사용하세요.

**완전한 원본 — `sample.ashfox`:**

{{source-code:9}}
