# 효과음 만들기

사운드 원본은 노이즈·FM 음·발성 계열 레이어를 WAV 변형으로 합성합니다. 충돌, 이동, 울음 같은 짧은 효과에 사용하세요. WAV 컴파일에는 샘플·브라우저·외부 인코더가 필요 없고 OGG 전달에는 FFmpeg를 사용합니다.

## 완전한 사운드 빌드하기

다음 완전한 원본을 `wind.ashfox`로 저장하세요.

{{source-code:0}}

{{source-code:1}}

독립 폴더에서는 응답의 export 디렉터리 안에서 `wind/base.wav`를 찾습니다. 상위 워크스페이스가 있으면 소스 선택과 출력 경로가 달라집니다. [CLI 레퍼런스](cli.md)를 참고하세요.

## 소리 다듬기

예제 레코드의 모든 필드는 필수입니다. 숫자는 표의 단위를 사용하며 모델 문법과 달리 단위 접미사를 쓰지 않습니다.

| 필드 | 허용값과 효과 |
| --- | --- |
| `duration` | 0.05–5초 |
| `sampleRate` | 48000, 모노 PCM16 WAV 출력 |
| `seed` | 정수 1–4294967295, 재현 가능한 변형 |
| `layers` | 이름 있는 레이어 1–8개 |
| `variants` | 고유 `id`와 정수 `seed`를 갖는 레코드 1–8개 |
| `output.rmsDb` | 목표 음량 -48…-6 dBFS |
| `output.peakDb` | 피크 상한 -12…-1 dBFS, 필요하면 게인 감소 |
| 레이어 `start`, `duration` | 시작 >=0, 길이 >=0.02초, 전체 사운드 안에 포함 |
| 레이어 `gain` | 선형 0–2 |
| 레이어 `attack`, `release` | 각각 >=0.002초, 합이 레이어 길이 이내 |
| 레이어 `highpass`, `lowpass` | 10–10000 Hz, 20–16000 Hz, highpass < lowpass |

사운드 ID는 `[a-z][a-z0-9_-]{0,63}`, 레이어·변형 ID는 `[a-z][a-z0-9_]{0,31}`입니다. 워크스페이스 export ID는 그 설정의 더 짧은 이름 규칙을 따릅니다. 원본마다 `sound` 선언 하나를 가집니다.

## 소스 종류 선택하기

| 종류 | 필수 source 필드 |
| --- | --- |
| `noise` | `kind`만 필요 |
| `fm` | `kind`, `pitch`의 40–3000 Hz 양 끝값, `sweepSeconds` 0.02–5, `ratio` 0.25–4, `index` 0–4, `vibratoHz` 0–25, `vibratoCents` 0–100 |
| `vocal` | `kind`, `pitch`의 50–1200 Hz 양 끝값, `sweepSeconds` 0.02–5, `formants` 3개 각 150–7000 Hz, `bandwidths` 3개 각 40–1500 Hz, `breath`·`jitter`·`roughness` 각각 0–1 |
| `chirp` | `kind`, `contour` (레이어 길이의 0–1을 잇는 증가하는 `{ at, hz }` 지점 2–12개, 500–8000 Hz), `trillHz` 0–100, `trillCents` 0–300, `trillDepth` 0–1, `breath` 0–0.2, `jitterCents` 0–80, `brightness` 0–1 |

충돌에는 빠르게 사라지는 짧은 노이즈, 이동에는 형태를 잡은 긴 노이즈, 음정 상세에는 유음 레이어를 씁니다. 음절은 별도 레이어에 배치하세요. 순수 FM은 노이즈가 없어 seed만 바꿔도 소리가 같을 수 있습니다. 동물 예제 이름은 설계 의도이며 생물학적 사실성을 검증한 뜻이 아닙니다.

[claw-hit 원본](../../examples/sounds/src/claw_hit.ashfox)은 완전한 다층 예제입니다. `examples/sounds/src`의 모든 원본은 같은 네이티브 언어를 사용합니다.

[새소리 원본](../../examples/sounds/src/bird_call.ashfox)은 `chirp`로 부드러운 음높이 곡선, 음높이와 진폭이 함께 떨리는 트릴, 작은 숨소리를 합성합니다. `contour`의 `at`은 해당 레이어 길이에 대한 비율이고 음높이는 로그 주파수에서 부드럽게 보간합니다. seed는 노이즈뿐 아니라 음높이 편차와 부드러운 흔들림에도 영향을 줍니다. 배음은 나이퀴스트 주파수에 닿기 전에 줄어듭니다. 사운드 루트와 네이티브 헤더는 그대로입니다.

## 전달하고 듣기

원본 출력은 WAV를 사용합니다. 일반 게임 팩의 `audio: ogg` 또는 Minecraft 사운드 연결로 OGG를 만듭니다. 먼저 [FFmpeg](install.md#choose-optional-tools)를 설치하세요. Minecraft 연결은 변형·가중치·음량·피치·스트리밍·선택 자막 키도 설정합니다. 일반 게임 번들은 게임에서 선택할 변형 목록을 제공하며, 어느 방식도 자동으로 전투나 애니메이션에 연결하지 않습니다.

모든 변형을 실제 게임 음량과 다른 효과음 사이에서 들어보세요. 인코딩 성공은 길이와 클리핑을 검사할 뿐 설득력 있는 소리인지는 판단하지 않습니다. 손실 인코딩이 상한을 넘으면 원본의 `peakDb`를 낮추세요.

{{source-code:2}}

WAV를 오디오 플레이어로 여세요. PNG는 재생 가능한 소리가 아닌 파형 관찰입니다. 다음 claw-hit 소리와 파형을 비교해 보세요.

<audio controls preload="none" src="/media/guides/claw.wav">발톱 타격음: <a href="/media/guides/claw.wav">WAV 다운로드</a></audio>

![발톱 타격음 피크 파형](/media/guides/claw-wave.png)
