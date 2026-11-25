# 에셋 에이전트와 작업하기

에이전트에게 네이티브 원본 폴더와 CLI 접근을 제공하세요. 모델·스프라이트·사운드 작성, 전달 설정, 빌드 실행, 정확한 출력 보고를 수행할 수 있습니다. 파일 기반 파이프라인에는 브라우저 연결이 필요하지 않습니다.

## 작업 프롬프트

```text
선택한 .ashfox 원본과 가져오는 모듈을 읽고 관련 없는 에셋은 보존해라.
단일 에셋이면 check로 확인하고 원본을 수정한 뒤 선언된 preview 뷰(--view)와 GIF를 render하고 build해라.
메모리 출력에는 --stdin이나 --input-json을 쓰고 선언한 출력 위치만 보고해라.
설정된 게임 전달 작업이면 워크스페이스의 check, build, check <build-dir>도 실행해라.
관찰한 결과와 대상 게임에서 아직 확인해야 하는 내용을 보고해라.
```

대상, 크기, 팔레트, 동작·사운드 의도, 전달 위치를 추가하세요.

## 작업 순서

1. 단일 에셋, stdin/JSON 메모리 그래프, 설정된 워크스페이스 빌드 중 [실행 방식](choose-a-format.md)을 선택합니다.
2. `ashfox check`로 식별자·선언(`outputs`/`previews`)·품질 감사 지표를 확인합니다. 단일 에셋 플래그(`--stdin`, `--input-json`)는 상위 워크스페이스를 무시하고, 워크스페이스 확인은 프로젝트 규칙과 표준 디렉터리 배치를 검증합니다.
3. `.ashfox` 소스 파일(`outputs`, `preview`)을 편집하거나 `--input-json`으로 전체 소스 그래프를 전달합니다.
4. `ashfox render <source> --view <name>`으로 시점·아틀라스·동작 GIF(`kind = gif;`)를 렌더링하고 `ashfox build` WAV 변형을 들어봅니다.
5. `ashfox build <source>`로 선택한 에셋을 빌드하거나 설정된 전달물에 `check`·`build`·`check <build-dir>`을 실행합니다.
6. 미디어나 출력 위치를 반환하고, 관찰된 결과와 아직 검증하지 않은 대상 게임 동작을 구분합니다.

## 전달 방식

소스 선택과 출력 규칙은 [프로젝트 설정](workspace.md)을 사용합니다. 런타임 ID와 임포트 힌트는 [게임 에셋](game-assets.md), 아이템·사운드 이벤트 매핑은 [Minecraft 팩](minecraft-packs.md)을 사용하세요. 포맷을 명시적으로 설정하고 버전 이름으로 호환성을 추측하지 마세요.

소스 파일을 직접 편집하거나 `--input-json`으로 전체 소스 그래프를 전달합니다. 프로젝트 `build`는 검증 후 완전한 출력을 발행합니다.

## 편집하며 관찰하기

편집 후 [단일 에셋 렌더링과 확인](observe.md)으로 `ashfox check` ID·선언·품질 점수를 확인하고, `preview` 블록으로 선언한 각도·텍스처·동작을 `ashfox render --view <name>`으로 확인합니다. 단일 에셋 명령은 워크스페이스 발행 없이 파일이나 `--stdin`/`--input-json`에서 바로 실행됩니다.
