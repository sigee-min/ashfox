# 사운드 만들고 검토하기

네이티브 `.ashfox` 원본으로 절차적 오디오를 작성하고 CLI로 컴파일합니다. 모노 또는 스테레오(`channels = 2`) 48 kHz PCM16 WAV를 출력하며 명시적 품질 `profile`, 물리 기반 `material` 및 `granular` DSP 합성, 공명 Cytomic SVF 필터, FDN-8 공간 잔향 프리셋, 지각 마스터링(`target`, `punch`, `warmth`, `air`, `glue`, `width`, `limit`), CPU 지각 오디오 품질 오딧, 800×520 4분할 `preview inspect { sheet = inspect; }` 진단 시트를 지원합니다.

## 다층 사운드 작성하기

{{source-code:0}}

{{source-code:1}}

## 품질 기준과 전달 게이트

1. **`profile` 선택**: `impact`, `foley`, `creature`, `magic`, `ui`, `ambient` 중 선택합니다. `check`는 다이내믹스/어택 펀치/어택, 6밴드 스펙트럼 분포·거칠기·풍부함·변화, 지각 음량(`master.gain`, `target`, `limit = true`로 `-18..-12` LUFS 권장), 스테레오 위상 상관, 테일/루프 경계 연속성, 변형 간 차별성을 채점합니다(`build` 통과 기준 `score >= 75`).
2. **음색 레이어링**: `material`(`steel`, `wood`, `stone`, `glass` 등 + `mallet`/`scrape`/`bounce`), `granular`(`ember`, `gravel`, `water`, `foliage`, `wind`, `spark`, `bubble`), `resonator`, PolyBLEP 유니슨 `osc`, `fm`, `vocal`(`growl`/`chest`/`nasal` 및 `formant` 곡선 지원), `chirp` 코어에 스윕 Cytomic `filter`, `drive` 포화, 컬러 `noise` 트랜지언트, 스테레오 `pan`, `space`(`preset` 또는 맞춤 FDN-8) 잔향을 조합하세요.
3. **시트 점검과 청취**: `preview inspect { sheet = inspect; }`를 선언하고 `ashfox render <file> --view inspect --output sheet.png`를 실행해 CPU 4분할 시트(`Waveform & Envelope`, `Spectrogram`, `6-Band Spectrum + Audit`, `Variant Overlap`)를 확인한 뒤 빌드된 WAV/OGG 변형을 직접 들어보세요.

`seq`·`step`·`voice` ID가 독립 난수 스트림을 결정합니다. 블록 순서를 바꾸거나 반복을 추가해도 기존 이벤트의 난수는 유지됩니다. ID 변경은 난수도 바꿉니다. 실제 추출되지 않은 값까지 포함하여 변주 전체 범위가 시간·주파수·자원 제한을 만족해야 합니다.

## 루프 만들기

충분한 원본 길이를 선언하고 `loop { at = 0.4s..4.4s; xfade = 80ms; }`를 지정하세요. 컴파일러는 워밍업 후 구간을 자르고 겹침을 한 번만 굽습니다. 4초 구간과 0.08초 크로스페이드의 출력은 **3.92초**입니다. 재생 시작점도 겹침 길이만큼 이동합니다. 인트로와 아웃트로는 별도 에셋으로 만드세요.

WAV에는 루프 지시가 들어 있지 않습니다. WAV를 직접 쓰는 플레이어에서는 전체 버퍼 반복을 켜야 합니다. 빌드 영수증과 `game_assets` 매니페스트의 `{ kind = "loop", startFrame: 0, endFrame: frames }`를 게임 소비자가 반영하세요. 단발은 `{ kind = "oneshot" }`입니다.

OGG와 Minecraft 전달은 정확한 루프 계약을 보존하지 못하므로 루프를 거부합니다. 단발 OGG는 외부 도구 없이 내장 WebAssembly Vorbis 인코더로 처리됩니다.

## 듣고 확인하기

의도한 음량으로 변형을 비교한 뒤 음량을 맞춰 음색도 비교하세요. 전체 구절과 최소 20회 루프를 듣고 클릭, 부자연스러운 반복, 거친 고음, 크로스페이드 음량 감소를 확인하세요. 파형·경계 차이·인접 기울기·스펙트로그램은 청취를 보조합니다. 수치만으로 동물이나 재질의 사실감을 증명할 수 없습니다.

저장소 `examples/sounds/assets/`에는 새 구절(`bird_call.ashfox`와 모듈형 `bird_voices.ashfox`), 발걸음, 충전 마법, 금속·나무·유리 공명, 바람·불·기계 루프가 있습니다. 녹음이나 사실감을 보증하는 프리셋이 아니라 청취가 필요한 절차적 연구 예제입니다. `bell_pattern.ashfox`는 주요 기능을 함께 사용합니다.

전체 문법·루프 규칙·자원 제한은 [사운드 문법 레퍼런스](../language/sounds.md)의 통합 `ashfox 1` 문법을 참고하세요.
