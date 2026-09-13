# 사운드 문법 레퍼런스

`ashfox-model 1` 다음에 `sound name { … }`을 작성합니다. `name = value;`
프로퍼티, 레코드, 목록, JSON 문자열과 숫자를 사용합니다. 주석은 `//`입니다.
샘플·가져오기·표현식·실행 코드는 없습니다. 알 수 없거나 중복된 키는 거부합니다.
기존 레이어 문법을 병행하지 않습니다.

## 루트 계약

모든 필드는 필수입니다. ID는 `[a-z][a-z0-9_]{0,31}`이며 소유 범위에서 고유합니다.
선언이 ID를 소유하므로 본문에 `id`, `format`, `version`을 넣지 마세요.

| 필드 | 허용 범위 |
| --- | --- |
| `duration` | 원본 합성 길이 0.05–30초 |
| `sampleRate` | 48000 |
| `seed` | 정수 1–4294967295 |
| `voices` | 참조되는 보이스 1–16개 |
| `sequences` | 시퀀스 1–32개 |
| `variants` | `{ id, seed }` 1–8개 |
| `playback` | `{ kind = "oneshot"; }` 또는 `{ kind = "loop"; start; end; crossfade; }` |
| `output` | `{ gainDb, peakDb }`: 고정 게인 -48–24 dB, 피크 상한 -12–-1 dBFS |

## 공통 곡선과 보이스

보이스는 `{ id, source, gain, highpass, lowpass }`입니다. 게인은 선형 진폭 0–2,
하이패스는 10–10000 Hz, 로우패스는 20–16000 Hz입니다. 세 값은 상수 또는
아래 곡선입니다. 전체 하이패스 최댓값은 로우패스 최솟값보다 작아야 합니다.

```text
pitch = {
  domain = "log";
  interpolation = "smooth";
  points = [{ at = 0; value = 2800; }, { at = 0.35; value = 5400; }, { at = 1; value = 3200; }];
};
```

도메인은 `linear` 또는 `log`, 보간은 `linear` 또는 `smooth`입니다. 점 2–16개가
정확히 0에서 시작해 1에서 끝나며 시간은 엄격히 증가해야 합니다. 최단 변주 길이에서
인접 점 간격은 최소 96프레임이어야 합니다. 점을 자동 정렬하거나 합치지 않습니다.
log 값은 양수입니다. smooth의 가중치는 `v*v*(3-2*v)`이며 오버슈트가 없습니다.
N프레임 이벤트의 i번째 샘플은 `i/(N-1)`에서 평가합니다.

| 제어 | 범위와 곡선 도메인 |
| --- | --- |
| 보이스 gain | 0–2, linear |
| highpass / lowpass | 위 범위, linear 또는 log |
| FM pitch | 40–3000 Hz, linear 또는 log |
| FM index | 0–4, linear |
| vocal pitch | 50–1200 Hz, linear 또는 log |
| chirp pitch | 500–8000 Hz, linear 또는 log |
| chirp brightness | 0–1, linear |

`attack`, `release`는 없습니다. gain 곡선으로 조음을 표현하세요. 모든 단발 이벤트의
양 끝 gain은 0이어야 합니다. 루프 안쪽에서 시작하거나 끝나는 이벤트도 해당 끝이
0이어야 합니다. 루프 경계와 같거나 바깥에 놓인 끝만 0이 아닌 값을 허용합니다.
숨겨진 페이드와 공명 꼬리 자동 연장은 없습니다.

**음원별 필드**

아래 키는 종류별로 모두 필수입니다. 표에 없는 제어는 곡선을 받지 않습니다.

| kind | 필드 |
| --- | --- |
| noise | kind만 |
| fm | kind, pitch, ratio, index, vibratoHz, vibratoCents |
| vocal | kind, pitch, formants, bandwidths, breath, jitter, roughness |
| chirp | kind, pitch, trillHz, trillCents, trillDepth, breath, jitterCents, brightness |
| resonator | kind, excitation, modes |

FM ratio는 0.25–4, vibratoHz는 0–25, vibratoCents는 0–100입니다.
Vocal formants는 150–7000 Hz 세 값, bandwidths는 40–1500 Hz 세 값이며
breath·jitter·roughness는 각각 0–1입니다. Chirp trillHz는 0–100,
trillCents는 0–300, trillDepth는 0–1, breath는 0–0.2, jitterCents는 0–80입니다.
`contour`, `sweepSeconds`, 두 값 pitch는 거부됩니다.

