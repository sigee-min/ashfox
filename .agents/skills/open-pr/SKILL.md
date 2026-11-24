---
name: open-pr
description: >-
  Guides repository contributors through branching, running Ashfox quality gates,
  validating PR metadata locally, and opening or updating a pull request against
  main. Use when preparing, validating, or creating a repository pull request.
---

# Open PR

Repository workflow runbook for changing Ashfox itself. For authoring `.ashfox`
assets, use [the published asset skill](../../../skills/ashfox/SKILL.md) instead.

## Steps

1. **Read authority files first**:
   - [development-manifest.json](../../../development-manifest.json) for engineering,
     workflow, commit, and quality rules.
   - [codebase.md](../../../docs/architecture/codebase.md) for ownership and
     dependency boundaries.
   - [CONTRIBUTING.md](../../../CONTRIBUTING.md) for verification commands.

2. **Create a scoped branch from `main`**:
   - Sync `main` (`git fetch origin && git switch main && git pull --ff-only`).
   - Branch with `<type>/<short-slug>` where `<type>` is one of
     `workflow.commits.types` in the manifest (`feat`, `fix`, `refactor`,
     `test`, `docs`, `chore`) and `<short-slug>` is lowercase kebab-case.
   - Keep one smallest complete slice per PR and preserve unrelated work.

3. **Verify changes with Node 24**:
   - Run focused workspace tests during iteration (prefix with
     `mise exec node@24.22.1 --` if the default PATH is not Node 24).
   - Before handoff or opening a PR, run:
     ```sh
     npm run quality:check
     npm run quality:products
     git diff --check
     ```
   - Before marking a PR ready for review, run the full release gate:
     `npm run quality`.
   - Never run `npm run quality:products:seal` unless the PR intentionally
     changes compiled outputs; explain any reseal in `## Scope & Impact`.

4. **Draft title and body**:
   - PR title must follow Conventional Commits (`workflow.commits` in the
     manifest). Include `!` in the title and a `BREAKING CHANGE:` footer if
     breaking.
   - Populate every section of
     [.github/PULL_REQUEST_TEMPLATE.md](../../../.github/PULL_REQUEST_TEMPLATE.md).
     Non-draft PRs require all items in `## Verification` and
     `## Review Checklist` to be checked (`- [x]`).

5. **Dry-run the PR gate locally**:
   ```sh
   npm run quality:pr -- \
     --branch "$(git branch --show-current)" \
     --title "<pr-title>" \
     --body-file <pr-body-file>
   ```
   Pass `--draft` when validating a draft PR.

6. **Push and open/update the PR**:
   - Push with `git push -u origin "$(git branch --show-current)"`.
   - Create or update with `gh pr create --base main ...` / `gh pr edit ...`.
   - Default merge strategy is **Squash and merge** so the PR title becomes the
     commit on `main`.
