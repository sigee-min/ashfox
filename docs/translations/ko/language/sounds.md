# 사운드 문법 레퍼런스

네이티브 사운드 파일은 `ashfox 1` 다음에 `sound name { … }` 또는 `module name { … }`을 작성합니다. 선언적 `snake_case` 블록, 따옴표 없는 열거형, 단위 기반 구문을 사용하며 샘플이나 런타임 표현식을 허용하지 않습니다.

## 루트 계약

모든 ID는 `[a-z][a-z0-9_]{0,31}` 형식을 따르며 소유 범위 내에서 고유합니다. 알 수 없거나 `camelCase`이거나 중복된 필드는 실패하며, 이전 `ashfox-model 1` 헤더, JSON 배열 구문(`voices = [...]`, `sequences = [...]`, 중괄호 `{ domain = ...; }`), `timeline`, `resonator`는 거부됩니다.

| 선언 / 필드 | 계약 |
| --- | --- |
| `profile` | `impact`, `foley`, `creature`, `magic`, `ui`, `ambient` |
| `duration` | 원본 합성 길이 `0.05s..30s` |
| `sample_rate` | 선택; 고정 `48000hz` (기본값 `48000hz`) |
| `channels` | 선택 `1` (모노) 또는 `2` (스테레오, 기본값 `2`) |
| `seed` | 정수 `1..4294967295` |
| `variants` | 선택 `{ id = seed; ... }`; 생략 시 2개 변형 자동 생성 (`base` = `seed`, `alternate` = `seed ^ 0x9e3779b9`) |
| `space` | 선택 FDN-8 트루 스테레오 잔향: `space { [preset = <preset>;] [mix = ...;] [decay = ...;] [damping = ...;] [size = ...;] [pre_delay_ms = ...;] [width = ...;] }` |
| `voice <id> : <type> { ... }` | 1–16개 보이스(최소 1개 `seq` 스텝 또는 `duck`에서 참조) |
| `seq <id> { ... }` | 1–32개 시퀀스 (`start = ...;`, `repeat { count = ...; period = ...; }`, `step <id> { ... }`) |
| `loop` | 선택 `loop { at = <start>..<end>; [xfade = <dur>;] }` (또는 `playback = oneshot;`, 기본값 `oneshot`) |
| `master` | `master { [gain = <db>;] [target = <lufs>;] peak = <db>; [punch = ...;] [warmth = ...;] [air = ...;] [glue = ...;] [width = ...;] [limit = true;] }` |

## 단위, 곡선, 엔벨로프, 모듈

- **단위**: `ms`(밀리초), `s`(초), `hz` / `khz`(주파수), `db`(데시벨), `lufs`(라우드니스), `cents` / `st`(피치 오프셋), `%`(`0.01` 배율 백분율).
- **전이 및 곡선**: `log(0: 1800hz -> 1: 950hz)`, `lin(0: 0 -> 0.5: 1 -> 1: 0)`, `smooth(0: 200hz -> 1: 800hz)`, 또는 인라인 `a -> b [ease_out -> c]` 전이(`linear`/`smooth`/`ease_in`/`ease_out`/`ease_in_out`/`snap`). 제어점 간격은 `>= 96`프레임(`2..16`점)이어야 합니다.
- **엔벨로프**: `gain { env = ad; attack = 5ms; peak = 0.95; curve = exp; }` 및 `gain { env = adsr; attack = 20ms; decay = 120ms; sustain = 0.7; release = 150ms; peak = 0.9; curve = exp; }`.
- **모듈 및 `params`**: 모듈은 `params { key = val; }`과 `export voice <id> : <type> { ... }` (또는 `export seq <id> { ... }`)를 선언합니다. 사운드는 블록 상단에서 상대 모듈(`import "../module/kit.ashfox" as kit;`) 또는 내장 표준 라이브러리(`import "std/sound/combat/blade" as blade;`)를 가져오며 필요 시 매개변수를 재정의(`{ pitch = 440hz; }`)해 `alias.voice_id`로 참조합니다.

## 보이스, 트루 스테레오 음원, FX, 변조

`voice <id> : <type> { ... }` 내부에 음원 속성, `gain` 블록/곡선, 선택 프로세서를 선언합니다:

