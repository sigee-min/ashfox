---
name: review-pr
description: >-
  Audits a pull request or branch diff in the Ashfox repository against the
  development manifest, architecture boundaries, output invariance, and PR
  checklist. Use when reviewing a PR, inspecting branch changes, or checking
  squash-merge readiness.
---

# Review PR

Structured review runbook for Ashfox repository changes.

## Steps

1. **Gather context and authority**:
   - Inspect the PR metadata and diff (`gh pr view`, `gh pr diff`, or
     `git diff main...HEAD`).
   - Read [development-manifest.json](../../../development-manifest.json) and
     [codebase.md](../../../docs/architecture/codebase.md) for the touched areas.

2. **Check PR hygiene**:
   - Confirm branch name (`<type>/<short-slug>`), Conventional Commits title,
     and populated sections/checklists from
     [.github/PULL_REQUEST_TEMPLATE.md](../../../.github/PULL_REQUEST_TEMPLATE.md).
   - Verify the PR covers one atomic slice with no generated artifacts
     (`dist/`, local `.ashfox/`), unrelated edits, or secrets.

3. **Audit Ashfox invariants**:
   - **Single authority & closed contracts**: no parallel write paths,
     compatibility shims, or legacy re-exports; persisted/transport readers
     reject unknown keys; public contract changes add versioned contract tests.
   - **Pure core vs I/O adapters**: `packages/engine-core` performs no
     filesystem, network, or host imports; Node I/O stays in
     `packages/asset-build/src/node/` and `apps/cli`.
   - **Fail-closed stateful paths**: `success`, `cancellation`,
     `stale-revision`, `invalid-input`, and `exception` leave no partial state.
   - **Output invariance**: if `scripts/quality/products-baseline.json`
     changed, verify the PR intends that change, explains it in
     `## Scope & Impact`, and adds regression coverage.
   - **Complexity & format hygiene**: `scripts/quality/complexity-baseline.json`
     stays `{}` and `.prettierignore` gains no source exemptions.
   - **Docs & localization**: user-visible behavior or CLI changes update docs
     and translations together.

4. **Verify locally (when checked out)**:
   ```sh
   npm run quality:check
   npm run quality:products
   ```
   Run affected workspace test suites (or `npm run quality` for release-ready PRs)
   and confirm `prCheck.js` passes for the PR metadata.

5. **Report findings**:
   - Group output into **Blocking**, **Non-blocking**, and **Questions** with
     `file:line` references.
   - State observed verification results and a clear **Squash-merge readiness**
     verdict (`Ready` / `Changes requested`).
