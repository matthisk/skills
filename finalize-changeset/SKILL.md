---
name: finalize-changeset
description: Finalize a changeset for merging — fix all formatting, lint, type, and test failures locally, then ensure a draft PR is open and iterate until CI is green. Use this whenever the user signals they are done with a branch and want it merge-ready: "finalize this", "ready to merge", "make CI green", "ship this", "polish this up", "fix everything before I merge", "I'm done with this changeset". Detects project tooling (pnpm/npm/yarn, jest/vitest, eslint, prettier, tsc, go/python/rust equivalents) automatically. Does NOT trigger for one-off requests like "run the tests" or "format this file" — only when the goal is end-to-end merge-readiness.
---

# Finalize Changeset

Drive a working branch from "code is written" to "CI is green and PR is ready for review." Three phases: clean up locally, ensure a draft PR exists, watch CI and iterate on failures.

## Preconditions

Before running anything, sanity-check the branch state:

- `git rev-parse --abbrev-ref HEAD` should not be `main` / `master` / `trunk`. If it is, stop and tell the user — this skill is for feature branches, not for finalizing the trunk.
- `git log <main>..HEAD --oneline` should have at least one commit. If the branch has no commits ahead of the base, there is nothing to finalize.
- If `git status` shows uncommitted work that looks intentional (not just stray dotfiles), call it out before starting — the cleanup phase may modify those files, and the user may want to commit first so the cleanup commit is separable.

## Phase 1 — Detect project tooling

Skills like this break if you hardcode commands. Figure out what this project actually uses:

1. **Package manager / ecosystem:** `pnpm-lock.yaml` → pnpm, `yarn.lock` → yarn, `package-lock.json` → npm. For other ecosystems: `go.mod` → Go, `pyproject.toml` / `requirements.txt` → Python, `Cargo.toml` → Rust, `Gemfile` → Ruby. A repo can mix these — don't assume one.

2. **Available scripts (JS/TS):** Read `package.json#scripts` and look for `format`, `lint`, `lint:fix`, `typecheck` / `type-check` / `tsc`, `test`. Prefer the project's own scripts over invoking tools directly — the scripts often pass flags the bare command would miss.

3. **Other ecosystems:** Use ecosystem defaults — `gofmt -w .` + `go vet ./...` + `go test ./...`, `ruff format` + `ruff check --fix` + `mypy` + `pytest`, `cargo fmt` + `cargo clippy --fix` + `cargo test`, etc.

4. **CI checks:** Skim `.github/workflows/*.yml` to learn which checks CI actually runs. Those are the source of truth for "merge-ready" — local steps that don't exist in CI are nice-to-have, but checks that exist in CI must pass.

If anything is ambiguous (multiple lockfiles, monorepo with per-package scripts, custom tooling), ask the user once at the start rather than guessing and re-doing work later.

## Phase 2 — Local cleanup

Run cleanup in this order. The order matters: formatters can introduce changes that lint complains about; lint fixes can introduce changes that types catch; type fixes can change behavior that tests catch. Going out-of-order means redoing work.

