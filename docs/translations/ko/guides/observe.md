# 에셋 하나 렌더링하고 확인하기

CLI를 통합 에셋 컴파일러·렌더러로 사용하세요. `.ashfox` 원본(모델·스프라이트·사운드·구조물) 하나를 불러와 `check`로 식별자·선언·감사 점수를 확인하고, `render [--view <name>]`로 선언된 `preview` 뷰를 렌더링하며, `build`로 선언된 대상을 빌드합니다.

## 첫 렌더링과 확인

[CLI 설치](install.md) 후 스타터 에셋에서 다음 명령을 실행합니다.

{{source-code:0}}

`render`는 stdout(또는 `--output <file>`)에 PNG 또는 GIF 바이트를, `check`는 원본 요약·선언(`outputs`, `previews`)·노드/텍스처/애니메이션/변형 정보와 정량 품질 `audit` 지표가 담긴 `ashfox-cli-result` JSON을 씁니다. 렌더링에는 Chrome·Chromium이 필요하며 표준 위치가 아니면 `ASHFOX_CHROME_PATH`를 설정합니다. 잘못된 경로를 명시하면 실패합니다. 컴파일·확인·감사·`build`에는 Chrome이 필요 없습니다.

렌더러는 Ashfox 공통 렌더링 라이브러리의 장면 투영, 카메라 프리셋, 재질 규칙, 애니메이션 샘플링을 사용합니다. 임시 프로필을 쓰는 비공개 헤드리스 프로세스를 시작하며 정상 정리 시 프로필을 제거합니다. 단일 에셋 `check`, `render`는 암묵적 워크스페이스나 에셋 디렉터리를 만들지 않습니다.

## 메모리 입력 (stdin 및 JSON)

`check`, `render`는 `--stdin` 또는 `--input-json`을 사용하면 디스크에 쓰지 않고 메모리에서 입력을 읽을 수 있습니다.

{{source-code:1}}

상대 import가 포함된 메모리 소스를 파이프할 때는 `{ "name": "main.ashfox", "source": "...", "files": { ... } }` 형태로 `--input-json`을 전달하세요. 기존 `--output` 경로는 덮어쓰지 않고 거부(`wx`)됩니다.

## `.ashfox`에 `preview` 뷰 선언하기

에셋별 CLI 플래그 대신 모든 `asset`, `sprite`, `sound`, `structure` 진입점 안에 이름 붙은 `preview` 블록을 선언하고 `--view <name>`(기본 `default`)으로 선택합니다.

{{source-code:2}}

{{source-code:3}}

반복 실행에는 새 파일명을 사용하세요. 사운드 `render`는 피크 포락선 파형이며 재생 가능한 WAV는 `build`로 생성합니다.

| `preview` 필드 | 허용값과 호환 에셋 |
| --- | --- |
| `kind` | `still` (기본 PNG) 또는 `gif` (애니메이션 GIF) |
| `camera` | `perspective`, `native`, `front`, `back`, `left`, `right`, `top`, `bottom` (모델·구조물) |
| `sheet` | 정지 렌더링 2×2 컨택트 시트 `turnaround` 또는 `inspect` (모델·구조물) |
| `azimuth`, `elevation`, `zoom` | 궤도 각도(`-360..360`, `-89..89`)와 줌(`0.1..10`) (모델·구조물) |
| `width`, `height` | 정수 `16..2048` (모델·구조물·파형 기본 `640x360`) |
| `environment`, `background` | `studio`/`day`/`evening`/`night`; `environment`/`transparent`/`checker`/`light`/`dark` |
| `clip`, `time` | 클립 ID·이름과 초 (모델) |
| `mode`, `fps`, `duration` | GIF 모드(`motion`, `turntable`, `build`), `fps` (`1..30`), `duration` (`0.01..30`) |
| `wireframe`, `skeleton`, `textures` | 모델 검사 오버레이 제어 불리언 |
| `texture` | 모델 텍스처 아틀라스 하나를 PNG로 렌더링 |
| `scale` | 스프라이트·아틀라스 정수 `1..32` 최근접 확대 |
| `stage` | 스프라이트 단계 `final`, `silhouette`, `shade`, `grain` |
| `variant` | 사운드 변형 ID (기본은 첫 컴파일 변형) |
| `cutaway` | 구조물 수평 단면 높이 Y (`1..64`) |

GIF는 최대 300프레임·1억 렌더 픽셀로 제한되며 빌드 리플레이는 고정 `640x360`·`10` fps입니다.

## `outputs` 선언하고 `build` 실행하기

{{source-code:4}}

{{source-code:5}}

원본 `outputs { ... }` 블록에 대상 포맷을 선언하세요(생략 시 기본값: 모델 portable GLB, 스프라이트 PNG, 사운드 WAV, 구조물 `java_structure` `.nbt` + `.glb`). 모델(`settings.profile` 필수)과 구조물은 품질 감사 게이트(`score >= 75`)를 통과해야 빌드할 수 있습니다. 여러 에셋 게임 번들과 사운드 팩에는 [프로젝트 빌드](workspace.md)를 사용하세요.

## 실제 시점 비교하기

![여우 정면](/media/guides/fox-front.png)
![회전한 시점의 여우](/media/guides/fox-angle.png)

같은 원본의 렌더링입니다. 프리뷰 설정은 관찰만 바꾸며 빌드된 형상·출력을 바꾸지 않습니다. 에셋 변경 시 시점과 동작을 활용하는 방법은 [리뷰와 개선](authoring-and-review.md)을 참고하세요.
