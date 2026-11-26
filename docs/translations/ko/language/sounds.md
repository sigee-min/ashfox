# 사운드 문법 레퍼런스

네이티브 사운드 파일은 `ashfox-model 1` 다음에 `sound name { … }`를 작성합니다. 속성은 리터럴 `name = value;` 레코드와 목록이며 샘플이나 런타임 표현식은 허용하지 않습니다.

## 루트 계약

모든 ID는 `[a-z][a-z0-9_]{0,31}` 형식을 따르며 소유 범위 내에서 고유합니다. 선택 표시가 없는 키는 필수이며 알 수 없거나 중복된 키는 실패합니다.

| 루트 필드 | 계약 |
| --- | --- |
| `profile` | `impact`, `foley`, `creature`, `magic`, `ui`, `ambient` |
| `duration` | 원본 합성 길이 `0.05..30`초 |
| `sampleRate` | 고정 `48000` |
| `channels` | 선택 `1` (모노, 기본값) 또는 `2` (스테레오) |
| `seed` | 정수 `1..4294967295` |
| `space` | 선택 FDN-8 잔향 `{ preset, mix, decay, damping, size, preDelayMs, width }` |
| `voices` | 1–16개 보이스 레코드 (각 보이스는 최소 1개 스텝에서 참조) |
| `sequences` | 1–32개 시퀀스 정의 |
| `variants` | 1–8개 `{ id, seed }` 레코드 |
| `playback` | `{ kind = "oneshot"; }` 또는 `{ kind = "loop"; start; end; crossfade; }` |
| `output` | `{ gainDb, peakDb }` + 선택 `targetLufs`, `punch`, `warmth`, `air`, `glue`, `width`, `limit` |

## 보이스, DSP 음원, 필터, 엔벨로프

보이스는 `{ id, source, gain }`과 선택 `highpass`, `lowpass`, `filter`, `drive` (`0..10`), `pan` (`-1..1`, `channels = 2` 필요)로 구성됩니다.

- **음원 (`source`)**:
  - `noise`: `{ kind = "noise"; color = "white" | "pink" | "brown"; }` (`crackle`과 `density`는 거부됨; `granular` 사용).
  - `material`: `{ kind = "material"; material; pitch; }` + 선택 `size` (`0.25..4`), `hardness` (`0..1`), `damping` (`0..1`), `brightness` (`0..1`), `modes` (`4..32`), `strike` (`"mallet" | "scrape" | "bounce"`), `bounces` (`1..6`, `strike = "bounce"` 필요). `material` 프리셋: `steel`, `iron`, `bronze`, `bell`, `wood`, `stone`, `glass`, `ceramic`, `bone`, `leather`; `pitch` `20..4000` Hz.
  - `granular`: `{ kind = "granular"; texture; density; }` + 선택 `grainMs` (`3..150`), `pitch` (`60..12000`), `spread` (`0..1`), `burstiness` (`0..1`), `turbulence` (`0..1`). `texture` 프리셋: `ember`, `gravel`, `water`, `foliage`, `wind`, `spark`, `bubble`; `density` `1..500` (선형 제어).
  - `osc`: `{ kind = "osc"; waveform = "sine" | "triangle" | "saw" | "square" | "pulse"; pitch; }` + 선택 `pulseWidth`, `unison` (`1..4`), `detuneCents` (`0..50`). PolyBLEP 안티앨리어싱.
  - `fm`: `{ kind = "fm"; pitch; ratio; index; vibratoHz; vibratoCents; }` (8배 오버샘플 위상 변조 FM).
  - `vocal`: `{ kind = "vocal"; pitch; formants; bandwidths; }` + 선택 `breath`, `jitter`, `roughness`, `growl`, `chest`, `nasal` (`0..1`). `formants` (`150..7000` Hz 제어 3–4개)와 `bandwidths` (`40..1500` Hz 스칼라 3–4개, 길이 일치).
  - `chirp`: `{ kind = "chirp"; pitch; brightness; trillHz; trillCents; trillDepth; breath; jitterCents; }`.
  - `resonator`: `{ kind = "resonator"; excitation; modes; }` + 선택 `pitchDropCents`, `pitchDropSeconds`. `excitation`은 `{ kind = "impulse"; }`, `{ kind = "noise"; duration; }`, `{ kind = "mallet"; duration; hardness; }` 지원.
- **필터**: `highpass` (`10..10000` Hz), `lowpass` (`20..18000` Hz), 또는 파라미터 Cytomic SVF `filter = { kind = "lowpass" | "highpass" | "bandpass" | "notch"; cutoff; q; }`.
- **곡선 및 엔벨로프**: 상수 또는 `{ domain = "linear" | "log"; interpolation = "linear" | "smooth"; points = [...]; }` 곡선(`2..16`점, 인접 간격 `>= 96`프레임). 보이스 `gain`은 축약 엔벨로프도 허용합니다:
  - `{ env = "ad"; attack; peak; curve; }` (`peak`, `curve` 선택)
  - `{ env = "adsr"; attack; decay; sustain; release; peak; curve; }`

## 시퀀스, 스텝, 변주, 공간

각 시퀀스는 `{ id, start, steps }`와 선택 `repeat`를 가집니다(`start` 기본 `0`, `repeat` 기본 `{ count = 1; period = 0; }`).
각 스텝은 `{ id, voice, at, duration }`과 선택 `gain` (`1`), `pitchCents` (`0`), `vary` (`timing`, `pitchCents`, `gain`, `duration`)를 가집니다. `noise` 스텝 및 `pitch`가 없는 `granular` 스텝의 피치 변주는 `0`이어야 합니다.

`space`는 8라인 아다마르 피드백 딜레이 네트워크를 적용하며 `preset` (`"dry_close" | "timber_room" | "stone_hall" | "small_chamber" | "courtyard" | "cavern" | "ethereal"`) 또는 최소 1개 파라미터(`mix` `0..0.7`, `decay` `0.03..3.0`초, `damping` `800..16000` Hz, `size` `0.2..3.0`, `preDelayMs` `0..80`, `width` `0..1.5`)가 필요합니다.

`output`은 마스터 버스를 구성합니다: `gainDb` (`-48..24`), `peakDb` (`-12..-0.5` dBFS), 선택 `targetLufs` (`-30..-6`), `punch` (`-1..1`), `warmth` (`-1..1`), `air` (`-1..1`), `glue` (`0..1`), `width` (`0..1.5`, `1`이 아니면 `channels = 2` 필요), 투명한 룩어헤드 리미팅 `limit = true` (`softClip`은 거부됨).

## 루프, 오딧, 전달

루프는 원본 합성에서 `[start, end)`를 잘라 smooth cosine/Hermite 겹침 `crossfade` (`96..min(48000, floor(L/4))` 프레임)를 굽고 `{ kind = "loop"; startFrame = 0; endFrame = frames; }`로 `L - X` 프레임을 전달합니다. 루프 OGG와 Minecraft 팩 루프 대상은 거부됩니다.

`ashfox check`는 음량 헤드룸(RMS/LUFS), DC 오프셋, 무음 비율, 어택 펀치, 2.5–5 kHz 거칠기, 스펙트럼 복잡도·밸런스·플럭스, 스테레오 위상 상관, 루프 연속성, 변형 차별성을 감사합니다(`build` 통과 기준 `score >= 75`).

## 전체 예제

{{source-code:0}}

{{source-code:1}}

제작 절차와 청취·전달 기준은 [사운드 만들고 검토하기](../guides/sounds.md)를 참고하세요.
