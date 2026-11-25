# 에셋 하나 렌더링하고 확인하기

CLI를 헤드리스 에셋 컴파일러·렌더러로 사용하세요. 모델·아이템·사운드·기존 PNG 하나를 불러와 `check`로 식별자와 감사 점수를 확인하고, `render`로 시점·애니메이션을 렌더링하며, `export`로 최종 바이너리를 출력합니다.

## 첫 렌더링과 확인

[CLI 설치](install.md) 후 압축을 푼 스타터 폴더에서 실행합니다.

{{source-code:0}}

`render`는 stdout(또는 `--output <file>`)에 PNG 바이트를, `check`는 원본 요약·노드·텍스처·애니메이션·정량 품질 `audit` 지표가 담긴 `ashfox-cli-result` JSON을 씁니다. 브라우저 창을 직접 조작할 필요는 없습니다. 렌더링에는 Chrome·Chromium이 필요하며 표준 위치가 아니면 `ASHFOX_CHROME_PATH`를 설정합니다. 잘못된 경로를 명시하면 실패합니다. 컴파일·확인·감사·`export`에는 Chrome이 필요 없습니다.

렌더러는 Ashfox 공통 렌더링 라이브러리의 장면 투영, 카메라 프리셋, 재질 규칙, 애니메이션 샘플링을 사용합니다. 임시 프로필을 쓰는 비공개 헤드리스 프로세스를 시작하며 정상 정리 시 프로필을 제거합니다. 단일 에셋 `check`, `render`, `export`는 암묵적 워크스페이스나 에셋 디렉터리를 만들지 않습니다.

## 메모리 입력 (stdin 및 JSON)

`check`, `render`, `export`는 `--stdin` 또는 `--input-json`을 사용하면 디스크에 쓰지 않고 메모리에서 입력을 읽을 수 있습니다.

{{source-code:1}}

상대 import가 포함된 메모리 소스를 파이프할 때는 `{ "name": "main.ashfox", "source": "...", "files": { ... } }` 형태로 `--input-json`을 전달하세요. 기존 `--output` 경로는 덮어쓰지 않고 거부(`wx`)됩니다.

## 볼 내용 선택하기

{{source-code:2}}

반복 실행에는 새 파일명을 사용하세요. 실제 노드·텍스처·클립·변형 ID는 `check`로 찾으며 클립과 텍스처에는 이름도 허용합니다. 사운드 렌더링은 피크 포락선 파형이며 재생 가능한 WAV는 `export`로 받습니다. 스프라이트 확인은 영수증과 픽셀별 소유권 증거를, 모델 확인은 노드·텍스처 메타데이터·애니메이션 채널·설정과 내장 정량 `audit` 보고서를 반환합니다(`--profile creature|prop|block`, `--threshold 0..100` 지원, 단일 에셋 플래그는 상위 `.ashfoxworkspace`를 우회). `check --node NODE_ID`는 정지 포즈 하위 트리 치수와 면·UV 검사를 추가합니다.

| 옵션 | 허용값과 동작 |
| --- | --- |
| `--camera` | 기본 `perspective`, `native`, `front`, `back`, `left`, `right`, `top`, `bottom`. 방향 프리셋은 작성한 forward를 따름 |
| `--sheet` | 정지 `render`용 2×2 컨택트 시트 `turnaround`(`FRONT`, `3/4`, `SIDE`, `BACK`) 또는 `inspect`(`3/4`, `FRONT`, `WIRE+RIG`, `TOP`) |
| `--azimuth`, `--elevation` | 도 단위 −360…360, −89…89. 모델 축 기준으로 0°는 음의 Z, +90°는 양의 X에서 바라봄. 고도는 XZ 평면 위 각도 |
| `--zoom` | 0.1…10, 기본 1. 1보다 크면 가까워지고 잘릴 수 있음 |
| `--width`, `--height` | 정수 16…2048, 모델·파형 기본 640×360 |
| `--environment` | `studio`, `day`, `evening`, `night` |
| `--background` | `environment`, `transparent`, `checker`, `light`, `dark`. PNG·스프라이트 기본은 투명 유지 |
| `--clip`, `--time` | 클립 ID·이름과 초. 0 아닌 시간에는 클립이 필요하고 클립 길이를 넘을 수 없음 |
| `--wireframe`, `--skeleton`, `--no-textures` | 모델 검사 오버레이와 중립 형상 |
| `--node` | 모델 노드 ID. `render`는 하위 트리만 격리, `check`는 치수 측정 |
| `--texture` | 모델 텍스처 아틀라스 하나를 PNG로 렌더링 |
| `--scale` | 스프라이트·PNG·아틀라스 정수 1…32, nearest 확대, 최대 4096×4096 |
| `--stage` | 스프라이트의 `final`, `silhouette`, `shade`, `grain` |
| `--variant` | 사운드 변형 ID, 기본은 첫 컴파일 변형 |
| `--gif` | 애니메이션 GIF 렌더링(`--clip`, `--mode turntable`, `--mode build`) |

궤도 옵션은 카메라 프리셋 방향보다 우선합니다. 둘 중 하나를 지정하면 생략한 방위각·고도의 기본값은 45°·20°입니다. 모델·파형 크기와 PNG 확대는 별도 제어입니다. 카메라 옵션은 원본 형상을 변환하지 않습니다.

## 동작 또는 빌드 GIF 렌더링

{{source-code:3}}

동작·턴테이블 GIF 렌더링은 `--fps` 1…30(기본 10), `--duration` 0.01…30초, 카메라·렌더 크기를 받습니다. 동작의 기본 길이는 클립 길이이고 클립 없는 턴테이블은 3초입니다. `--time`에서 시작해 클립 끝에서 순환합니다. 프레이밍은 매 프레임을 쫓지 않고 샘플 포즈 전체에서 유지됩니다. 최대 300프레임·1억 렌더 픽셀이므로 넘으면 해상도·길이·프레임률을 줄이세요.

빌드 리플레이는 브라우저의 정식 재구성 방식으로 형상, 텍스처, 가능한 idle, 완성 순서를 보여줍니다. **편집 이력 녹화가 아닙니다.** 고정 640×360·10fps이며 브라우저의 perspective·native·front·left·right·top 프리셋과 환경을 지원합니다. 사용자 궤도·타이밍·오버레이·`--sheet`·프레이밍 옵션은 거부합니다.

## 선택한 에셋 출력하기

{{source-code:4}}

기본값은 모델의 portable GLB, 스프라이트의 네이티브 PNG, 사운드의 WAV입니다. 모델 `--format`은 `glb`, `gltf`, `java_block`, `geckolib5`, `bedrock`을 받습니다. Minecraft 포맷에는 `--namespace`가 필요하며 `--model-path`로 기본 진입점 이름을 바꿉니다. 다중 파일은 ZIP, GLB는 원시 GLB로 반환합니다. 모델 전달에는 작성된 `settings.profile`과 감사 게이트(`score >= 75`) 통과가 필요합니다. 여러 에셋 게임 번들과 사운드 팩에는 [프로젝트 빌드](workspace.md)를 사용하세요.

## 실제 시점 비교하기

![여우 정면](/media/guides/fox-front.png)
![회전한 시점의 여우](/media/guides/fox-angle.png)

같은 원본의 렌더링입니다. 카메라는 관찰만 바꾸며 출력 형상을 바꾸지 않습니다. 에셋 변경 시 시점과 동작을 활용하는 방법은 [리뷰와 개선](authoring-and-review.md)을 참고하세요.
