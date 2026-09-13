# Native sound studies

Every source in `src/` uses reusable voices, scheduled sequences, common curves,
explicit seeded variation, fixed output gain and playback intent.

- `bird_call`, `griffin_call`, `wolf_howl`, `frog_croak`: procedural voice studies.
- `claw_hit`, `wing_whoosh`, `footsteps`: impacts and movement.
- `metal_strike`, `wood_knock`, `glass_ping`: modal resonance studies.
- `charging_spell`: animated pitch, FM index, gain and lowpass.
- `wind_loop`, `fire_loop`, `mechanical_loop`: 188160-frame baked loops.
- `bell_pattern`: all five features together, 96960 delivered frames.

These are authored listening studies, not recordings or guarantees of realism.
Listen to complete phrases and at least 20 loop cycles before approving quality.
Standalone WAV players need full-buffer looping; OGG/Minecraft loop delivery is
rejected. One-shot OGG remains available with FFmpeg.

Existing source gains were measured against both old variants and fixed at the
lower effective gain minus 2 dB. This preserves headroom without RMS normalization;
new baseline timbre and levels still require human audition.

Listening review on 2026-09-13: the user auditioned and approved the presented
`bird_call`, `metal_strike` and `wind_loop` examples. This records those three
examples only; the remaining corpus and every alternate still need explicit
listening review. Automated tests cover all 30 outputs separately.
