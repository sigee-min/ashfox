# 사운드 문법 레퍼런스

사운드는 같은 `ashfox-model 1` 헤더와 `sound name { … }` 단위 하나를 사용합니다. 모델 표현식이 아닌 리터럴 합성 레코드이며 import·샘플·design·사용자 함수·런타임 평가는 없습니다.

## 리터럴 문법

속성은 `name = value;`, 레코드는 `{ name = value; }`, 목록은 `[value, value]` 또는 `(value, value)`입니다. 문자열은 JSON 이스케이프, 숫자는 선택적 지수를 포함한 부호 있는 JSON식 소수이며 단위 접미사는 없습니다. 초·Hz는 속성이 정하므로 `0.5s`가 아닌 `0.5`를 씁니다. `//` 주석만 지원하며 중복·알 수 없는 필드는 실패합니다.

## 루트 레코드

아래 필드는 모두 필수입니다. 선언이 `id`, `format`, `version`을 제공하므로 본문에 반복하지 마세요.

| 필드 | 타입·범위 |
| --- | --- |
| `duration` | 0.05–5초 |
| `sampleRate` | 정확히 48000 |
| `seed` | 정수 1–4294967295 |
| `layers` | 고유 ID의 레코드 1–8개 |
| `variants` | 고유 ID의 `{ id = "base"; seed = 42; }` 레코드 1–8개 |
| `output` | `{ rmsDb = -22; peakDb = -3; }`, RMS -48…-6 dBFS, peak -12…-1 dBFS |

네이티브 단위 이름은 식별자이며 소문자·밑줄을 사용하세요. 레이어·변형 ID는 `[a-z][a-z0-9_]{0,31}`이고 변형 선택에는 레이어 ID가 아닌 변형 ID를 사용합니다.

## 레이어 레코드

| 필드 | 타입·범위 |
| --- | --- |
| `id` | 고유 레이어 ID |
| `source` | 아래 종류 구분 레코드 하나 |
| `start` | 음이 아닌 초 |
| `duration` | 최소 0.02초, `start + duration`이 전체 길이 안에 포함 |
| `gain` | 선형 진폭 0–2 |
| `attack`, `release` | 각각 최소 0.002초, 합이 레이어 길이 안에 포함 |
| `highpass` | 10–10000 Hz |
| `lowpass` | 20–16000 Hz, highpass보다 큼 |

모두 필수입니다. 레이어를 타임라인에 합성·혼합합니다. 출력은 피크 상한을 지키며 RMS 목표로 정규화하므로 피크 제한 때문에 목표 RMS에 못 미칠 수 있습니다. 무음 결과는 실패합니다.

## Source 레코드

각 종류의 모든 필드는 필수이고 다른 종류 필드는 유효하지 않습니다.

| `kind` | 필드 |
| --- | --- |
| `noise` | `kind`만 사용 |
| `fm` | `kind`, `pitch`, `sweepSeconds`, `ratio`, `index`, `vibratoHz`, `vibratoCents` |
| `chirp` | `kind`, `contour`, `trillHz`, `trillCents`, `trillDepth`, `breath`, `jitterCents`, `brightness` |
| `vocal` | `kind`, `pitch`, `sweepSeconds`, `formants`, `bandwidths`, `breath`, `jitter`, `roughness` |

| 매개변수 | 범위 |
| --- | --- |
| FM `pitch` | 각 40–3000 Hz의 양 끝값 |
| vocal `pitch` | 각 50–1200 Hz의 양 끝값 |
| `sweepSeconds` | 0.02–5초 |
| FM `ratio` | 0.25–4 |
| FM `index` | 0–4 |
| FM `vibratoHz` | 0–25 Hz |
| FM `vibratoCents` | 0–100센트 |
| vocal `formants` | 정확히 3개, 각 150–7000 Hz |
| vocal `bandwidths` | 정확히 3개, 각 40–1500 Hz |
| vocal `breath`, `jitter`, `roughness` | 각각 0–1 |
| Chirp `contour` | `{ at, hz }` 레코드 2–12개, `at`은 0부터 1까지 엄격히 증가, `hz`는 500–8000 |
| Chirp `trillHz`, `trillCents` | 0–100 Hz, 0–300센트, 0 Hz이면 트릴 비활성화 |
| Chirp `trillDepth`, `brightness` | 각각 0–1, 진폭 변조 깊이와 배음 강도 |
| Chirp `breath`, `jitterCents` | 노이즈 진폭 0–0.2, seed 기반 음높이 편차·흔들림 0–80센트 |

contour 위치는 레이어 길이의 비율이며 로그 음높이에서 부드럽게 연결됩니다. chirp는 버전 선택 없이 현재의 닫힌 source 계약 하나만 허용합니다.

## 완전한 FM 음

`ping.ashfox`로 저장하세요.

{{source-code:0}}

{{source-code:1}}

출력은 모노 PCM16 WAV입니다. seed는 확률적 레이어를 재현하며 순수 결정적 FM에서는 바꿔도 바이트가 같을 수 있습니다. OGG는 libvorbis 포함 FFmpeg가 필요한 별도 [전달 옵션](../guides/game-assets.md)입니다. 노이즈·레이어·파형·재생은 [사운드 제작과 청취](../guides/sounds.md)를 참고하세요.
