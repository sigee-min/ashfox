# Minecraft Java 리소스 팩 빌드

`.ashfoxworkspace`는 전달을 포함한 프로젝트 빌드를, `.ashfox`는 에셋 내용을 정의합니다. `exports`가 진입점·컴파일 출력을 고르고 선택적인 `packs`가 이름 있는 출력을 게임 리소스·압축파일로 연결합니다. [엔진 중립 번들](game-assets.md)용 `game_assets`도 함께 선언할 수 있습니다. 리소스 ID·이벤트·namespace·폴더·팩 포맷 변경은 컴파일러가 아닌 설정 변경입니다. export 하나를 ID가 다른 여러 팩에 사용할 수 있습니다.

개별 export만 필요하면 `packs`를 생략하세요. 제공된 목록과 중첩 레코드는 허용 키가 정해져 있습니다. 알 수 없는 필드, 필수값 누락, 잘못된 참조, 중복 ID, 위험한 경로는 실패합니다. 팩 선언에 셸 코드, 네트워크 조회, 자동 버전 선택, 생성 파일 편집을 넣지 않습니다.

## 설정

[완전한 리소스 팩 프로젝트](/downloads/resource-pack.zip)를 푸세요. [`examples/resource-pack/.ashfoxworkspace`](../../examples/resource-pack/.ashfoxworkspace)는 원본·export를 선언한 뒤 다음 팩을 사용합니다.

{{source-code:0}}

`source`, `icon`, `models`는 파일 경로가 아닌 `exports[].name`을 참조합니다. 표시한 팩 필드는 모두 필수입니다. 빈 목록은 허용하며 `icon: null`은 아이콘을 생략합니다. 루트 `packs` 자체는 선택 사항입니다. export·팩 이름은 하나의 고유 ID 공간을 공유합니다. 빌드·export·팩 출력은 서로 겹치지 않는 프로젝트 상대 경로이고 원본·예약 디렉터리 밖에 있어야 합니다.

| 설정 | 의미 |
| --- | --- |
| `minecraftVersion` | 카탈로그 정보용 라벨. 숨은 분기를 제어하지 않음 |
| `metadata.format: range` | 명시적 `[major, minor]`에서 `min_format`, `max_format` 생성 |
| `metadata.format: legacy` | 범위 대신 `packFormat`을 받아 `pack_format` 생성 |
| `itemDefinitions: modern` | `items/<id>.json`, `models/item/<id>.json` 모두 생성 |
| `itemDefinitions: legacy` | 새로운 `items/` 진입점 없이 아이템 모델 생성 |
| `archive` | 루트에 `pack.mcmeta`가 있는 ZIP도 생성 |
| `icon` | `pack.png`로 사용할 PNG export 이름 |
| `models` | 기존 리소스 경로로 합칠 `java_block`·`geckolib5` export 이름 |
| `items[].id` | namespace 포함 리소스 ID. 정의·모델·텍스처 경로 결정 |
| `items[].parent` | 바닐라 모델 부모 `generated` 또는 `handheld` |
| `sounds[].id` | 해당 namespace의 `sounds.json` 항목을 정하는 이벤트 ID |
| `sounds[].variants` | `all` 또는 `[{"id":"base","weight":3}]` 같은 비어 있지 않은 목록 |
| `sounds[].replace` | 하위 팩 사운드 정의를 대체할지 여부 |
| `sounds[].subtitle` | 기존 번역 키 또는 `null`. 번역을 추론하지 않음 |
| `sounds[].volume`, `pitch`, `stream` | 선택된 사운드 객체의 재생 설정 |

volume은 0 초과 1 이하, pitch는 0 초과 2 이하이며 weight는 양의 정수입니다. 원본 변형은 모두 컴파일되고 선택은 팩 전달만 제어합니다. 현재 Vorbis는 고정 quality-5이며 PCM 입력은 컴파일러의 48kHz 모노 WAV입니다.

