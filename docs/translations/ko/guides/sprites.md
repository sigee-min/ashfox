# 아이템 스프라이트 만들기

스프라이트 원본은 픽셀 배치·명암·입자가 결정적인 투명 16×16 PNG를 생성합니다. 일반 게임과 Minecraft 아이템 팩에서 사용할 수 있습니다. 현재 `minecraft-item-v1` 프로필 이름은 컴파일 규칙을 선택하며 PNG의 사용처를 제한하지 않습니다.

## 완전한 스프라이트 빌드하기

상위 워크스페이스가 없는 폴더에 다음 완전한 원본을 `gem.ashfox`로 저장하세요.

{{source-code:0}}

{{source-code:1}}

응답의 실제 export 디렉터리를 사용하세요. 그 안에 `gem.png`가 있습니다. 설정된 프로젝트에서는 [프로젝트 설정](workspace.md)처럼 파일을 진입점으로 등록하고 PNG export를 추가합니다.

## 칠하고 조합하기

행 너비는 같아야 합니다. `.`은 투명 픽셀이고 나머지 문자에는 색 바인딩이 필요합니다. 좌표는 캔버스 왼쪽 위 기준의 정수 픽셀입니다. 레이어는 선언 순서로 실행되어 뒤의 칠이 앞의 결과를 덮을 수 있습니다.

| 레이어 | 필수 설정 | 용도 |
| --- | --- | --- |
| `paint <id>` | `at`, `rows`, `colors` | 명시적인 색 픽셀 배치 |
| `erase <id>` | `at`, `rows` | 표시된 픽셀 지우기 |
| `part <id>` | `mask`, `material`, `at`, `shade`, `grain`, `patches` | 재사용 형상에 명암과 보호 무늬 추가 |
| `stamp <id>` | `stamp`, `at`, `flip`, `colors` | 색을 바인딩한 재사용 기호 배치 |

part 마스크는 `1`과 `.`을 씁니다. material은 그림자·기본·밝은 색의 3색 램프 또는 프리셋으로 생성하는 램프를 정의합니다. shade는 `flat`, `round`, `bevel`, `light: top_left`, 대비 0–2를 선언하며 bevel에는 axis도 필요합니다. grain은 `mode: clustered-v1`, amount 0–1, 정수 seed를 씁니다. patch는 로컬 `at`, `rows`, `colors`, 보호 너비 0–2를 가지며 part 마스크 안에 있어야 합니다. 없으면 `patches = [];`를 사용합니다.

[apple 원본](../../examples/items/src/apple.ashfox)과 [shared 모듈](../../examples/items/src/shared.ashfox)은 part·램프·패치·재사용 형상의 완전한 예제입니다. 두 파일을 함께 보관하세요. 독립 import는 진입점 디렉터리 아래에 있어야 하고, 설정된 프로젝트는 가져오는 모든 모듈을 선언해야 합니다. 상대 경로를 명시하세요. 스프라이트의 패키지 이름 import는 지원하지 않습니다.

현재 프로필의 캔버스는 16×16으로 고정됩니다. 범위 밖 배치, 색이 없는 행 문자, 알 수 없는 설정, 잘못된 명암 매개변수는 컴파일 실패입니다. 미리보기를 확대해도 전달 해상도는 커지지 않습니다.

## 픽셀 리뷰하기

{{source-code:2}}

확대 보기와 원래 이미지를 함께 확인하세요. `inspect`는 영수증과 픽셀별 원본 소유권 증거를 반환합니다. 명암 part가 있는 원본은 `--stage silhouette`, `--stage shade`, `--stage grain`으로 구성 단계를 확인합니다.

![확대한 검의 최종 픽셀](/media/guides/sword.png)
![같은 검의 실루엣 단계](/media/guides/sword-shape.png)

PNG 입력·투명도·메모리 출력은 [관찰 제어](observe.md)를 참고하세요. 일반 엔진은 [게임 에셋](game-assets.md)에 PNG export를 연결하고 필터링·단위당 픽셀을 선택합니다. Minecraft는 [Minecraft 팩](minecraft-packs.md)의 아이템 리소스 ID에 연결합니다.