## 시퀀스와 반복

시퀀스는 `{ id, start, repeat, steps }`입니다. start는 음수가 아닌 초입니다.
repeat는 `{ count, period }`로 count 정수 1–64, count=1이면 period=0,
그 외에는 최소 1프레임 이상의 양수 초입니다. period는 시작 간 간격입니다.

각 steps 1–32개는 `{ id, voice, at, duration, gain, pitchCents, vary }`입니다.
voice는 로컬 보이스 ID, at는 음수가 아닌 초, duration은 0.02–30초,
gain은 0–2, pitchCents는 -1200–1200입니다. 반복 k의 시작은
`start + k*period + at`입니다. 겹침은 허용하지만 원본 밖으로 자르지 않습니다.

## 제어 가능한 무작위 변주

```text
vary = {
  timing = [-0.008, 0.008];
  pitchCents = [-25, 25];
  gain = [0.92, 1.08];
  duration = [0.96, 1.04];
};
```

네 범위는 모두 필수이며 순서가 작은 값부터입니다. timing은 ±0.5초,
pitchCents는 ±1200센트, gain은 0–2배, duration은 0.25–4배입니다.
타이밍·피치는 가산, gain·duration은 배율입니다. 범위 전체가 타임라인·음원
주파수·곡선 해상도·이벤트 길이 제한을 만족해야 합니다. 상한은 무작위로 실제
뽑힌 값만 검사하지 않습니다. 각 속성의 난수 스트림은 독립적입니다.

사운드 ID, 루트 시드, 변형 ID·시드, 시퀀스 ID, 반복 번호, 스텝 ID, 보이스 ID가
이벤트의 확률적 정체성을 결정합니다. 타이밍·피치·게인·길이·노이즈·breath·jitter·
trill 위상·자극은 독립 난수 스트림을 사용합니다. 한 범위를 바꾸거나 breath와
jitter를 꺼도 다른 제어의 난수는 바뀌지 않습니다. 고정 디튜닝은 이벤트 피치
변주가 소유하고 chirp jitter는 음 안의 드리프트를 표현합니다.

시퀀스 ID, 반복 번호, 스텝 ID 순서로 합산합니다. 배열 재정렬과 반복 추가는
기존 이벤트의 난수를 바꾸지 않습니다. 변형 ID·시드 변경은 그 변형만 바꾸고,
시퀀스·스텝·보이스 이름 변경은 해당 이벤트의 난수를 바꿉니다. 이벤트를 추가하면
기존 이벤트의 개별 샘플은 유지되어도 최종 혼합 파형은 달라질 수 있습니다.
동일한 소스와 CLI 사운드 계약 지문을 사용해 PCM16을 재현하세요. OGG 인코더
버전이 다르면 동일한 바이트를 보장하지 않습니다.

## 모드 공명 음원

공명 excitation은 `{ kind = "impulse"; }` 또는
`{ kind = "noise"; duration = 0.006; }`입니다. 노이즈 자극은 0.002–0.05초이며
최단 이벤트보다 길 수 없습니다. modes는 고유 ID를 가진 `{ id, hz, decay, gain }`
1–16개입니다. hz는 40–16000, decay는 0.01–10초의 T60(진폭이 0.001로
감쇠하는 시간), gain은 0–1이며 적어도 하나는 양수입니다. 모드는 ID순으로
합산하고 전체 gain 합으로 가중치를 나눕니다. 주파수·감쇠는 상수입니다.
이벤트 길이 변주는 물리적 감쇠 시간을 바꾸지 않습니다. 피치 변주 후에도 모든
모드가 주파수 범위에 있어야 합니다. 재질 이름만으로 사실감을 보장하지 않습니다.

## 루프와 출력

```text
playback = { kind = "loop"; start = 0.4; end = 4.4; crossfade = 0.08; };
```

초는 `floor(t*48000+0.5)`로 프레임화합니다. 이벤트 시작과 길이는 별도로
반올림합니다. 루프 구간 [S,E)의 L=E-S, 겹침 X는 최소 96프레임이며
`min(48000, floor(L/4))` 이하여야 합니다. 결과 L-X는 최소 2400프레임입니다.
크로스페이드 0과 메타데이터만 있는 루프는 거부됩니다.

