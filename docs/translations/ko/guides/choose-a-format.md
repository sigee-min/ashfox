# 작업 흐름과 포맷 선택

에셋 하나는 단일 명령으로 시작하세요. 공통 소스 선택·ID·전달 폴더가 필요하면 워크스페이스를 추가합니다. 메모리에서 `check`, `render`, `export`를 구동하려면 `--stdin` 또는 `--input-json`을 전달하세요.

| 작업 | 단일 에셋 CLI | 워크스페이스 빌드 |
| --- | --- | --- |
| 네이티브 모델·스프라이트·사운드 원본 | 지원 (`check`, `render`, `export`) | 선언한 원본 |
| 기존 PNG 입력 | 지원 (`check`, `render`, `export`) | 미지원 |
| 구조·품질 감사 점수 확인 | `check` | `check <workspace>` / `build` |
| 원하는 각도 PNG·아틀라스·파형 | `render` | 별도 단일 에셋 `render` |
| 애니메이션·턴테이블 GIF | `render --gif` | 별도 단일 에셋 `render --gif` |
| 메모리의 원본 교체 | `--stdin` / `--input-json` | 디스크 원본 |
| GLB | 바이너리 (`export`) | 이름 있는 export |
| glTF | `export --format gltf` ZIP | 워크스페이스 포맷 아님 |
| Java block·GeckoLib 5·Bedrock 모델 | ZIP (`export`) | 이름 있는 export 디렉터리 |
| 스프라이트 PNG·사운드 WAV | 바이너리 (`export`) | 이름 있는 export |
| OGG·완전한 Java 리소스 팩·게임 매니페스트 | 워크스페이스 빌드 사용 | 지원 |

[렌더링과 확인](observe.md)과 [워크스페이스 설정](workspace.md)을 참고하세요.

## 받을 포맷 선택하기

| 대상 | 사용할 것 | 프로젝트에서 추가할 것 |
| --- | --- | --- |
| 일반 게임·뷰어 | Portable GLB, PNG, WAV/OGG | 임포터, 게임 장면·동작 |
| 런타임 ID가 있는 여러 에셋 | `game_assets` 팩 | `assets.json`과 참조 파일 로딩 |
| Minecraft Java 시청각 교체 | `minecraft_java` 리소스 팩 | 호환 팩 설정, 게임 이벤트 실행 |
| Minecraft 정적 블록 | `java_block` | 기존 블록 ID 또는 모드 등록 |
| GeckoLib 엔티티 | `geckolib5` | 모드·엔티티 등록 |
| Bedrock 엔티티 | `bedrock` | 애드온 매니페스트·동작·등록 |

Portable GLB는 필수 압축 확장 없이 텍스처·애니메이션을 포함합니다. 워크스페이스 GLB는 `optimized`를 선택할 수 있지만 먼저 임포터가 `requiredExtensions`를 지원하는지 확인하세요. 일반 정적 모델에는 idle 클립이 필요 없습니다. Java block은 애니메이션을 거부하며 GeckoLib·Bedrock 액터 출력에는 idle이 필요합니다. 대상과 맞지 않는 내용은 조용히 빠지지 않고 출력에 실패합니다.

동작하는 예제는 [웹 게임](web-game.md), [일반 번들](game-assets.md), [Minecraft 팩](minecraft-packs.md)을 사용하세요.
