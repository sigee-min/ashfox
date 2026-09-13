# 사운드 만들고 검토하기

네이티브 `.ashfox` 소스로 절차적 오디오를 작성하고 CLI로 컴파일합니다.
소스가 음원, 재사용 보이스, 배치, 변주 범위, 고정 출력 게인과 반복 재생 의도를
소유합니다. 출력은 48 kHz 모노 PCM16 WAV입니다.

## 보이스와 구절 작성

[사운드 문법의 전체 예제](../language/sounds.md)에서 시작하세요. `voice`에는
noise, FM, vocal, chirp 또는 resonator 음원과 게인·필터가 들어갑니다.
`sequence`가 이름 있는 스텝을 배치하고 유한 횟수만큼 반복합니다. 각 스텝에
타이밍·피치·게인·길이 변주 범위를 모두 작성하세요. 가산 범위 `[0, 0]`과
배율 범위 `[1, 1]`은 변주를 끕니다.

상수는 숫자로, 변하는 피치·게인·필터·FM index·chirp brightness는 공통 곡선으로
표현합니다. 곡선 시간은 각 이벤트의 시작 0부터 끝 1까지입니다. smooth는 각
점에서 부드럽게 기울기를 바꾸며 log 도메인은 주파수 변화에 유용합니다.
단발 이벤트의 게인은 양 끝이 0이어야 합니다. 숨겨진 페이드나 정규화는 없습니다.

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

```sh
npx --no-install ashfox inspect bell_pattern.ashfox
npx --no-install ashfox build bell_pattern.ashfox --json
npx --no-install ashfox export bell_pattern.ashfox --variant base --output bell.wav
```

## 음량과 변주 선택

`output.gainDb`는 모든 변형에 동일하게 적용하는 고정 배율입니다. `peakDb`는
리미터가 아니라 초과 시 실패하는 상한입니다. 피크 오류가 나면 게인을 낮추고
PCM16 반올림을 고려해 여유를 두세요. 확률 요소와 변주가 없는 보이스는 시드를
바꾸어도 같은 바이트를 만들 수 있습니다.

시퀀스·스텝·보이스 ID가 독립 난수 스트림을 결정합니다. 배열 순서를 바꾸거나
반복을 추가해도 기존 이벤트의 난수는 유지됩니다. ID 변경은 난수도 바꿉니다.
실제 추출되지 않은 값까지 포함하여 변주 전체 범위가 시간·주파수·자원 제한을
만족해야 합니다.

## 루프 만들기

충분한 원본 길이를 선언하고
`playback = { kind = "loop"; start = 0.4; end = 4.4; crossfade = 0.08; };`
를 지정하세요. 컴파일러는 워밍업 후 구간을 자르고 겹침을 한 번만 굽습니다.
4초 구간과 0.08초 크로스페이드의 출력은 **3.92초**입니다. 재생 시작점도 겹침
길이만큼 이동합니다. 인트로와 아웃트로는 별도 에셋으로 만드세요.

WAV에는 루프 지시가 들어 있지 않습니다. WAV를 직접 쓰는 플레이어에서는
전체 버퍼 반복을 켜야 합니다. 빌드 영수증과 `game_assets` 매니페스트의
`{ kind: "loop", startFrame: 0, endFrame: frames }`를 게임 소비자가 반영하세요.
단발은 `{ kind: "oneshot" }`입니다.

OGG와 Minecraft 전달은 정확한 루프 계약을 보존하지 못하므로 루프를 거부합니다.
단발 OGG에는 libvorbis가 있는 FFmpeg가 필요합니다. 오디오 스터디는 루프 WAV를
재생하고 루프의 OGG 다운로드를 제공하지 않습니다.

## 듣고 확인하기

의도한 음량으로 변형을 비교한 뒤 음량을 맞춰 음색도 비교하세요. 전체 구절과
최소 20회 루프를 듣고 클릭, 부자연스러운 반복, 거친 고음, 크로스페이드 음량
감소를 확인하세요. 파형·경계 차이·인접 기울기·스펙트로그램은 청취를 보조합니다.
수치만으로 동물이나 재질의 사실감을 증명할 수 없습니다.

저장소 `examples/sounds/src`에는 새 구절, 발걸음, 충전 마법, 금속·나무·유리
공명, 바람·불·기계 루프가 있습니다. 녹음이나 사실감을 보증하는 프리셋이 아니라
청취가 필요한 절차적 연구 예제입니다. `bell_pattern.ashfox`는 다섯 기능을
함께 사용합니다.

이전 `layers`, `attack`, `release`, `contour`, `sweepSeconds`, 피치 쌍,
`output.rmsDb`는 거부됩니다. 명시적으로 소스를 옮기되 헤더는 `ashfox-model 1`을
유지합니다. 설치한 CLI의 사운드 계약 지문으로 실행 파일과 문서의 일치를 확인하세요.
