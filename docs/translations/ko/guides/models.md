# 모델 만들기

모델 원본은 형상, 표면, 리그·스켈레톤, 최종 에셋 조립을 정의합니다. 애니메이션 에셋에는 motion 선언을 추가합니다. 같은 원본으로 일반 GLB 또는 적절한 Minecraft 출력을 만들 수 있습니다.

## 정적 소품으로 시작하기

`showcase/assets/models/wall_lantern.ashfox`, `showcase/assets/models/rune_bricks.ashfox`, 또는 [스타터 다운로드](/downloads/starter.zip)에서 시작하세요. 내장 표준 라이브러리 모듈은 `ashfox library std list model` 및 `ashfox library std list core`로 조회할 수 있습니다. 에셋 폴더에서 실행하세요.

{{source-code:0}}

GLB는 엔진용 모델이고 PNG는 그 모델의 관찰 이미지입니다. 정적 소품에는 idle 애니메이션이 필요 없으며 워크스페이스도 필요 없습니다.

## 편집할 선언 이해하기

| 선언 | 바꿀 수 있는 내용 |
| --- | --- |
| `rig contract` | 부착 관절과 허용 동작 채널 |
| `skeleton` | 정지 포즈의 관절 위치 |
| `surface contract` | 텍스처 차트와 필수 커버리지 |
| `surface` | 팔레트, PBR `roughness`/`metallic`, 래스터 상세, 재질 동작 |
| `component` | `cube`, `plane`, `taper`, `wedge`, `cylinder`, `expression_slot` 생성과 본·표면 바인딩 |
| `motion` | 지원되는 관절 채널 및 표정 `expression` 타임라인 애니메이션 |
| `model` 조립 | 스켈레톤, 컴포넌트, 할당된 동작 선택 및 `settings.profile` 기반 물리 `colliders` 자동 생성 |

모든 원본은 `ashfox 1`로 시작하고 확장자는 `.ashfox`입니다. 모델 길이는 `u`, 픽셀 크기는 `px`, 시간은 `s`, 각도는 `deg`를 씁니다. 완전한 원본과 유효값은 [모델 언어 문법](../language/model.md), 공용 설계 변수와 정확한 크기 관계는 [치수와 픽셀 상세](precision-modeling.md)를 참고하세요.

## 프로파일별 레퍼런스 예제

| 프로파일 | 예제 | 보여주는 구성 |
| --- | --- | --- |
| `block` | `showcase/assets/models/rune_bricks.ashfox` | 불필요한 회전·대칭 강제 없이 텍스처로 표현한 단일 큐브 16×16×16 블록 |
| `prop` | `showcase/assets/models/wall_lantern.ashfox` | `taper`/`wedge` 브래킷과 PBR 금속 광택이 적용된 발광 컷아웃 랜턴 소품 |
| `prop` | `showcase/assets/models/treasure_chest.ashfox` | `"std/model/prop/container"`와 `std/core/hook/loot` 훅을 사용하는 모듈형 소품 |
| `creature` | `showcase/assets/models/goblin_raider.ashfox` | `"std/model/rig/biped"`, `"std/model/motion/combat"`, 표정 스왑, 캡슐 충돌체를 갖춘 이족 크리처 |
| `creature` | `showcase/assets/models/goblin_pyromancer.ashfox` | 공용 `"std/*"` 모듈 위에서 팔레트·무기·VFX/사운드 큐만 교체한 변형 크리처 |
| `creature` | `showcase/assets/models/griffin_boss.ashfox` | `"std/model/rig/winged_quadruped"`, 3단 상향 독수리 날개, 측면 눈, 꼬리 물리 적용 보스 크리처 |
| `creature` | `showcase/assets/models/red_fox.ashfox` | `"std/model/rig/quadruped"`, 볼·꼬리 `plane` 털, 3단 관절 뒷다리, 꼬리 스프링 물리 적용 여우 |
| `structure` | `showcase/assets/structures/tavern.ashfox` | 복층 목조 선술집, 라디오시티 GI 실내, `LootSpawn`/`DoorPortal` 훅 |
| `structure` | `showcase/assets/structures/blacksmith.ashfox` | 개방형 화로 아치, 모루 실내, 굴뚝 불티를 갖춘 대장간 |
| `structure` | `showcase/assets/structures/modern_gallery.ashfox` | 스테인드글라스 GI와 현대식 전시 가구를 갖춘 통유리 아트리움 갤러리 |

