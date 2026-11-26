# 사운드 문법 레퍼런스

네이티브 사운드 파일은 `ashfox 1` 다음에 `sound name { … }`(또는 재사용 보이스용 `module name { … }`)를 작성합니다. 선언은 통합 `snake_case` 블록, 단위 접미사(`s`, `ms`, `hz`, `khz`, `db`, `lufs`, `cents`, `st`, `%`), 범위 `..`, 피치 전환 `->`, 따옴표 없는 열거형을 사용하며 외부 오디오 샘플은 허용하지 않습니다.

## 루트 계약

모든 ID는 `[a-z][a-z0-9_]{0,31}` 형식을 따르며 소유 범위 내에서 고유합니다. 선택 표시가 없는 키는 필수이며 알 수 없거나 중복된 키는 실패합니다.

| 루트 필드 / 블록 | 계약 |
| --- | --- |
| `profile` | `impact`, `foley`, `creature`, `magic`, `ui`, `ambient` |
| `duration` | 원본 합성 길이 `0.05s..30s` |
| `sample_rate` | 선택 `48000` (또는 `48000hz`) |
| `channels` | 선택 `1` (모노, 기본값) 또는 `2` (스테레오) |
| `seed` | 정수 `1..4294967295` |
| `space { … }` | 선택 FDN-8 잔향 (`preset`, `mix`, `decay`, `damping`, `size`, `pre_delay`, `width`) |
| `voice <id> : <kind> { … }` | 1–16개 타입 보이스 블록 (각 보이스는 최소 1개 스텝에서 참조) |
| `seq <id> { … }` | `step <id> { … }` 선언을 포함하는 1–32개 시퀀스 블록 |
| `variant <id> { seed = …; }` | 1–8개 시드 변형 선언 |
| `loop { at = a..b; xfade = …; }` | 선택 루프 잘라내기 범위와 크로스페이드(생략 시 `oneshot`) |
| `master { gain; peak; … }` | 출력 마스터링(`gain`, `peak`, 선택 `target`, `punch`, `warmth`, `air`, `glue`, `width`, `limit`) |

## 보이스, DSP 음원, 필터, 엔벨로프

각 `voice <id> : <kind> { … }`는 DSP 음원과 선택 `highpass`, `lowpass`, `filter <kind> { … }`, `drive` (`0..10`), `pan` (`-1..1`, `channels = 2` 필요), `gain`으로 구성됩니다.

- **음원 (`<kind>`)**:
  - `noise`: `color = white | pink | brown;`.
  - `material`: `material`(`steel`, `iron`, `bronze`, `bell`, `wood`, `stone`, `glass`, `ceramic`, `bone`, `leather`), `pitch` (`20hz..4000hz`), 선택 `size` (`0.25..4`), `hardness`, `damping`, `brightness` (`0..100%`), `modes` (`4..32`), `strike` (`mallet | scrape | bounce`), `bounces` (`1..6`, `strike = bounce` 필요).
  - `granular`: `texture`(`ember`, `gravel`, `water`, `foliage`, `wind`, `spark`, `bubble`), `density` (`1..500`), 선택 `grain_ms` (`3ms..150ms`), `pitch` (`60hz..12000hz`), `spread`, `burstiness`, `turbulence` (`0..100%`).
  - `osc`: `waveform = sine | triangle | saw | square | pulse;`, `pitch`, 선택 `pulse_width`, `unison` (`1..4`), `detune` (`0cents..50cents`). PolyBLEP 안티앨리어싱.
  - `fm`: `pitch`, `ratio`, `index`, `vibrato_hz`, `vibrato_cents` (8배 오버샘플 위상 변조 FM).
  - `vocal`: `pitch`, 3–4개 `formant { hz = …; bw = …; }` 블록, 선택 `breath`, `jitter`, `roughness`, `growl`, `chest`, `nasal` (`0..100%`).
  - `chirp`: `pitch`, `brightness`, `trill_hz`, `trill_cents`, `trill_depth`, `breath`, `jitter_cents`.
  - `resonator`: `excitation <kind> { … }` (`impulse`, `noise`, `mallet`)와 `mode <id> { hz; decay; gain; }` 블록, 선택 `pitch_drop_cents`, `pitch_drop_seconds`.
- **필터**: `highpass` (`10hz..10000hz`), `lowpass` (`20hz..18000hz`), 또는 Cytomic SVF `filter lowpass|highpass|bandpass|notch { cutoff; q; }`.
- **곡선 및 엔벨로프**: 상수, `a -> b` 전환 스윕, 또는 `cutoff { domain = linear | log; interpolation = linear | smooth; points = [(0, 12000hz), (1, 2800hz)]; }` 곡선. 보이스 `gain`은 상수 또는 `gain { env = ad | adsr; attack; decay; sustain; release; peak; curve; }` 블록을 허용합니다.

## 시퀀스, 스텝, 변주, 공간

각 `seq <id> { … }`는 선택 `start` (`0s` 기본값)와 `repeat { count; period; }`, 그리고 선택 `gain` (`1`), `pitch` (`0cents`), `vary_timing`, `vary_pitch`, `vary_gain`, `vary_duration` 범위(`min..max`)를 갖춘 `step <id> { voice; at; duration; }`로 구성됩니다. `noise` 스텝 및 `pitch`가 없는 `granular` 스텝의 피치 변주는 0이어야 합니다.

`space { … }`는 8라인 아다마르 피드백 딜레이 네트워크를 적용하며 `preset` (`dry_close | timber_room | stone_hall | small_chamber | courtyard | cavern | ethereal`) 또는 `mix` (`0..70%`), `decay` (`30ms..3s`), `damping` (`800hz..16000hz`), `size` (`0.2..3.0`), `pre_delay` (`0ms..80ms`), `width` (`0..1.5`)를 받습니다.

`master { … }`는 `gain` (`-48db..24db`), `peak` (`-12db..-0.5db`), 선택 `target` (`-30lufs..-6lufs`), `punch`, `warmth`, `air`, `glue`, `width`, `limit = true`로 마스터 버스를 구성합니다.

## 루프, 오딧, 전달

`loop { at = 0s..2.1s; xfade = 80ms; }`는 원본 합성에서 `[start, end)`를 잘라 코사인/에르미트 겹침(`96..min(48000, floor(L/4))` 프레임)을 굽고 `L - X` 프레임을 전달합니다. 루프 OGG와 Minecraft 팩 루프 대상은 거부됩니다.

`ashfox check`는 음량 헤드룸(RMS/LUFS), DC 오프셋, 무음 비율, 어택 펀치, 2.5–5 kHz 거칠기, 스펙트럼 복잡도·밸런스·플럭스, 스테레오 위상 상관, 루프 연속성, 변형 차별성을 감사합니다(`build` 통과 기준 `score >= 75`).

## 전체 예제

{{source-code:0}}

{{source-code:1}}

제작 절차와 청취·전달 기준은 [사운드 만들고 검토하기](../guides/sounds.md)를 참고하세요.
