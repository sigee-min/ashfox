# CLI 레퍼런스

[설치](install.md) 후 사용하는 프로젝트에서 `ashfox`를 실행합니다. 예제는 모두 `npx --no-install`로 설치된 로컬 실행 파일을 사용합니다.

| 명령 | 입력 | 결과 |
| --- | --- | --- |
| `--help` / `help` | 없음 | 사람이 읽는 명령 안내 |
| `--version` | 없음 | 제품 버전 |
| `init <new-folder> [--json]` | 새 폴더 | 오프라인 표준 스타터 (`assets/{models,sprites,sounds,structures,module}/`) |
| `doctor [--json]` | 없음 | 실행 환경 준비 상태·기계 판독 계약 |
| `check <input> [options]` | `.ashfox` 진입점, `.ashfoxworkspace`, `.ashfoxworkspace.mjs` 또는 빌드 디렉터리 | 원본 검증·선언 검사·품질 감사 또는 빌드 무결성 검사 |
| `render <input> [options]` | `.ashfox` 원본 (`--stdin` / `--input-json` 지원) | 선언된 `preview [name]` 블록에서 렌더링한 PNG 또는 GIF |
| `build <input> [--json] [--bindings ts\|cs\|gd]` | `.ashfox` 진입점, `.ashfoxworkspace` 또는 `.ashfoxworkspace.mjs` | `outputs { ... }` 선언 또는 워크스페이스 출력, `<target>.hooks.json` 및 선택적 훅 바인딩 빌드 |

`doctor --json`, `check`, `build`는 JSON(`ashfox-cli-result`)을 반환합니다. 사람은 `help`, 에이전트는 `doctor --json`을 사용합니다. 출력·시점 정책은 `.ashfox` 선언(`outputs`, `preview`)이나 `.ashfoxworkspace`에 둡니다. `export`, `watch`, `clean`, 자동 게임 설치 명령은 없습니다.

## 첫 실행 명령

안정 CLI에는 도움말·버전·환경 확인·오프라인 스타터 생성이 포함됩니다.

{{source-code:0}}

CLI를 설치한 저장소에서 실행합니다. `init`은 새 폴더에 표준 `assets/{models,sprites,sounds,structures,module}/` 원본, `.ashfoxworkspace.mjs`, 게임 어댑터 `assets.mjs`, 루트 `build/`를 제외하는 `.gitignore`를 만듭니다. 부모 폴더는 있어야 합니다. 빈 폴더를 포함한 기존 폴더·파일·심볼릭 링크를 거부하며 기존 프로젝트를 병합·수정하지 않습니다. npm 패키지를 설치하거나 네트워크에 접속하지 않습니다. 쓰기 실패 시 새 불완전 폴더를 제거합니다. `init --json`은 디렉터리와 파일 목록을 보고합니다. 기본 오류는 stderr의 읽기 쉬운 문장이고 `doctor`·`init --json`의 성공·실패는 stdout의 프로젝트 응답 형식입니다.

`doctor`는 CLI·Node 버전, 내장 OGG 지원 상태, Chrome 실행 가능 여부를 보고합니다. 선택 도구 누락은 실패 종료가 아닙니다. `doctor --json`도 프로젝트 파일을 만들지 않습니다. 환경 검사이므로 실제 파이프라인은 캡처·OGG 빌드로 검증하세요. 명시한 실행 경로가 자동 탐색보다 우선합니다.

## 원본 하나 빌드하기

{{source-code:1}}

상위 `.ashfoxworkspace` 또는 `.ashfoxworkspace.mjs`가 있으면 전체 프로젝트를 빌드합니다. 진입점 하나를 선택해도 프로젝트 검사를 우회하지 않습니다. 탐색은 가장 가까운 Git 루트나 파일시스템 루트에서 멈추며 잘못된 설정은 무시하지 않고 실패합니다. 상위 워크스페이스가 없는 독립 원본은 진입점과 상대 import 의존성을 읽고, `outputs { ... }` 선언(기본값: 모델 GLB, 스프라이트 PNG, 사운드 WAV, 구조물 `.nbt`+`.glb`)을 빌드하여 진입점 기준 `dist/<entry-id>/build`·`dist/<entry-id>/exports`에 씁니다. 모듈은 빌드 진입점이 아닙니다.