1. **Format** (auto-fix): `pnpm format`, `prettier --write .`, `gofmt -w .`, `cargo fmt`, `ruff format`.
2. **Lint** (auto-fix where possible): `pnpm lint:fix`, `eslint . --fix`, `ruff check --fix`, `cargo clippy --fix --allow-dirty --allow-staged`.
3. **Typecheck:** `pnpm typecheck`, `tsc --noEmit`, `mypy`, `cargo check`. (Go's `go vet` is closer to lint than types.)
4. **Tests:** `pnpm test`, `pytest`, `go test ./...`, `cargo test`.

For each step:

- Auto-fixes are fine — let the tool do its job. Just re-run after to confirm clean.
- For errors that can't be auto-fixed (most type errors, test failures), read the output, find the root cause, and fix the underlying code. Resist the urge to read just the first line of an error — TypeScript and test runners often have the real cause several lines down.
- **Do not suppress errors as a shortcut.** No new `@ts-ignore`, `@ts-expect-error`, `eslint-disable-next-line`, `.skip`, `xit`, `@pytest.mark.skip`, `#[allow(...)]`, etc. unless the user has explicitly approved it. These change behavior, not just style, and often hide the real bug.
- Re-run the step after each fix until it's clean before moving to the next phase. A "passing" typecheck that still has 12 errors you decided to look at later doesn't count.

Once everything passes locally:

- If the cleanup produced changes, stage and commit them. Use a concise message that reflects what actually changed — `chore: fix formatting` if it was just formatter output, something more descriptive if you fixed real bugs.
- If nothing changed, skip the commit. An empty commit just adds noise.

## Phase 3 — Ensure a draft PR exists

Push the branch (`git push -u origin HEAD` if the upstream isn't set, otherwise `git push`). If the remote already has commits the local branch doesn't, stop and ask the user — a force-push to resolve this is destructive and shouldn't happen silently.

Check for an existing PR:

```bash
gh pr view --json number,isDraft,url,headRefName
```

**If none exists:** Create a draft PR. Generate the title and body from the commits + diff against the base branch:

- Title: short (<70 chars), present-tense, describes the change in one phrase. Skip Conventional Commits prefixes unless the repo uses them everywhere.
- Body: a short "## Summary" with 1-3 bullets explaining what changed and why, followed by a "## Test plan" checklist. Look at recent merged PRs (`gh pr list --state merged --limit 5`) to match the repo's house style.
- Always open as `--draft`. The user finalizes the draft status themselves once they've reviewed CI.

**If a PR exists:** confirm the latest commits are on the remote, then report the URL. Don't change the PR's draft status, title, or body unless asked — the user may have already edited them.

## Phase 4 — Drive CI to green

CI runs on push. Watch it:

```bash
gh pr checks --watch
```

**All checks pass:** Done. Report the PR URL and tell the user it's ready for their review (still a draft — they mark it ready when they're satisfied).

**A check fails:** Don't react to the job name alone — pull the actual logs and read them. The same job can fail for very different reasons (flake, real bug, broken infrastructure).

```bash
gh pr checks --json name,conclusion,detailsUrl
gh run view <run-id> --log-failed
```

Diagnose:

- **Real bug in the diff:** fix the underlying code, commit, push, and re-watch.
- **Real bug unrelated to the diff** (e.g., a flaky test you didn't touch but always fails): fixing it is in scope only if it blocks merge. Otherwise, surface it to the user instead of silently expanding the change.
- **Obvious flake or infra issue** (network blip, OOM in CI runner): you can re-run the failed job (`gh run rerun <run-id> --failed`), but say out loud that you're doing it. Don't quietly re-run on every red.

**Cap the auto-fix loop at 3 iterations.** If CI is still red after three rounds of fix-and-push, stop and hand back to the user with a summary of what's failing and what you tried. Repeated CI failures usually signal something the skill can't see (environment differences, secrets, ordering), and pushing more commits is unlikely to help without human input.

## When to pause and ask

These actions look small but have outsized effects — ask before doing any of them:

- Adding any new suppression (`@ts-ignore`, `eslint-disable`, `skip`, etc.).
- Editing files outside the original diff to fix a transitive issue.
- Changing test assertions or removing tests to make them pass.
- `git push --force` / `--force-with-lease` for any reason.
- Modifying CI configuration (`.github/workflows/*`) to make checks pass.

If you find yourself reaching for one of these, that's the signal that the change is bigger than "polish before merge" — bring the user in.

## What done looks like

- Local format / lint / typecheck / tests all clean.
- Branch is pushed, draft PR exists with a sensible title and body.
- All required CI checks are green, **or** you stopped after 3 fix attempts and clearly summarized what is still failing.
