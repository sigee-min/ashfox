# 아이템 스프라이트와 타일 만들기

스프라이트 원본은 아이템, 심리스 타일, 아이콘, 데칼용 정사각형 PNG(`16×16`, `32×32`, 또는 `64×64`)를 생성하며, CPU 품질 오딧과 4분할 `preview inspect { sheet = inspect; }` 시트를 제공합니다.

## 완전한 스프라이트 빌드하기

상위 워크스페이스가 없는 폴더에 다음 완전한 원본을 `gem.ashfox`로 저장하세요:

{{source-code:0}}

{{source-code:1}}

응답의 실제 export 디렉터리 안에 `gem.png`가 생성됩니다. `build` 전달 게이트는 `audit.passed === true` (`score >= 75`, 권장 `>= 85`)를 검증합니다.

## OKLCH 램프, 도형, 패턴, 아웃라인

- **`shape`와 `part`**: `rect`, `ellipse`, `capsule`, `polygon`, `line` 파라메트릭 도형이나 재사용 마스크를 겹쳐 형태를 만들고 `flat`, `round`, `bevel`, `cylinder`, `facet` 명암과 `specular`를 적용합니다.
- **OKLCH 램프**: `ramp { mode = auto; base = #...; preset = ...; }`는 10개 프리셋(`warm`, `cool`, `metal`, `gem`, `wood`, `stone`, `organic`, `cloth`, `emissive`, `vivid`)으로 하이라이트는 따뜻하게, 그림자는 차갑게 색조가 이동하는 5단 램프를 만듭니다.
- **`sel_out` & `innerRim`**: `outline` 레이어가 검은 테두리 대신 주변 색조와 밝기를 따르는 셀 아웃라인과 좌상단 내측 림 하이라이트를 그려줍니다.
- **심리스 타일 (`profile = tile`)**: `fill`·`pattern` 레이어(`brick`, `plank`, `voronoi`, `blotch`, `stripe`, `gradient`, `dither`, `crack`)는 캔버스 경계를 토로이달 래핑하여 이음새 없이 타일링됩니다.

[iron_sword 원본](../../examples/items/assets/sprites/iron_sword.ashfox), [mossy_stone 타일](../../examples/items/assets/sprites/mossy_stone.ashfox), [shared 모듈](../../examples/items/assets/module/shared.ashfox)에서 전체 예제를 확인할 수 있습니다. 워크스페이스에서 여러 스프라이트가 공유하는 모듈은 `assets/module/` 아래에 둡니다.

## 픽셀 리뷰하기

{{source-code:2}}

`preview inspect { sheet = inspect; }`는 브라우저 없이 CPU에서 512×512 4분할 리뷰 시트를 렌더링합니다:
- **아이템 / 아이콘 / 데칼**: `1x + 확대 미리보기`, `실루엣`, `명도(휘도)`, `팔레트 + 오딧 점수`
- **타일**: `1x 원본`, `3×3 심리스 타일링`, `명도(휘도)`, `팔레트 + 오딧 점수`

`stage` (`final`, `silhouette`, `shade`, `grain`)와 `scale` 미리보기 필드는 [관찰 제어](observe.md), 게임 엔진 및 Minecraft 연결은 [게임 에셋](game-assets.md)과 [Minecraft 팩](minecraft-packs.md)을 참고하세요.