출력은 먼저 원본 `[S+X,E-X)`를 쓰고 끝 X개와 시작 X개를 smooth unity-sum
가중치로 섞어 덧붙입니다. 길이는 L-X이고 시작 위치는 S+X입니다. 4초 구간과
0.08초 겹침은 188160프레임, **3.92초**를 만듭니다. 마지막에 침묵이나 페이드를
추가하지 않습니다. 상관된 소리의 게인 부풀림을 피하지만 노이즈는 음량이
꺼질 수 있으므로 청취하세요.

고정 `gainDb`는 베이크 후 한 번 적용합니다. `rmsDb`, 자동 RMS 정규화,
리미터, 클리핑, 변형별 자동 게인은 없습니다. 비유한 값, 무음, PCM16 전후
피크 상한 초과, 양자화 후 전체 무음은 실패합니다. RMS·DC는 측정값입니다.
피크 진단이 제시하는 낮은 게인을 검토해 소스에 직접 반영하세요.

출력 playback은 단발 `{ kind: 'oneshot' }` 또는 루프
`{ kind: 'loop', startFrame: 0, endFrame: frames }`입니다. 영수증은 원본과
출력 길이, 경계 차이와 인접 샘플 기울기 증거도 제공합니다. WAV는 fmt+data
PCM16만 포함하므로 WAV 소비자는 전체 버퍼 반복을 직접 설정해야 합니다.
게임 매니페스트의 반복 의도도 소비자가 반영해야 합니다. OGG·Minecraft 루프는
정확한 전달을 지원하지 않아 거부됩니다. 단발 전달은 유지됩니다.

## 자원 제한

소스 256 KiB, 토큰 12000개, 중첩 16단계, 곡선 점 1024개,
변형당 확장 이벤트 256개, 동시 이벤트 32개, 원본 30초까지입니다.
모든 변형의 이벤트 프레임 합은 2400만, 가중 DSP 작업은 1억9200만까지입니다.
최악의 변주 길이도 제한에 포함합니다.

워크스페이스는 사운드 소스를 최대 32개, 모든 변형의 원시 길이를 합쳐 최대 240초까지 포함합니다. 전체 이벤트 프레임 한도는 24,000,000, 가중 작업 프레임 한도는 192,000,000이며 합성 전에 모든 소스를 검사합니다. FM은 8배 속도로 합성한 뒤 고정 20 kHz 저역 통과 필터를 적용해 다운샘플링하며 작업 가중치는 128입니다.

## 전체 예제

```ashfox
ashfox-model 1
sound bell_pattern {
  duration = 2.4;
  sampleRate = 48000;
  seed = 7349;
  voices = [{
    id = "bell";
    source = {
      kind = "resonator";
      excitation = { kind = "impulse"; };
      modes = [
        { id = "body"; hz = 640; decay = 0.35; gain = 1; },
        { id = "edge"; hz = 1730; decay = 0.18; gain = 0.35; }
      ];
    };
    gain = {
      domain = "linear";
      interpolation = "smooth";
      points = [
        { at = 0; value = 0; },
        { at = 0.01; value = 0.8; },
        { at = 0.7; value = 0.5; },
        { at = 1; value = 0; }
      ];
    };
    highpass = 80;
    lowpass = {
      domain = "log";
      interpolation = "smooth";
      points = [{ at = 0; value = 8000; }, { at = 1; value = 3000; }];
    };
  }];
  sequences = [{
    id = "phrase";
    start = 0.1;
    repeat = { count = 4; period = 0.5; };
    steps = [{
      id = "strike";
      voice = "bell";
      at = 0;
      duration = 0.4;
      gain = 1;
      pitchCents = 0;
      vary = {
        timing = [-0.005, 0.005];
        pitchCents = [-20, 20];
        gain = [0.9, 1.1];
        duration = [0.95, 1.05];
      };
    }];
  }];
  variants = [{ id = "base"; seed = 42; }, { id = "alternate"; seed = 43; }];
  playback = { kind = "loop"; start = 0; end = 2.1; crossfade = 0.08; };
  output = { gainDb = -6; peakDb = -3; };
}
```


저장소의 `examples/sounds/src/bell_pattern.ashfox`는 곡선·반복·변주·공명·루프를
함께 사용하며 출력은 96960프레임(2.02초)입니다. 다음처럼 실행합니다.

```sh
npx --no-install ashfox build bell_pattern.ashfox --json
npx --no-install ashfox export bell_pattern.ashfox --variant base --output bell.wav
```

[사운드 만들고 검토하기](../guides/sounds.md)에서 청취와 전달 절차를 확인하세요.
