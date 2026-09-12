# Model Workbench API

모델 Workbench를 제어하는 에이전트용 레퍼런스입니다. 네이티브 CLI 파이프라인과 별개이며 브라우저 프로젝트 다운로드는 루트 `.ashfoxworkspace` 설정이 아닙니다. 원본 파일·자동 게임 빌드는 [CLI 에이전트 흐름](agent-workflow.md)을 사용하세요. Workbench는 디렉터리 프로젝트를 열거나 스프라이트·사운드 팩을 빌드하지 않습니다. 기본 접속은 `https://ashfox.io/workbench/`이며 직접 HTTP로 `agent-manifest.json`을 받습니다. 사용자가 개발 Workbench를 명시하면 그 origin의 매니페스트·참고 파일을 사용합니다. 문서를 읽으려고 작업 브라우저를 앱 밖으로 이동하지 마세요.

아래 API는 연결된 페이지의 `window.ashfox`입니다. 도구가 페이지 JavaScript를 평가할 수 있으면 이 API를, 없으면 아래 전송 전용 DOM 브리지를 사용합니다. 원본 복원이나 우회를 위해 비공개 앱 상태·IndexedDB·렌더 DOM에 접근하지 마세요.

## 제한된 브라우저 도구용 전송 방식

JavaScript 평가는 못 하지만 locator 입력·속성 읽기가 가능한 도구를 위해 숨은 입력과 결과 meta를 제공합니다.

- 입력: `[data-agent-command-port-input]`
- 결과: `meta[data-agent-command-port-result]`의 JSON 속성 `data-agent-command-port-result`

한 번에 바깥 envelope 하나를 보냅니다.

{{source-code:0}}

`run`의 `payload`에는 `operations`만 넣습니다. 브리지는 바깥 `requestId`를 사용하므로 payload 안에 또 넣지 마세요. 결과 속성은 `{requestId, result}`이며 바깥 ID와 맞는 결과를 기다립니다. 이전 결과로 새 요청을 완료하지 마세요. locator `fill`의 input 이벤트가 제출하며 브리지는 입력을 제거하고 교체하므로 호출마다 locator를 다시 찾고 순차 실행합니다.

제한된 대기를 포함한 완전한 locator 형태입니다.

{{source-code:1}}

두 전송 선택자만 DOM 예외입니다. 다른 DOM·canvas·소스·IndexedDB·브라우저 저장소로 상태를 복원하거나 에셋을 작성하지 마세요.

## 편집 계약

원본을 작성하고 필요하면 전체 워크스페이스 manifest를 교체합니다. 엔진이 로컬 lock 해시·핀을 재생성하므로 `changes.lock`은 거부합니다. 내장 CAS 패키지는 불변입니다. 저장 파일을 열 때는 유효한 lock이 필요하며 편집 명령으로 호환되지 않는 저장 파일을 복구할 수 없습니다.

## 1. 식별자 검사와 원본 탐색

`ashfox.inspect()`에서 `ok === true`를 확인합니다. `data`에는 `entry`, `workspaceHash`, `revision`, `build.buildKey`가 있습니다. 개요의 `data.workflow`는 `stage`, `remainingVisualReviews`, `remainingVisualReviewCount`, `visualReviewsTruncated`를 제공하고 `data.blocker`·`data.nextActions`는 실제 막힌 원인과 다음 단계를 안내합니다. 리뷰 키 목록은 제한되므로 개수·플래그로 추가 `present({review:'next'})`가 필요한지 판단합니다. 읽기 전용 요청은 관련 증거를 모아 설명한 뒤 끝냅니다.

경로를 추측하지 말고 탐색하세요.

{{source-code:2}}

`data.catalog.files`는 경로·내용 해시·코드 단위 길이·소유 패키지·선언 종류·로컬/CAS 여부를 나타냅니다. `nextOffset`이 null이 될 때까지 따라가며 응답이 크면 `limit`을 낮춥니다.

패키지 변경을 계획할 때 현재 설정을 청크로 읽습니다.

{{source-code:3}}

`document: 'lock'`은 의존성 증거용이며 편집 payload가 아닙니다. `data.documentChunk`의 `content`를 순서대로 합치고 `done`이 true일 때만 완전한 JSON을 파싱합니다. 오프셋은 바이트가 아닌 JavaScript `.length`(UTF-16 코드 단위)로 증가시킵니다. guard가 오래되면 다시 읽으세요.

알고 있는 경로 하나로 원본을 읽습니다.

{{source-code:4}}

워크스페이스 검사에는 `catalog`, `document`, `read`, `candidate` 중 정확히 하나만 사용합니다. 원본은 `data.sourceChunk`, 메타데이터는 `data.documentChunk`이며 정확한 해시·오프셋을 포함합니다. 읽기 전용입니다. 청크는 1–2048 코드 단위, 카탈로그 페이지는 1–32개입니다.

## 2. 원본 소유 위치 선택

선언 문법은 [언어 가이드](../language/model.md), 완전한 모델은 [정밀 모델링](precision-modeling.md)을 보세요. 요약 문장으로 바인딩·아틀라스·motion 문법을 만들어내지 마세요.

