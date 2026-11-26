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
| `space` | 선택 FDN-4 잔향 `{ mix, decay, damping, size }` |
| `voices` | 1–16개 보이스 레코드 (각 보이스는 최소 1개 스텝에서 참조) |
| `sequences` | 1–32개 시퀀스 정의 |
| `variants` | 1–8개 `{ id, seed }` 레코드 |
| `playback` | `{ kind = "oneshot"; }` 또는 `{ kind = "loop"; start; end; crossfade; }` |
| `output` | `{ gainDb, peakDb }` + 선택 `softClip` 불리언 |

## 보이스, DSP 음원, 필터, 엔벨로프

보이스는 `{ id, source, gain }`과 선택 `highpass`, `lowpass`, `filter`, `drive` (`0..10`), `pan` (`-1..1`, `channels = 2` 필요)로 구성됩니다.

- **음원 (`source`)**:
  - `noise`: `{ kind = "noise"; color = "white" | "pink" | "brown" | "crackle"; }` (`color` 선택, `crackle`은 `density` `1..200` 지원).
  - `osc`: `{ kind = "osc"; waveform = "sine" | "triangle" | "saw" | "square" | "pulse"; pitch; }` + 선택 `pulseWidth`, `unison` (`1..7`), `detuneCents`. PolyBLEP 안티앨리어싱.
  - `fm`: `{ kind = "fm"; pitch; ratio; index; vibratoHz; vibratoCents; }` (8배 오버샘플 위상 변조 FM).
  - `vocal`: `{ kind = "vocal"; pitch; formants; bandwidths; breath; jitter; roughness; }`.
  - `chirp`: `{ kind = "chirp"; pitch; brightness; trillHz; trillCents; trillDepth; breath; jitterCents; }`.
  - `resonator`: `{ kind = "resonator"; excitation; modes; }` + 선택 `pitchDropCents`, `pitchDropSeconds`. `excitation`은 `{ kind = "impulse"; }`, `{ kind = "noise"; duration; }`, `{ kind = "mallet"; duration; hardness; }` 지원.
- **필터**: `highpass` (`10..10000` Hz), `lowpass` (`20..18000` Hz), 또는 파라미터 Cytomic SVF `filter = { kind = "lowpass" | "highpass" | "bandpass" | "notch"; cutoff; q; }`.
- **곡선 및 엔벨로프**: 상수 또는 `{ domain = "linear" | "log"; interpolation = "linear" | "smooth"; points = [...]; }` 곡선(`2..16`점, 인접 간격 `>= 96`프레임). 보이스 `gain`은 축약 엔벨로프도 허용합니다:
  - `{ env = "ad"; attack; peak; curve; }` (`peak`, `curve` 선택)
  - `{ env = "adsr"; attack; decay; sustain; release; peak; curve; }`

## 시퀀스, 스텝, 변주, 공간

각 시퀀스는 `{ id, start, steps }`와 선택 `repeat`를 가집니다(`start` 기본 `0`, `repeat` 기본 `{ count = 1; period = 0; }`).
각 스텝은 `{ id, voice, at, duration }`과 선택 `gain` (`1`), `pitchCents` (`0`), `vary` (`timing`, `pitchCents`, `gain`, `duration`)를 가집니다. `noise` 스텝의 피치 변주는 `0`이어야 합니다.

`space = { mix; decay; damping; size; }`는 피드백 딜레이 네트워크를 적용합니다(`mix` `0..0.6`, `decay` `0.03..1.5`초, `damping` `1000..14000` Hz, `size` `0.2..2`).

`output.softClip = true;`는 `output.peakDb` (`-12..-1` dBFS) 한도 안에서 부드러운 `tanh` 소프트 리미팅을 적용합니다. 기본값 `false`는 PCM16 반올림 기준 엄격한 선형 피크 상한을 검사합니다.

## 루프, 오딧, 전달

루프는 원본 합성에서 `[start, end)`를 잘라 smooth cosine/Hermite 겹침 `crossfade` (`96..min(48000, floor(L/4))` 프레임)를 굽고 `{ kind = "loop"; startFrame = 0; endFrame = frames; }`로 `L - X` 프레임을 전달합니다. 루프 OGG와 Minecraft 팩 루프 대상은 거부됩니다.

`ashfox check`는 음량 헤드룸, DC 오프셋, 무음 비율, 스펙트럼 복잡도·밸런스·플럭스, 루프 연속성, 변형 차별성을 감사합니다(`build` 통과 기준 `score >= 75`).

## 전체 예제

{{source-code:0}}

{{source-code:1}}

제작 절차와 청취·전달 기준은 [사운드 만들고 검토하기](../guides/sounds.md)를 참고하세요.
