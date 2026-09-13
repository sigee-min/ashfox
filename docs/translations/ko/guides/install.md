# Ashfox 설치

Node.js 24 이상과 npm이 필요합니다. 계정이나 API 키는 필요하지 않습니다.

## 프로젝트에 설치하기

게임 또는 에셋 폴더에서 터미널을 열고 실행하세요.

{{source-code:0}}

두 번째 명령은 설치된 제품 버전을 출력합니다. 선택 도구인 Chrome·FFmpeg 지원 여부는 `npx --no-install ashfox doctor`로 확인합니다.

패키지는 완전한 CLI를 포함하며 macOS·Linux·Windows PowerShell에서 Node.js 24 이상으로 동작합니다. 기존 프로젝트에 설치하고 `package.json`을 유지하며 갱신된 잠금 파일을 커밋하세요.

## 첫 에셋 만들기

그룹형 스타터 프로젝트를 오프라인으로 생성하고 첫 아이템을 출력합니다.

{{source-code:1}}

`sword.png`를 이미지 뷰어에서 열거나 게임에 가져오세요. 코딩 에이전트로 `.ashfox` 원본을 편집한 뒤 새 파일명으로 출력합니다. 기존 출력 파일은 덮어쓰지 않습니다.

프로젝트에 `package.json`과 `package-lock.json`을 함께 커밋하세요. 가이드의 `npx --no-install ashfox`는 설치된 CLI를 실행하며 없을 때 다른 패키지를 받지 않습니다. URL은 GitHub 릴리스 하나의 CLI와 대응 스타터를 고정합니다. 다른 머신에서는 `npm ci`로 잠긴 버전을 복원합니다. 로컬 패키지도 보관하려면 아래 오프라인 방식을 쓰세요.

## 사용 가능한 명령

안정 CLI에는 도움말, 버전 출력, 환경 확인, 오프라인 스타터 생성이 포함됩니다.

## 오프라인 설치 또는 정확한 패키지 보관

위 설치 명령의 URL에서 CLI 패키지를 내려받고 프로젝트의 `tools/` 같은 위치에 보관한 뒤 해당 파일을 설치합니다.

{{source-code:2}}

압축파일과 잠금 파일을 함께 보관하세요. Node.js와 npm이 있는 다른 머신에서 `npm ci --offline`으로 로컬 압축파일을 사용해 복원할 수 있습니다. 다른 프로젝트 의존성에는 npm 캐시도 필요할 수 있습니다. 두 설치 방식 모두 npm 레지스트리 공개를 전제로 하지 않습니다.

## 설치가 실패하는 경우

- **`npm`을 찾지 못함:** npm을 포함한 Node.js를 설치하고 터미널을 다시 연 뒤 `node --version`과 `npm --version`을 확인하세요.
- **URL이 차단됨:** 브라우저에서 압축파일을 받거나 다른 머신에서 옮겨 오프라인 명령을 사용하세요.
- **`ashfox`가 없음:** 같은 프로젝트 폴더에서 설치한 뒤 위 설치 확인을 다시 실행하세요.
- **권한 거부:** 쓰기 가능한 프로젝트 폴더를 사용하세요. 전역 설치나 관리자 권한은 필요하지 않습니다.

## 선택 도구 고르기

| 작업 | 추가 도구 |
| --- | --- |
| 원본 검사, PNG·WAV·모델 출력, WAV 게임 팩 빌드 | 없음 |
| 이미지·아틀라스 상세·파형 캡처, GIF 리플레이 | Chrome 또는 Chromium |
| OGG 사운드나 사운드가 포함된 Minecraft 팩 빌드 | `libvorbis`를 포함한 FFmpeg |

운영체제의 일반 설치 프로그램이나 패키지 관리자로 설치하세요. Ashfox가 자동 설치하지 않습니다. Chrome을 미리 열 필요는 없으며 캡처에 FFmpeg는 필요하지 않습니다. 자동 탐색이 실패하면 실행 파일 경로를 설정하세요.

macOS/Linux:

{{source-code:3}}

Windows PowerShell:

{{source-code:4}}

디렉터리가 아닌 실행 파일 경로를 지정합니다. OGG를 요청하기 전에 `ffmpeg -encoders`에서 `libvorbis`를 확인하세요.

## 셸과 바이너리 출력

PNG·GIF·WAV·GLB·ZIP을 반환하는 명령은 stdout에 바이너리를 출력합니다. 파일로 저장하려면 `--output preview.png`를 사용하세요. 이전 Windows PowerShell을 포함해 셸의 바이너리 리다이렉션 동작에 의존하지 않습니다. 기존 파일은 거부하므로 새 파일명을 선택합니다. 메모리로 사용할 때는 [stdio와 메모리](stdio.md)처럼 Node 또는 다른 프로세스 API에서 바이트를 수집하세요.

## 설치 업그레이드와 재현

[GitHub Releases](https://github.com/sigee-min/ashfox/releases)에서 새 버전을 선택하고 정확한 CLI 에셋 URL로 설치합니다. 잠금 파일 변경을 리뷰하고 에셋을 다시 빌드해 외형을 비교한 뒤 채택하세요. 이전 의존성과 잠금 파일을 복원하고 `npm ci`를 실행하면 이전 버전으로 돌아갑니다. 오프라인 프로젝트는 각 압축파일을 버전별 로컬 폴더에 보관하세요. 이미지나 OGG 바이트 비교가 중요하면 Chrome·FFmpeg도 고정합니다.

[첫 에셋 만들기](ai-agent-quick-start.md)로 이어가세요.