기존 모델은 현재 revision·workspace·build guard로 정식 노드 ID와 관련 형상·면 UV를 검사합니다. 사용자가 바꾸지 않는 한 실루엣·팔레트·고정 크기 주요 무늬·픽셀 밀도를 유지합니다. 측정은 정지 포즈의 전체 primitive이며 눈에 보이는 접촉이나 동작 여유 공간을 인증하지 않습니다.

공유 치수는 design, 형상은 component, 픽셀은 surface를 선택합니다. 파일 하나 교체에 전체 워크스페이스 복사는 필요 없습니다. 선언 파일 추가·제거에는 같은 변경 세트에 갱신한 전체 manifest가 필요합니다. 모든 모듈은 최소 한 진입점에서 도달 가능해야 합니다.

## 3. 후보 준비와 검사

낯선 쓰기를 만들기 전 현재 `workspace.apply` 스키마를 받습니다. 최소 편집 형태는 다음과 같습니다.

{{source-code:5}}

`entry`는 명시적 `{ packageName, entryName }`이고 `source`는 패치가 아닌 완전한 교체 파일입니다. 파일별 선택적 `expectedHash`는 workspace 해시를 보충하지만 대체하지 않습니다. 전체 설정 교체에만 `manifest`를 넣고 `lock`은 넣지 마세요.

`preview.ok`는 검사 요청 성공, `preview.data.valid`는 워크스페이스·의미 검사 통과이므로 둘 다 확인합니다. 유효하면 `previewToken`을 제공합니다. 무효면 활성 프로젝트를 바꾸지 않고 진단만 반환하며 쓸 수 있는 토큰은 없습니다. 후보 검사는 뷰포트를 전환하지 않습니다. 제한된 세션 캐시는 정확한 기반 빌드에 토큰을 연결하므로 기반 변경·캐시 퇴출 시 다시 준비합니다.

`await ashfox.present({review:'preview',previewToken})`로 렌더 결과를 보세요. 미리보기는 승인된 전달 리뷰가 아닙니다. 틀리면 소스를 고쳐 다시 준비합니다. 컴파일만 됐다고 적용하지 마세요. 이후 전달 프레젠테이션도 현재 정식 문서를 명시적으로 선택하고 그 문서에서 렌더한 증거를 기다립니다.

## 4. 검사한 편집 그대로 적용

후보 확인 후 같은 `entry`와 `changes`를 제출합니다.

{{source-code:6}}

새 논리 편집마다 고유 요청 ID를 쓰고 작업은 정확히 하나만 제출합니다. 엔진은 로컬 레코드를 다시 봉인하고 모든 진입점을 검증한 뒤 원자적으로 커밋합니다. 진입점 실패·고립 모듈·오래된 guard·잘못된 원본·CAS 수정은 현재 상태를 보존합니다. previewToken은 변경 권한이 아니며 `run`에 넣지 않습니다.

실패 시 결과와 최신 상태를 검사한 뒤 수정·재시도를 결정하세요. 무작정 재제출하거나 검사를 느슨하게 하거나 파생 형상을 바꾸지 마세요. 검사 메타데이터는 증거이며 외부 의존성 수정 권한이 아닙니다.

## 5. 검증과 리뷰

성공 후 새 개요와 현재 노드 ID를 얻고 영향받은 치수·UV를 다시 읽습니다. 이전 guard·리뷰 자료는 오래된 상태입니다.

`present({review:'next'})`로 perspective·native·front·left·right·top과 모든 동작 주기를 확인합니다. 좌우는 forward 기준이며 각각 별도 렌더 증거가 필요합니다. `side`는 거부합니다. 의도적 비대칭을 허용하며 양쪽 주요 무늬를 비교하세요. 실제 렌더를 본 뒤 반환 `frameNonce`와 검사 ID를 승인합니다. 거부한 리뷰는 새 소스 리비전이 필요합니다. 승인 후 Build 리플레이를 생성하고 전달 요청 시 선택한 export 대상의 사전 검사를 한 뒤 사용자에게 출력하도록 합니다. 사전 검사는 출력 아티팩트가 아니며 측정도 시각적 승인이 아닙니다.

## 실패 시 다음 단계

| 실패 | 다음 조치 |
| --- | --- |
| 오래된 읽기·쓰기 | 식별자를 갱신하고 관련 원본 다시 읽기·준비 |
| 알 수 없는 `lock` | 폐기된 편집 필드 제거. 로컬 재봉인은 엔진 책임 |
| 무효 후보 | 요청 envelope 성공이어도 진단 확인 |
| 큰 소스·메타데이터 응답 | 청크를 줄이고 합친 뒤 파싱 |
| 큰 카탈로그 응답 | 페이지 크기를 줄이고 `nextOffset` 따라가기 |
| CAS 수정·패키지 충돌 | 외부 패키지 불변 유지, 명시적 로컬 설계 사용 |
| 저장 파일 lock 오류 | 원본 보존. 편집 재봉인을 복구 리더로 쓰지 않기 |
| 렌더링 불가 | 빠진 증거 보고. 보지 못한 리뷰 승인 금지 |
