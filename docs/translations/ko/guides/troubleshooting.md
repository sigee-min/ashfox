# 문제 해결

프로젝트 명령은 JSON 응답의 `diagnostics[].code`와 `message`를 반환합니다. 단일 에셋 명령은 stderr로 JSON 오류를, stdio 세션은 `error.code`·`error.message`가 있는 `ok: false` 응답을 반환합니다. 종료 코드가 0이 아니면 새 빌드를 성공한 결과로 사용하면 안 됩니다. 발행 실패 시 이전 선택 빌드는 보존합니다.

| 증상·코드 | 조치 |
| --- | --- |
| `cli.arguments` | 프로젝트 명령 `check`, `build`, `verify`, `capabilities`의 플래그는 `--json`만 지원. 관찰 옵션은 [캡처](observe.md) 참고 |
| `workspace.config` | 표시된 필드 수정. 루트는 필수 package·build·export와 선택 `packs`를 갖는 정확한 버전 2 설정이며 알 수 없는 필드는 실패 |
| 예상하지 않은 에셋 빌드 | check·build는 상위 `.ashfoxworkspace`의 전체 프로젝트 선택. 독립 관찰·export는 명시 입력만 선택. 파일을 명시하거나 독립 진입점을 설정 범위 밖에 배치 |
| 누락·미등록 원본이나 모듈 | 선택된 원본과 도달 가능한 모듈 등록, include·ignore·상대 import 수정 |
| `source.import` / `source.cycle` | 모듈 경로와 순환 수정. 독립 import는 진입점 디렉터리를 벗어날 수 없음 |
| `source.symlink` / `source.path` | 일반 파일과 정규화된 상대 경로 사용. 심볼릭 링크·상위 이동 거부 |
| `source.changed` | 컴파일 중 소스 변경. 편집을 마치고 새 빌드 시작 |
| `pack.source` / 알 수 없는 사운드 변형 | 호환되는 기존 export와 실제 변형 ID 참조. 원본의 `variants` 확인 |
| `pack.collision` | 같은 파일을 내는 연결 또는 파일·폴더 충돌. ID·경로를 구분하거나 중복 제거 |
| `audio.encoder` | libvorbis 포함 FFmpeg 설치 또는 `ASHFOX_FFMPEG_PATH` 수정. 폴더가 아닌 실행 파일 지정 |
| `audio.clipping` | 원본 피크 상한을 낮추고 재빌드. OGG는 WAV 피크를 넘을 수 있음 |
| `audio.timeout` / `build.timeout` | 작업 축소 또는 멈춘 인코더 조사. 생성 영수증을 편집해 제한을 늘리지 말 것 |
| 쓰기 충돌 / 종료 4 | 다른 작업 대기. 독립 작업은 겹치지 않는 대상 사용 |
| 소유하지 않은 대상 | 새 빈 출력 폴더 선택. 관련 없는 기존 내용은 덮어쓰지 않음 |
| `output.integrity` | 생성 파일 누락·변경·추가. 새 소유 대상에 재빌드하고 손상을 숨기려고 해시를 고치지 말 것 |
| 출력이 오래되어 보임 | 시각상 최신 폴더가 아닌 반환된 불변 디렉터리 또는 `current.json` 사용 |

## 모델 대상이 에셋을 거부하는 경우

`check`는 원본을, `build`는 대상 포맷도 검증합니다. Java block은 애니메이션을 거부하고 액터 대상에는 제작용 idle 클립이 필요합니다. 일반 GLB 장면은 정적일 수 있습니다. 대상 오류를 읽고 미지원 기능이 자동 제거될 것이라 가정하지 마세요. [출력 선택](choose-a-format.md)을 참고하세요.

## 임포트 결과가 이상한 경우

- **GLB 로드 실패:** portable 인코딩을 쓰거나 매니페스트의 모든 `requiredExtensions`를 임포터에서 지원하세요.
- **모델 크기 오류:** 원본 치수와 임포터 단위 변환을 확인하세요. `unitsPerMeter`는 추가 크기가 이미 적용된 결과가 아닌 힌트이며 한 번 적용합니다.
- **흐린 스프라이트:** 엔진에서 필터와 단위당 픽셀 설정을 적용하세요.
- **Minecraft 이미지 누락:** namespace·아이템 ID·아이템 정의 형태·팩 포맷 메타데이터를 확인하세요. 메타데이터만으로 새 아이템을 등록하지 않습니다.
- **소리 누락:** 실제 OGG·WAV 경로와 변형·이벤트 매핑을 확인하세요. 생성 정의가 게임 동작에 자동 연결되지는 않습니다.

## 중단된 쓰기 작업 복구

각 출력의 `.writer/owner.json`을 확인하세요. 기록된 프로세스가 종료된 것을 확인한 뒤 버려진 `.writer` 디렉터리를 제거합니다. 실행 중인 작업의 잠금은 제거하지 마세요. 다시 `build`하면 기존 불변 결과를 검증한 뒤 사용합니다. 확실하지 않다면 새 출력 디렉터리를 선택하세요.

## 재현 가능한 문제 보고

CLI 명령, 진단 JSON, 컴파일러·Node 버전, 관련 원본·설정, OGG 사용 시 FFmpeg 버전을 포함합니다. 대상 엔진·임포터와 정확히 실패한 에셋 ID를 알려주세요. 자격 증명과 관련 없는 프로젝트 파일은 제외합니다.

캡처 실패는 `ASHFOX_CHROME_PATH`, 알 수 없는 클립·노드·변형 ID, [관찰 가이드](observe.md)의 미디어 예산을 확인합니다. 오류는 stderr로 보내 stdout에 오류 텍스트가 섞이지 않습니다. 세션 load 실패·취소는 이전 리비전을 유지하므로 `source`를 읽고 그 `expectedRevision`으로 다시 시도하세요.
