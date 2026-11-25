# 첫 에셋 만들기

아이템 하나를 만들고 모델을 관찰한 뒤 작은 변경을 해보세요. 워크스페이스 설정은 필요 없습니다. [Ashfox 설치](install.md) 후 [스타터 ZIP](/downloads/starter.zip)을 내려받아 압축을 풀고, 원본이 있는 폴더에서 명령을 실행하세요.

## 1. 아이템 PNG 만들기

{{source-code:0}}

이미지 뷰어로 `dist/iron_sword/exports/` 아래에 생성된 PNG(`iron_sword.png`)를 여세요. 바로 이미지 에셋으로 쓸 수 있는 투명한 16×16 아이템입니다. 이 단계에는 브라우저나 오디오 인코더가 필요 없습니다.

![체크무늬 배경 위에 확대한 철검](/media/guides/sword.png)

위 이미지는 확대 미리보기이며 원래 출력은 16×16입니다. `sword.ashfox`는 `../module/shared.ashfox`를 가져오므로 표준 `assets/` 레이아웃을 함께 보관하세요.

## 2. 원하는 각도에서 보기

Chrome 또는 Chromium이 설치되어 있다면 `fox.ashfox`에 이름 붙은 `preview` 블록을 선언하고 `--view`로 렌더링하세요.

{{source-code:1}}

![방위각 45도, 고도 20도에서 캡처한 여우](/media/guides/fox-angle.png)

선택한 시점의 PNG와 애니메이션 GIF가 생성됩니다. 이 명령은 빌드 디렉터리를 만들거나 상위 워크스페이스를 읽지 않습니다. `--output`을 생략하면 파이프나 프로세스 API로 바이트를 받을 수 있습니다. [에셋 관찰](observe.md)을 참고하세요.

## 3. 한 가지 바꿔보기

파일과 명령에 접근할 수 있는 에이전트에게 요청하세요.

```text
실루엣과 크기를 유지하면서 검날을 더 밝게 만들어라.
sword.ashfox와 가져오는 shared.ashfox를 읽고 원본만 편집해라.
원래 크기와 확대 상태(preview)를 검사하고 캡처해라.
다시 빌드하고 무엇이 바뀌었는지 설명해라.
```

텍스트 편집기로 직접 원본을 고칠 수도 있습니다. 새 파일명으로 다시 출력·캡처하세요. `--output`은 기존 파일을 덮어쓰지 않습니다. 결과를 비교하고 원하는 원본 버전을 보관합니다. 컴파일 성공이 이미지를 보거나 소리를 듣는 과정을 대신하지는 않습니다.

## 4. 다음 작업 선택하기

- [모델 만들기](models.md), [아이템 그리기](sprites.md), [사운드 만들기](sounds.md).
- stdin/JSON 메모리 입력을 포함한 [렌더링과 확인](observe.md).
- [웹 게임에서 에셋 실행](web-game.md).
- [Minecraft 리소스 팩 빌드](minecraft-packs.md).
- 공통 출력 규칙이 필요할 때 [여러 에셋 관리](workspace.md).