## 크리처 아트 디렉션 원칙 (Do / Don't)

`ashfox library std list model` (`std/model/rig/*`, `std/model/anatomy/*`, `std/model/face/*`)을 기준 키트로 삼아 Hytale급 복셀 비례와 실루엣을 유지하세요.

| 구분 | DO (권장) | DON'T (금지) |
| --- | --- | --- |
| **실루엣과 프리미티브** | 유기적 해부학은 `cube` 계층 + `15deg`–`22.5deg` 미세 각도 + 얇은 `plane` 액센트(볼털·꼬리 털·볏·깃털·지느러미)로 조각합니다. | 크리처 주둥이·턱·가슴·부츠/신발에 대형 45° `wedge`를 절대 배치하지 마세요. |
| **특수 프리미티브** | `taper`는 뿔 끝·발톱·검날 끝·부츠 통에, `wedge`는 도끼날·견갑·갑옷 뿔·지붕에, `cylinder`는 물약병·기둥·방패·통·바퀴에만 사용합니다. | 동물 털 꼬리나 깃털 꼬리에 단일 `cylinder` 막대를 절대 쓰지 마세요. |
| **눈 위치와 표정** | 눈 중심을 두개골 높이의 `38%–64%`(권장 `45%–55%`)에 두고, 조류·그리핀·드래곤은 `expression_slot`에 `placement = lateral_pair`를 지정합니다. | 두개골 상단 `68%` 이상(이마 고글 눈)에 눈을 두거나 조류·그리핀 눈을 정면 사시로 몰지 마세요. |
| **리그와 사지 일관성** | 실제 해부학에 맞는 리그(`winged_quadruped`, `quadruped`, `biped`)를 선택해 사족 접지 발 4개와 다관절 다리·상향 날개를 유지합니다. | 잘못된 리그에 맞추려고 다리·날개·관절을 절단하거나 날개를 수평 T-포즈 상자로 축소하지 마세요. |
| **PBR 알베도 여유폭** | 금속(`>= 0.6`) 차트의 베이스 명도 `L >= 0.42`를 유지해 스튜디오 IBL 반사를 살리고, 무광(`metallic < 0.2`) 대형 차트는 `L <= 0.94`로 클리핑을 방지합니다. | 검은 숯처럼 어두운(`L < 0.42`) 고금속 강철검이나 눈부시게 하얗게 날아가는(`L > 0.94`) 무광 가슴을 만들지 마세요. |

## 애니메이션 크리처 만들기

[게임 프로젝트](/downloads/game-assets.zip)를 풀고 `models/workbench/`에서 시작합니다. `main.ashfox`, `animation.ashfox`, `surface.ashfox`, `body.ashfox`를 함께 보관하고 설정된 프로젝트로 복사할 때 패키지·모듈 항목을 유지하세요. import한 모듈을 재사용하려면 그 소스 파일도 필요합니다. 진입점만으로 완전한 백업이 되지는 않습니다.

[애니메이션](animation.md)을 따라 이름 있는 동작을 할당합니다. 일반 게임 번들은 `assets.json`에 출력 클립 이름과 길이를 기록합니다. 재생 시점은 게임 코드가 결정합니다. CLI는 애니메이션 이름에서 공격 타이밍·이동 상태·사운드 이벤트 바인딩을 추론하지 않습니다.

## 대상 선택하기

일반 엔진에는 `exports`의 `format: glb`를 사용합니다. CLI 기본값은 `encoding: portable`입니다. `optimized`는 추가 임포터 확장이 필요합니다. 단위 힌트와 런타임 ID는 [게임 에셋](game-assets.md)을 참고하세요.

Minecraft는 지원되는 모델 export에 `namespace`와 `modelPath`를 설정합니다. Java block은 정적이며 GeckoLib와 Bedrock 액터 전달에는 idle 클립이 필요합니다. 대상과 맞지 않는 기능은 조용히 버리지 않고 실패합니다. [출력 포맷](choose-a-format.md)을 참고하세요.

## 배포 전 리뷰하기

선언한 `preview` 블록과 `render --view <name>`으로 정면·측면·회전 시점 및 동작 GIF를 확인합니다. 생성 GLB를 대상 뷰어나 엔진에 가져와 실루엣, 얼굴 방향, 텍스처 이음새, 크기, 부착물을 검사하세요. 애니메이션은 모든 클립의 전체 주기를 확인합니다. 검증이 게임 조명·카메라에서의 외형까지 보장하지는 않습니다.
