# VFX 문법 레퍼런스

네이티브 VFX 파일은 `ashfox 1` 헤더 뒤에 `vfx <name> { ... }` 또는 공유 팔레트 `module <name> { ... }`를 선언합니다.

## 루트 계약

| 선언 / 필드 | 계약 |
| --- | --- |
| `duration` | 이펙트 길이(초 단위, 예: `0.65s`) |
| `fps` | 정수 재생 샘플 레이트 |
| `loop` | `once` 또는 `loop` |
| `palette` | 팔레트 참조(`pal.Name`) 또는 인라인 `palette { core = #...; mid = #...; edge = #...; smoke = #...; }` |
| `import` | 공유 팔레트 모듈(`import "../module/palettes.ashfox" as pal;`) |
| `preview` | 이름 있는 캡처 뷰(`time`, `sheet = flipbook`, `background = dark | studio | transparent`, `width`, `height`) |
| `element <id> : <primitive>` | 절차적 지오메트리 요소(`slash_arc`, `ribbon`, `ring`, `beam`, `dome`) |
| `emitter <id> : voxel_burst` | 결정적 입자 시뮬레이션 방출기 |

## 지오메트리 요소 (`element <id> : <primitive>`)

`element` 공통 속성: `at = <start>..<end>;`, `blend = additive | blend | premul;`, `texture <kind> { ... }`, `dissolve <mode> { ... }`, `position`, `rotation`, `scale`, `alpha`, `color` / `color_over_life`.

- **프리미티브**:
  - `: slash_arc` — `radius = inner..outer;`, `arc = startDeg..endDeg;`, `pitch`, `segments`, `tip_taper`, `crossed`
  - `: ribbon` — `points = [(x, y, z), ...];`, `width = start..end;`, `profile = crossed | tube;`
  - `: ring` — `radius = inner..outer;`, `segments`, `bevel_height`, `ripple_amp`, `ripple_freq`
  - `: beam` — `start = (x, y, z);`, `end = (x, y, z);`, `width`, `style = column | lightning;`, `jagged_amp`, `forks`, `fork_depth`, `seed`
  - `: dome` — `shape = hemisphere | sphere | cone | torus;`, `radius`, `inner_radius`, `height`, `subdiv = 1 | 2;`
- **절차적 텍스처 (`texture <kind>`)**: `slash_streak`, `radial_flare`, `starburst`, `ring_wave`, `magic_circle`, `stylized_smoke` (`width`, `height`, `posterize`, `bristles`, `spikes`, `runes`, `rings`, `curl_scale`, `tint`, `seed`).
- **디졸브 스트립 (`dissolve <mode>`)**: `voronoi`, `simplex`, `directional_wipe`, `radial_noise` (`frames`, `edge_width`, `edge_glow = core | mid | edge | smoke;`, `direction`, `seed`).

## 입자 방출기 (`emitter <id> : voxel_burst`)

`emitter` 내부: `at = <start>..<end>;`, `seed`, `count`, `shape` (`point`, `cone(angle, radius)`, `sphere(radius)`, `ring(radius[, inner])`, `box(x, y, z)`, `arc(sweep, radius)`), `particle = voxel_cube | shard | puff | cross_card;`, `speed = min..max;`, `life = min..max;`, `gravity`, `drag`, `turbulence = curl(freq, amp);`, `vortex { axis; center; strength; radial_pull; }`, `ground { y; bounce; friction; }`, `size_over_life`, `color_over_life`, `velocity_stretch`, `blend`.

작성 워크플로·플립북 캡처·전달 규칙은 [스타일라이즈드 VFX 제작과 검토](../guides/vfx.md)를 참고하세요.
