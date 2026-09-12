# Stdio와 메모리 작업 흐름

단일 결과는 원시 stdout, 지속 세션은 JSON-lines를 사용합니다. 파일 대신 완전한 원본 텍스트와 모듈 그래프를 메모리로 보낼 수 있습니다. CLI를 먼저 설치하세요. 다음 명령은 [스타터 에셋](install.md)을 사용합니다.

## 입력과 출력

{{source-code:0}}

파일명이 없고 stdin이 파이프로 연결되면 기본 입력은 네이티브 원본이며 `--stdin`으로 명시할 수 있습니다. 파일 입력은 진입점 아래에서 상대 import를 해석합니다. 메모리 원본은 형제 파일이나 현재 디렉터리를 읽지 않습니다. import에는 stdin의 다음 닫힌 객체와 `--input-json`을 사용하세요.

{{source-code:1}}

전송 형태를 보여주는 JSON이므로 생략된 문자열은 완전한 원본으로 바꾸세요. `name` 기본값은 `main.ashfox`이며 모든 모듈은 도달 가능해야 합니다. 절대 경로, 범위 밖 import, 중복 진입점 파일, 원격·패키지 import는 거부합니다. 세션도 같은 `input`을 받습니다. 파일은 `{ "file": "fox.ashfox" }`, 메모리 PNG는 `{ "png": "<base64 PNG>" }`로 선택합니다.

stdout에는 요청 결과만 들어갑니다. 진단은 stderr로 보내며 실패 시 부분 이미지 없이 0 아닌 코드로 종료합니다. TTY의 바이너리 출력은 거부하므로 파이프·리다이렉션·`--output`을 사용하세요. 셸 리다이렉션은 명령 실패 때도 파일을 만들 수 있으므로 소비 전에 종료 코드를 확인합니다.

Node에서 전체 결과를 메모리에 유지할 수 있습니다.

{{source-code:2}}

## 지속적인 stdio 세션 유지하기

`ashfox stdio`를 시작하고 줄마다 JSON 요청 하나를 보내며 JSON 응답 하나를 읽습니다. 요청 ID는 비어 있지 않은 문자열이고 대기 중 요청 사이에 고유해야 합니다. 최대 8개를 대기시킬 수 있습니다. 순서대로 실행하되 `cancel`은 현재 작업을 즉시 중단할 수 있습니다.

{{source-code:3}}

응답은 `format: ashfox-observer`, `version: 1`, 대응 `id`, `ok`, 그리고 `result` 또는 `error`의 `code`·`message`를 가집니다. 미디어는 원본 `revision`, `mime`, `encoding: base64`, `data`, `byteLength`, 원시 16진 SHA-256을 포함합니다. JSON-lines에 바이너리 프레임을 섞지 않습니다. 호스트에서 base64를 디코딩하면 출력 파일이 필요 없습니다.

| 메서드 | 매개변수 |
| --- | --- |
| `capabilities` | `{}`, 메서드·출력 종류·제한 조회 |
| `load` | 최초 `{input}`, 교체 시 `{input, expectedRevision}` |
| `source` | `{}`, 현재 원본 그래프와 리비전 |
| `inspect`, `capture`, `replay`, `export` | `{options?, expectedRevision?, reset?}`, CLI 플래그에 대응하는 camelCase JSON 옵션 |
| `view` | `{options?, reset?}`, 이후 작업에 보기 설정 유지 |
| `cancel` | 활성 요청의 `{id}`, `cancelled: true/false` 반환 |
| `close` | `{}`, 모델·렌더러 해제. 전송은 열린 채로 새 `load` 가능 |

`textures: false`는 `--no-textures`이며 불리언은 JSON 불리언입니다. `reset: true`는 기본 옵션에서 시작합니다. 작업 옵션은 일시적이고 `view`만 유지합니다. 이전 클립·노드·텍스처 선택을 지우려면 reset을 사용하세요. 성공한 load는 보기를 초기화하고 잘못된·오래된·취소된 load는 이전 에셋을 보존합니다. 캡처는 읽기 전용이며 승인 단계가 필요 없습니다.

편집은 전체 원본 그래프 교체입니다. `source`를 받고 프로세스 안에서 텍스트를 수정한 뒤 현재 `expectedRevision`으로 `load`합니다. 별도 형상·래스터 변경 API는 없습니다. 브라우저 파일 선택기·프로젝트 저장소·사람 리뷰 UI는 프로토콜 작업이 아닙니다. 모델 렌더러와 결정적인 빌드 리플레이는 브라우저와 같은 구현입니다.

EOF는 대기 요청을 처리한 뒤 자원을 해제합니다. SIGINT·SIGTERM은 취소 후 종료하지만 요청 단위 취소는 세션을 유지합니다. 컴파일 워커는 120초·V8 old-generation 힙 256 MiB, 렌더러 요청은 120초입니다. 미디어는 32 MiB, 입력 줄은 16 MiB로 제한됩니다. 브라우저 메모리는 컴파일러 힙과 별도입니다. Chrome·GPU 버전 간 이미지 바이트 일치를 보장하지 않으므로 회귀 검사는 렌더러 환경을 고정하세요.

## 완전한 클라이언트 실행하기

[Node 클라이언트](/downloads/stdio-client.zip)를 받아 `client.mjs`를 에셋 폴더의 `package.json` 옆에 푼 뒤 실행합니다.

{{source-code:4}}

바이너리 리다이렉션을 보존하는 셸을 쓰거나 자식 stdout을 바이트로 수집하세요. 클라이언트는 미디어를 Buffer로 유지하고 리다이렉션은 확인 편의용입니다. [플랫폼 안내](install.md#shells-and-binary-output)를 참고하세요.

클라이언트는 stdio 시작, 원본 load, 그래프 읽기, 예상 리비전으로 메모리 교체, 캡처·미디어 해시 검증, 정상 종료를 수행합니다. 샘플 편집은 줄바꿈 추가이므로 앱의 변경으로 바꾸세요. `--cancel-demo`는 요청 중단 후 재캡처해 복구를 보여줍니다. ID로 응답을 연결하고 오류는 해당 요청을, 프로세스 종료·시간 초과는 대기 작업을 거부합니다. 원본 파일에는 쓰지 않습니다.