- **음원 타입 (`:<type>`)**:
  - `: noise` — `color = white|pink|brown;` (2채널에서 비상관 스테레오 노이즈).
  - `: material` / `: modal_plate` — `material = <preset>; pitch = <ctrl>; [size] [hardness] [damping] [brightness] [modes] [strike = mallet|scrape|bounce] [bounces] [twin_beat] [splash] [stereo_spread]` (`steel`, `iron`, `bronze`, `bell`, `wood`, `stone`, `glass`, `ceramic`, `bone`, `leather`; `pitch` `20..4000` Hz).
  - `: granular` — `texture = <preset>; density = <ctrl>; [grain_ms] [pitch] [spread] [burstiness] [turbulence] [stereo_width] [itd_ms]` (`ember`, `gravel`, `water`, `foliage`, `wind`, `spark`, `bubble`; `itd_ms` `0..0.6` ms).
  - `: osc` — `waveform = sine|triangle|saw|square|pulse; pitch = <ctrl>; [pulse_width] [unison = 1..4] [detune_cents]` (PolyBLEP + 스테레오 유니슨 확산).
  - `: fm` — `pitch = <ctrl>; ratio = <0.25..8>; index = <ctrl>; [vibrato_hz] [vibrato_cents]`.
  - `: vocal` — `pitch = <ctrl>; [vowels = oo -> aa -> uh;] [formants = [...];] [bandwidths = [...];] [breath] [jitter] [roughness] [growl] [chest] [nasal] [rattle]` (LF 성문 파형 + 직렬 4포먼트 필터).
  - `: chirp` — `pitch = <ctrl>; brightness = <ctrl>; [trill_hz] [trill_cents] [trill_depth] [breath] [jitter_cents]`.
  - `: whoosh` / `: aero_whoosh` — `[velocity = <ctrl>;] [thickness] [doppler] [sweep_pan] [noise_tone]` (속도 세제곱 음압, 스트루할 와류 휘슬, 도플러 변이, 스테레오 패닝; `aero_whoosh` 기본값 `velocity = 1.2`).
  - `: waveguide` — `model = string|blade|creak|pipe; pitch = <ctrl>; [damping] [stiffness] [bow_pressure] [brightness]` (분산형 소수 지연 물리 도파관).
- **필터 및 EQ**: `highpass = <ctrl>;`, `lowpass = <ctrl>;`, `filter : <lowpass|highpass|bandpass|notch> { cutoff = <ctrl>; [q = <ctrl>;] }` (bandpass는 인라인 `cutoff = <ctrl>; [q = <ctrl>;]` 가능), `eq { [low = (hz, db);] [mid = (hz, db, q);] [high = (hz, db);] }`.
- **드라이브 및 FX**: `drive : <tape|tube|grit|fold> { amount = <0..10>; }` (또는 `drive = <0..10>;`), 반복 가능한 `fx : <chorus|phaser|delay|shimmer> { ... }` (`time_ms`, `ping_pong`, `shift_semitones`, `damping = <hz>`), `pan = <ctrl>;` (`-1..1`), `duck { by = <voice>; amount = <0..1>; release_ms = <5..2000ms>; }`, `drift { target = <gain|cutoff|pitch|pan>; depth = <0..1>; [rate = <0.05..20hz>;] [seed = <int>;] }`.

## 시퀀스, 공간, 루프, 오딧

각 `seq <id> { ... }`는 선택 `start = <dur>;`, `repeat { count = <N>; period = <dur>; }`, `step <id> { voice = <voiceRef>; at = <dur>; duration = <dur>; [gain = ...;] [pitch = <cents>;] [vary_timing = a..b;] [vary_pitch = a..b;] [vary_gain = a..b;] [vary_duration = a..b;] }`를 포함합니다.

`space`는 `preset`(`dry_close`, `timber_room`, `stone_hall`, `small_chamber`, `courtyard`, `cavern`, `ethereal`) 또는 맞춤 트루 스테레오 FDN-8 파라미터(`mix` `0..0.7`, `decay` `0.03..3s`, `damping` `800..16000hz`, `size` `0.2..3`, `pre_delay_ms` `0..80ms`, `width` `0..1.5`)를 지원합니다.

루프는 `[start, end)`를 잘라 smooth cosine/Hermite 겹침 `xfade` (`96..min(48000, floor(L/4))` 프레임)를 굽습니다. `ashfox check`는 헤드룸, DC 오프셋, 무음 비율, 프로필 스펙트럼 적합도, 스테레오 위상 및 IACC 비상관도, 루프 연속성·주기성, 변형 차별성을 감사합니다(`build` 통과 기준 `score >= 75`).

## 전체 예제

{{source-code:0}}

{{source-code:1}}

제작 절차와 청취·전달 기준은 [사운드 만들고 검토하기](../guides/sounds.md)를 참고하세요.
