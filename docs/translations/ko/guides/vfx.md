# 스타일라이즈드 VFX 제작과 검토

네이티브 `.ashfox` 원본(`ashfox 1`, `vfx <id>`)으로 스타일라이즈드 게임용 이펙트를 작성하고 CLI로 컴파일합니다. 각 이펙트는 3종 런타임 산출물(`KHR_materials_unlit`·`extras.ashfoxBlendMode`를 포함한 `.glb`, 셰이더·타이밍 레시피 `.vfx.json`, 베이크된 입자 시뮬레이션 `.particle.json`)을 출력하며 필요 시 2D 플립북 시트(`sheet = flipbook`)를 생성합니다.

## 스타일라이즈드 VFX 작성하기

{{source-code:0}}

{{source-code:1}}

## 구성, 블렌드 및 런타임 예산

1. **층위 가독성**: 선명한 지오메트리 요소(`slash_arc`, `ribbon`, `ring`, `beam`, `dome`)와 결정적 `emitter` 입자 방출, 단계화된 팔레트(`core` -> `mid` -> `edge` -> `smoke`), 날카로운 디졸브 실루엣(`voronoi`, `simplex`, `directional_wipe`, `radial_noise`)을 조합하세요.
2. **블렌드 모드와 소프트 알파**: 발광 코어에는 `blend = additive`, 부드러운 연기·먼지에는 `blend = premul` 또는 `blend = blend`를 사용합니다. 내보내기 시 8비트 소프트 알파 텍스처와 `KHR_materials_unlit`, `extras.ashfoxBlendMode`를 기록합니다.
3. **플립북 및 피크 프레임 점검**: `preview flipbook { sheet = flipbook; }`로 스프라이트 시트와 `.flipbook.json` 메타데이터를 렌더링하고 `time = ...` 및 `background = dark` 뷰로 프레임별 실루엣과 타이밍을 확인하세요.
4. **예산 제한 및 표준 레시피**: 빌드된 `.glb` 산출물은 게임용 예산(`<= 4` 드로우, `<= 2,500` 삼각형, `<= 150 KB`)을 준수합니다. `std/vfx/*`(`weapon/plasma_bolt`, `shield/*`, `magic/*`, `weather/*`, `impact/*`)의 파라메트릭 `export recipe`를 `use`로 재사용할 수 있으며 예제는 `showcase/assets/vfx/plasma_bolt.ashfox`를 참고하세요.

전체 `ashfox 1` VFX 문법과 블록 옵션은 [VFX 문법 레퍼런스](../language/vfx.md)를 참고하세요.
