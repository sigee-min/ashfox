# 복셀 게임을 위한 Assets as Code

Ashfox는 복셀 게임을 위한 오픈소스 Assets as Code 도구입니다. 모델·텍스처·사운드를 네이티브 `.ashfox` 소스로 정의하고 Git으로 버전을 관리합니다. Ashfox로 빌드한 결과를 확인한 뒤 게임에 전달하세요.

아이템 하나로 시작한 뒤 [홈페이지](https://ashfox.io/#frontier)에서 애니메이션이 있는 완성형 크리처를 살펴보세요. [Assets as Code 작업 흐름](guides/assets-as-code.md)은 원본 구성, 변경 리뷰, 재현 가능한 빌드 운영을 설명합니다.

## 시작하기

[Ashfox를 설치](guides/install.md)하고 [첫 에셋 만들기](guides/ai-agent-quick-start.md)를 따라가세요. 다운로드용 스타터에는 모델·아이템·사운드의 완전한 소스가 포함되어 있어 워크스페이스 설정 없이 시작할 수 있습니다.

## 원하는 작업 선택하기

| 작업 | 가이드 |
| --- | --- |
| 시점 선택, PNG 픽셀 확인, 애니메이션 관찰 | [에셋 관찰](guides/observe.md) |
| 소품이나 크리처 만들기 | [모델](guides/models.md) |
| 아이템 그리기와 명암 표현 | [스프라이트](guides/sprites.md) |
| 효과음 합성과 청취 | [사운드](guides/sounds.md) |
| 에이전트와 결과 다듬기 | [리뷰와 개선](guides/authoring-and-review.md) |
| 소스·이미지·요청을 메모리로 전달 | [Stdio와 메모리](guides/stdio.md) |
| 포맷과 실행 방식 선택 | [지원 범위](guides/choose-a-format.md) |
| 모델·아이템·사운드를 함께 사용 | [실행 가능한 웹 예제](guides/web-game.md) |
| Minecraft Java에 전달 | [Minecraft 리소스 팩](guides/minecraft-packs.md) |
| 여러 소스와 출력 경로 구성 | [프로젝트 설정](guides/workspace.md) |
| ID·크기·임포트 메타데이터 사용 | [게임 번들](guides/game-assets.md) |
| 저장·재현·전달 자동화 | [저장과 전달](guides/save-and-export.md), [CI](guides/automation.md) |
| 오류 해결 | [문제 해결](guides/troubleshooting.md) |

## 편집 가능한 원본 보관하기

`.ashfox` 파일과 가져오는 모듈이 편집 가능한 에셋입니다. 선택적인 `.ashfoxworkspace`는 여러 에셋의 빌드와 전달을 설정합니다. PNG·GLB·오디오·ZIP은 생성된 결과물이므로 이를 수정해도 원본이 바뀌지 않습니다.

선택적으로 사용하는 브라우저 [Model Workbench](guides/workbench-api.md)는 별도의 모델 프로젝트 저장소를 사용하며 네이티브 디렉터리 설정을 열지 않습니다. [지원 범위](guides/choose-a-format.md)에서 작업 방식을 비교하세요.

## DSL 레퍼런스

[언어 레퍼런스](language/README.md)는 소스 단위, 값 타입, 연산자, 모델 컴포넌트와 소켓, 텍스처 차트, 스프라이트 레이어, 사운드 레코드를 설명합니다. `.ashfox`를 구현하거나 디버깅할 때 제작 가이드와 함께 참고하세요. 완전한 예제는 CLI 문서 테스트로 검증합니다.
