## Summary

<!-- What changed and why, in 1-3 bullets. Link any issue (`Closes #...`). -->

## Scope & Impact

- **Changed areas**: <!-- e.g. `packages/engine-core`, `apps/cli`, `docs/` -->
- **External contracts / compiled outputs**: <!-- Unchanged (`quality:products` ok) / Changed (explain why resealed) -->
- **Breaking change**: <!-- None / Yes (`!` in title + `BREAKING CHANGE:` in body) -->
- **Rollback**: <!-- Safe to revert squash commit / Notes if migration or reseal needed -->

## Verification

- [ ] `npm run quality:check` (format, typecheck, manifest, commits, architecture, complexity)
- [ ] `npm run quality:products` (example output bytes unchanged, or reseal explained above)
- [ ] `npm run quality` (complete release gate before ready-for-review)

<!-- Paste focused commands or key verification output here. -->

## Review Checklist

- [ ] Single mutation authority preserved; no derived write path or compatibility shim introduced.
- [ ] Stateful paths (success, cancellation, stale revision, invalid input, exception) terminate cleanly.
- [ ] User-visible behavior, CLI contracts, and docs/translations stay aligned.
- [ ] No generated output (`dist/`, local `.ashfox/`), unrelated work, or secrets included.