예제의 포맷 88.0은 [26.2 릴리스 노트](https://www.minecraft.net/en-us/article/minecraft-java-edition-26-2), 현대 메타데이터는 [1.21.9 변경](https://www.minecraft.net/en-us/article/minecraft-java-edition-1-21-9), 새 아이템 진입점은 [클라이언트 아이템 계약](https://docs.neoforged.net/docs/1.21.4/resources/client/models/items/), 이벤트 매핑은 [사운드 정의 계약](https://docs.neoforged.net/docs/1.21.8/resources/client/sounds/)을 따릅니다. 최신 버전 별칭이 아닌 예제값·명시적 스키마 선택입니다. 메타데이터 변경이 형상·애니메이션·게임 등록을 다른 버전으로 변환하지 않습니다. 모델 exporter는 기존 호환 프로필을 유지하며 넓은 포맷 범위 선언이 그 범위를 인증하지도 않습니다.

## 실행과 출력

{{source-code:1}}

사운드 팩에는 `libvorbis` 포함 FFmpeg가 필요합니다. PATH의 `ffmpeg` 또는 `ASHFOX_FFMPEG_PATH`의 실행 파일을 사용합니다. 빌드 중 의존성을 받지 않습니다. 스프라이트·모델 전용 팩과 개별 WAV에는 인코더가 필요 없습니다. `check`는 FFmpeg 없이 그래프·선언을 검사하고 `build`는 출력·병합·인코딩·발행도 검증합니다.

반환 `exports`에는 이름 있는 팩 대상이 있고 불변 디렉터리 안에는 다음이 있습니다.

{{source-code:2}}

폴더는 항상, ZIP은 선택적으로 생성합니다. ZIP 항목은 순서·시각이 안정적이며 저장 모드를 사용합니다. 래퍼 폴더·영수증·WAV 원본 없이 리소스 팩 파일만 포함합니다. `kind: pack` 카탈로그는 `resourceRoot`, 선택 압축파일명, 프로젝트 버전을 기록합니다. 원래 PNG·WAV·모델 export는 일반 카탈로그 항목으로 유지됩니다.

팩 메타데이터는 `packs[].metadata`에서 한 번 생성하고 병합 시 개별 블록 exporter의 `pack.mcmeta`는 생략합니다. 다른 경로 중복은 바이트가 같아도 실패합니다. namespace마다 팩 안의 `sounds.json` 하나로 합칩니다. 선택 사운드는 인코딩 후 독립 디코딩하여 길이·클리핑을 확인하고 실제 출력 경로로 참조합니다.

빌드 실패는 이전 완전한 출력을 보존합니다. `verify`는 정식 번들을 검사하며 게임 빌드 전체에서 반환 빌드를 유지하세요. OGG 바이트 일치가 필요하면 FFmpeg를 고정합니다. 팩은 압축 전 8,192파일·64MiB입니다. [CLI 제한](cli.md)을 참고하세요.

## Minecraft에서 사용하기

반환된 `game_pack.zip`을 클라이언트의 `resourcepacks`에 복사하고 활성화합니다. 폴더 방식은 `pack.mcmeta`가 바로 들어 있는 `resource-pack`을 복사합니다. 프로젝트에 설정한 정확한 버전에서 검사하세요. 예제는 철검 외형·돌 모델을 바꾸며 사용자 사운드 이벤트는 게임이나 명령이 실행해야 합니다.

명령을 허용한 테스트 월드에서 확인하세요.

1. 같은 리소스를 바꾸는 팩보다 위에 활성화합니다. 설치 팩 교체 후 리소스를 다시 로드합니다.
2. `/give @s minecraft:iron_sword`로 인벤토리·손에 든 모습을 봅니다.
3. `/give @s minecraft:stone`을 놓고 교체된 marker를 봅니다.
4. 플레이어 근처에서 `/playsound demo:combat.claw_hit master @s ~ ~ ~ 1 1`을 반복해 변형을 듣습니다. 마스터 음량을 확인합니다.
5. 팩을 끄고 검·돌의 원래 외형과 비교합니다.

이벤트가 없으면 ZIP의 `assets/demo/sounds.json`과 OGG 참조를, 팩이 거부되면 `pack.mcmeta`와 클라이언트 버전을 비교해 설정을 수정·재빌드합니다. 수동 인수 검사이며 CLI 검증이 Minecraft를 실행하지 않습니다.

Ashfox는 Java 리소스 팩을 만듭니다. Bedrock 애드온 매니페스트, 새 블록·엔티티 등록, 모드 JAR 빌드, 자막 키 번역, 게임 폴더 설치, 실행 클라이언트 렌더 검증은 하지 않습니다. 아이템 ID는 기존 외형을 교체하거나 게임의 아이템 모델 컴포넌트에서 선택할 수 있지만 자체로 새 아이템 등록은 아닙니다. 사운드 정의도 전투·애니메이션 타임라인에 자동 연결되지 않습니다.
