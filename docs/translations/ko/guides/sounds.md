# 사운드 만들고 검토하기

네이티브 `.ashfox` 원본(`ashfox 1`)으로 절차적 오디오를 작성하고 CLI로 컴파일합니다. 기본값으로 트루 스테레오(`channels = 2`) 48 kHz PCM16 WAV를 출력하며 명시적 품질 `profile`, 물리 기반 `material`/`modal_plate`, `granular`, `whoosh`/`aero_whoosh`, `waveguide`, 직렬 LF-성문 `vocal` 합성, 보이스별 `eq`/`drive`/`fx`/`duck`/펄린 `drift`, 트루 스테레오 FDN-8 `space`, 지각 `master`(`target` LUFS, `punch`, `warmth`, `air`, `glue`, `width`, `limit`), 순수 CPU 품질 오딧, 800×520 4분할 `preview inspect { sheet = inspect; }` 진단 시트를 지원합니다.

## 다층 사운드 작성하기

{{source-code:0}}

{{source-code:1}}

## 품질 기준과 전달 게이트

1. **`profile` 선택**: `impact`, `foley`, `creature`, `magic`, `ui`, `ambient` 중 선택합니다. `check`는 다이내믹스/어택 펀치/어택, 프로필별 6밴드 스펙트럼 적합도·거칠기·풍부함·변화, 지각 음량(`master { gain = ...; target = ...; limit = true; }`로 `-18..-12` LUFS 권장), 스테레오 위상 및 IACC 비상관도, 루프 경계·반복 주기성, 변형 차별성을 채점합니다(`build` 통과 기준 `score >= 75`).
2. **음색과 다이내믹스 레이어링**: `material`/`modal_plate`(`twin_beat`/`splash`/`stereo_spread`), `granular`(`stereo_width`/`itd_ms`), `whoosh`/`aero_whoosh`, `waveguide`(`string`/`blade`/`creak`/`pipe`), `vocal`(LF 성문 + 직렬 포먼트/모음 + `rattle`), PolyBLEP 스테레오 `osc`, `fm`, `chirp` 코어에 `eq`, `drive`(`tape`/`tube`/`grit`/`fold`), `fx`(`chorus`/`phaser`/`delay`/`shimmer`), `duck`, 순환 펄린 `drift`, 동적 `pan`, 트루 스테레오 `space`를 조합하세요.
3. **시트 점검과 청취**: `preview inspect { sheet = inspect; }`를 선언하고 `ashfox render <file> --view inspect --output sheet.png`를 실행해 4분할 시트(`Waveform & Envelope`, `Spectrogram`, `6-Band Spectrum + Audit`, `Variant Overlap`)를 확인한 뒤 빌드된 WAV/OGG 변형을 직접 들어보세요.

`seq`·`step`·`voice` ID가 독립 난수 스트림을 결정합니다. 실제 추출되지 않은 값까지 포함하여 변주 전체 범위가 시간·주파수·자원 제한을 만족해야 합니다.

## 루프 만들기

충분한 원본 `duration`을 선언하고 `loop { at = 0.4s..4.4s; xfade = 80ms; }`를 지정하세요. 컴파일러는 워밍업 후 구간을 자르고 겹침을 한 번만 굽습니다. 4초 구간과 80ms 크로스페이드의 출력은 **3.92초**입니다. 앰비언트 루프에는 순환 펄린 `drift`와 미세 입자 난류를 더해 루프 주기성 탐지기가 단조로운 LFO 팽창으로 판단하지 않게 하세요.

WAV에는 루프 지시가 들어 있지 않으므로 소비자가 전체 버퍼 반복을 켜야 합니다. 빌드 영수증과 `game_assets` 매니페스트는 `{ kind = "loop", startFrame: 0, endFrame: frames }` 또는 `{ kind = "oneshot" }`을 전달합니다. `audio: "ogg"`를 쓰는 `game_assets` 팩은 `LOOPSTART`·`LOOPLENGTH` Vorbis 태그와 `assets.json`의 `loopStartSample`·`loopEndSample`·`sampleRate`를 기록해 갭 없는 루프 재생을 지원합니다. Minecraft 팩은 루프를 거부합니다.

## 듣고 확인하기

의도한 음량으로 변형을 비교한 뒤 음량을 맞춰 음색도 비교하세요. 최소 20회 루프를 청취해 클릭, 반복적 팽창, 거친 고음, 크로스페이드 음량 감소를 점검하세요.

저장소 `showcase/assets/sounds/`와 내장 표준 라이브러리(`ashfox library std list sound`)에는 검·타격 전투음(`sword_slash.ashfox`, `claw_hit.ashfox`), 발걸음(`footsteps.ashfox`), 크리처 울음(`griffin_call.ashfox`), 갭리스 루프(`fire_loop.ashfox`)가 있습니다.

이전 헤더(`ashfox-model 1`), JSON 배열 구문(`voices = [...]`, `sequences = [...]`, `{ domain = ...; }`), `camelCase` 키, 따옴표 열거형 문자열, `timeline`, `resonator`, `layers`, `output.rmsDb`, `output.softClip`, `noise.color = "crackle"`은 거부됩니다. 전체 `ashfox 1` 사운드 문법과 자원 제한은 [사운드 문법 레퍼런스](../language/sounds.md)를 참고하세요.
