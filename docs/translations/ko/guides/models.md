# 모델 만들기

모델 원본은 형상, 표면, 리그·스켈레톤, 최종 에셋 조립을 정의합니다. 애니메이션 에셋에는 motion 선언을 추가합니다. 같은 원본으로 일반 GLB 또는 적절한 Minecraft 출력을 만들 수 있습니다.

## 정적 소품으로 시작하기

[marker 원본](../../examples/minecraft/marker.ashfox)은 완전한 파일 하나이며 [스타터 다운로드](/downloads/starter.zip)에도 포함됩니다. 에셋 폴더에서 실행하세요.

{{source-code:0}}

GLB는 엔진용 모델이고 PNG는 그 모델의 관찰 이미지입니다. 정적 소품에는 idle 애니메이션이 필요 없으며 워크스페이스도 필요 없습니다.

## 편집할 선언 이해하기

| 선언 | 바꿀 수 있는 내용 |
| --- | --- |
| `rig contract` | 부착 관절과 허용 동작 채널 |
| `skeleton` | 정지 포즈의 관절 위치 |
| `surface contract` | 텍스처 차트와 필수 커버리지 |
| `surface` | 팔레트, 래스터 상세, 재질 동작 |
| `component` | 큐브·평면 생성과 본·표면 바인딩 |
| `motion` | 지원되는 관절 채널의 애니메이션 |
| `asset` 조립 | 스켈레톤, 컴포넌트, 할당된 동작 선택 |

모든 원본은 `ashfox-model 1`로 시작하고 확장자는 `.ashfox`입니다. 모델 길이는 `u`, 픽셀 크기는 `px`, 시간은 `s`, 각도는 `deg`를 씁니다. 완전한 원본과 유효값은 [모델 언어 문법](../language/model.md), 공용 설계 변수와 정확한 크기 관계는 [치수와 픽셀 상세](precision-modeling.md)를 참고하세요.

## 애니메이션 크리처 만들기

[게임 프로젝트](/downloads/game-assets.zip)를 풀고 `models/workbench/`에서 시작합니다. `main.ashfox`와 `animation.ashfox`를 함께 보관하고 설정된 프로젝트로 복사할 때 패키지·모듈 항목을 유지하세요. import한 모듈을 재사용하려면 그 소스 파일도 필요합니다. 진입점만으로 완전한 백업이 되지는 않습니다.

[애니메이션](animation.md)을 따라 이름 있는 동작을 할당합니다. 일반 게임 번들은 `assets.json`에 출력 클립 이름과 길이를 기록합니다. 재생 시점은 게임 코드가 결정합니다. CLI는 애니메이션 이름에서 공격 타이밍·이동 상태·사운드 이벤트 바인딩을 추론하지 않습니다.

## 대상 선택하기

일반 엔진에는 `exports`의 `format: glb`를 사용합니다. CLI 기본값은 `encoding: portable`입니다. `optimized`는 추가 임포터 확장이 필요합니다. 단위 힌트와 런타임 ID는 [게임 에셋](game-assets.md)을 참고하세요.

Minecraft는 지원되는 모델 export에 `namespace`와 `modelPath`를 설정합니다. Java block은 정적이며 GeckoLib와 Bedrock 액터 전달에는 idle 클립이 필요합니다. 대상과 맞지 않는 기능은 조용히 버리지 않고 실패합니다. [출력 포맷](choose-a-format.md)을 참고하세요.

## 배포 전 리뷰하기

`capture`로 정면·측면·회전 시점을 확인하고 `replay --clip NAME`으로 동작을 봅니다. 생성 GLB를 대상 뷰어나 엔진에 가져와 실루엣, 얼굴 방향, 텍스처 이음새, 크기, 부착물을 검사하세요. 애니메이션은 모든 클립의 전체 주기를 확인합니다. 검증이 게임 조명·카메라에서의 외형까지 보장하지는 않습니다.