## 프로젝트 빌드하기

{{source-code:2}}

`check <build-dir>`에는 export 디렉터리가 아닌 실제 `build.directory`를 사용합니다. 워크스페이스 `check`는 선언된 소스와 표준 디렉터리 배치(`assets/{models,sprites,sounds,structures,module}/`)를 함께 검증합니다. `check`는 OGG 인코딩을 실행하거나 대상 전달을 인증하지 않습니다. 출력 제약·파일 충돌·인코딩은 `build`로 확인하세요.

## 응답 읽기

프로젝트 응답에는 `format: ashfox-cli-result`, `version: 1`, `command`, `ok`, `diagnostics`, `result`가 있습니다. 실패 시 `result`는 `null`이며 진단의 `code`와 `message`를 읽습니다. 일부만 쓰였거나 비어 있는 stdout 파일을 성공으로 취급하지 마세요.

성공한 빌드는 `requestKey`, `bundleHash`, `bundlePath`, `catalogPath`, `exports: [{id, directory}]`를 제공합니다. 경로는 현재 머신의 실제 절대 경로이며 카탈로그 파일 경로는 `bundlePath` 기준 상대 경로입니다.

| 종료 코드 | 의미 |
| --- | --- |
| 0 | 성공 |
| 1 | 원본·컴파일러·선언된 빌드 검증 실패 |
| 2 | 잘못된 인자·설정 |
| 3 | I/O·인코더·내부·대상 출력·무결성 실패 |
| 4 | 다른 작업이 출력 잠금 소유 |
| 130 | 취소 |

0이 아니면 실패로 처리하고 진단에서 해결 방법을 찾으세요. 무작정 재시도하기보다 [문제 해결](troubleshooting.md)을 확인합니다.

## 실행 제한

export와 팩 연결에는 고정 개수 상한이 없습니다.

컴파일 워커의 제한은 120초와 V8 힙 256 MiB이며 전체 프로세스 메모리 제한은 아닙니다. 소스는 512개 파일·8 MiB, 탐색은 20,000개 항목, 설정은 256 KiB입니다. 팩마다 압축 전 최대 8,192개 파일·64 MiB를 허용합니다. 애니메이션 GIF 렌더링은 최대 300프레임·1억 렌더 픽셀로 제한됩니다.

SIGINT·SIGTERM은 진행 작업을 취소하고 이전 선택 빌드를 보존합니다. 취소 도착 시 마지막 동기 발행이 이미 끝났을 수 있습니다. 완료된 성공 발행은 롤백하지 않습니다.

## 미디어 뷰 렌더링

`render`는 단일 `.ashfox` 소스(파일, `--stdin`, `--input-json`)를 받아 소스에 선언된 `preview <name> { ... }` 뷰(`--view <name>`, 기본 `default`)를 렌더링하며 stdout이나 `--output <file>`에 바이트를, stderr에 JSON 오류를 씁니다.
선언 필드와 메모리 입력 예제는 [렌더링과 확인](observe.md)을 참고하세요.

| 명령 | 출력 | 오류 채널 |
| --- | --- | --- |
| `check` | JSON (`ashfox-cli-result`) | JSON 진단 또는 stderr |
| `render` | PNG 또는 GIF(`kind = gif;`) 바이트 | stderr JSON |
| `build` | 불변 번들 + 선언된 출력 | stdout JSON |

`render`는 `--json`과 에셋별 개별 플래그(`--camera`, `--gif`, `--cutaway` 등)를 거부합니다. [렌더링과 확인](observe.md)을 참고하세요.

## 코드형 프로젝트 설정

`check`·`build`는 `.ashfoxworkspace.mjs`와 소스 빌드의 상위 탐색을 지원합니다. 신뢰된 Node ESM을 기존 버전 2 계약으로 평가합니다. 새 `init <new-folder>`는 표준 `assets/{models,sprites,sounds,structures,module}/`, 이 설정, 게임 어댑터, 루트 `build/`용 `.gitignore`를 만듭니다. 평가 제한, 출력 식별자, JSON 설정 이전을 포함한 [전체 컨벤션](repository-layout.md)을 참고하세요.
