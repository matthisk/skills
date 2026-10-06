---
name: code-review-turbo
description: Run a multi-agent code review on the current branch's PR. Collects Oplane scan results, runs a Claude sub-agent, an Antigravity sub-agent, and a Cursor Agent (composer-2.5) in parallel, cross-references all findings to filter out hallucinations, and writes the final report to the Obsidian vault's Codereview directory. Use when you want a thorough, multi-perspective code review before merging.
metadata:
  disable-model-invocation: 'true'
  argument-hint: '[pr-number]'
allowed-tools: Bash(gh:*) Bash(agy:*) Bash(cursor-agent:*) Bash(cat:*) Bash(tee:*) Bash(sleep:*) Bash(test:*) Bash(ls:*) Agent Read Grep Glob Write(/tmp/*) mcp__oplane__* mcp__obsidian__*
---

# Code Review Turbo

Multi-agent code review: Oplane scan + Claude sub-agent + Antigravity + Cursor Agent (composer-2.5), with cross-referencing to separate real bugs from hallucinations.

## Step 1: Ensure PR Exists and Collect Oplane Scan

Oplane scans are triggered automatically when a PR is opened (or when new commits land), so the work here is mostly waiting for results and reading them.

Determine the PR number. If `$ARGUMENTS` is provided, use that as the PR number. Otherwise, try to detect it from the current branch:

```
gh pr view --json number,isDraft -q '{number: .number, isDraft: .isDraft}'
```

### If no PR exists

Create a **draft** PR for the current branch — this is what triggers the Oplane scan:

```
gh pr create --draft --fill
```

Tell the user you created a draft PR and that Oplane will scan it automatically.

### Check for stale Oplane scan

Oplane re-scans on every push, so "stale" means commits were pushed after Oplane's last scan finished.

1. Get the timestamp of the most recent Oplane check run:
   ```
   gh pr checks <number> --json name,completedAt,status,conclusion --jq '[.[] | select(.name | test("oplane"; "i"))]'
   ```

2. Get the timestamp of the most recent commit on the PR:
   ```
   gh pr view <number> --json commits --jq '.commits | last | .committedDate'
   ```

3. If the latest commit is **newer** than Oplane's most recent completed scan (or if Oplane has never run), the scan is stale — wait for it to start/finish (see polling below).

4. If Oplane's scan is **newer** than the latest commit and `conclusion` is set (success/failure/neutral), the scan is current. Proceed.

### Poll for Oplane's scan to finish

If the scan is still running or hasn't started, poll until it completes. Run individual commands — do NOT write a bash loop:

1. Run `gh pr checks <number> --json name,status,conclusion --jq '[.[] | select(.name | test("oplane"; "i"))]'`
2. If any matching check has `status` != `"completed"`, run `sleep 30`
3. Repeat up to 30 times (15 minutes total)

If Oplane never reports back, warn the user and ask whether to proceed without it or keep waiting.

### Collect Oplane's findings

Oplane surfaces results in two places:

1. **PR comments / review comments** posted by the Oplane bot account. Fetch unresolved review threads with the GraphQL API (so you can filter out resolved ones):
   ```
   gh repo view --json owner,name --jq '.owner.login + "/" + .name'
   gh api graphql -f query='
     query {
       repository(owner: "<OWNER>", name: "<REPO>") {
         pullRequest(number: <NUMBER>) {
           reviewThreads(first: 100) {
             nodes {
               isResolved
               comments(first: 10) {
                 nodes {
                   author { login }
                   body
                   path
                   line
                 }
               }
             }
           }
         }
       }
     }
   '
   ```
   Keep only threads where `isResolved` is `false` AND at least one comment has `author.login` matching `oplane` (case-insensitive). **Ignore resolved threads** — those are findings Oplane already considers fixed.

   Also check top-level PR comments (rare but possible):
   ```
   gh pr view <number> --json comments --jq '[.comments[] | select(.author.login | test("oplane"; "i")) | select(.isMinimized | not)]'
   ```

2. **The Oplane MCP** (`mcp__oplane__*`) for richer scan detail than what's mirrored to GitHub. If the MCP tools aren't loaded yet, run `mcp__oplane__authenticate` first, walk the user through the OAuth flow, then use the tools to pull the scan for this PR. Prefer the MCP when available — it typically includes severity, rule IDs, and more context than the inline comments.

Save all active (non-resolved) Oplane findings for later comparison.

## Step 2: Build the Review Prompt

Gather the PR context by running these commands:

```
gh pr diff <number>
gh pr view <number> --json title,body,baseRefName,headRefName
```

Then construct the following review prompt (referred to as `REVIEW_PROMPT` below). This EXACT prompt must be used for ALL THREE sub-agents (Claude, Antigravity, Cursor) — do not alter it between them. Identical prompts are what make the cross-referencing statistically meaningful; diversity must come from the model, not from the instructions:

---

**START OF REVIEW_PROMPT**

You are reviewing a pull request. Here is the diff:

<INSERT PR DIFF HERE>

PR title: <INSERT>
PR description: <INSERT>
Base branch: <INSERT>
Head branch: <INSERT>

Review this PR thoroughly. Focus on these categories IN ORDER OF IMPORTANCE:

### 1. Functional Bugs (MOST IMPORTANT)
Look for logic errors, off-by-one errors, null/undefined issues, race conditions, incorrect conditionals, missing edge cases, wrong variable usage, broken control flow, and any code that simply won't work as intended. This is BY FAR the most important category.

### 2. KISS Violations
Overly complex solutions where simpler ones exist. Unnecessary abstractions, premature generalizations, or convoluted logic.

### 3. DRY Violations
Duplicated logic that should be extracted. Copy-pasted code with minor variations.

### 4. Missing Tests
New functionality or bug fixes lacking appropriate test coverage.

### 5. Performance Issues
- For SQL queries: DO NOT GUESS what the query planner will do. Instead, run `EXPLAIN ANALYZE` on the actual local database to verify.
- For migrations: Will they lock tables for too long? Are they safe for large tables?
- For application code: N+1 queries, unnecessary allocations, missing batching, O(n^2) loops on large datasets.

### 6. Accessibility Issues
For any TSX/JSX files: missing aria labels, improper heading hierarchy, missing alt text, keyboard navigation issues, color contrast concerns.

DO NOT report:
- Code formatting or style issues (these are linted automatically)
- Minor TypeScript type issues (also linted)
- Nitpicks that don't affect correctness or maintainability

For each issue found, report:
- **File and line number** (from the diff)
- **Severity**: critical / high / medium / low
- **Category**: which of the above categories
- **Description**: what the issue is and why it matters
- **Suggestion**: how to fix it

Return a structured list grouped by severity (critical first, then high, medium, low).

**END OF REVIEW_PROMPT**

---

## Step 3: Run Sub-Agents in Parallel

Launch ALL THREE of these at the same time — invoke them as three tool calls in a single response so the harness runs them concurrently:

### 3a. Claude Sub-Agent
Use the Agent tool to spawn a sub-agent with the full `REVIEW_PROMPT`. This agent should have access to Bash, Read, Grep, and Glob tools so it can run EXPLAIN queries and inspect code.

### 3b. Antigravity
Run the EXACT SAME `REVIEW_PROMPT` through the Antigravity CLI (`agy`). First write the prompt to a randomly-named temp file using the Write tool (e.g., `/tmp/review-prompt-<random-8-chars>.txt` — generate a unique random suffix to avoid collisions with concurrent agents), then pipe it via stdin:

```
agy -p --dangerously-skip-permissions < /tmp/review-prompt-<random>.txt
```

- `-p` (alias for `--print`) runs a single prompt non-interactively and prints the response.
- With no prompt argument supplied on the command line, `agy -p` reads the prompt from stdin.
- `--dangerously-skip-permissions` auto-approves tool permission requests so the sub-agent can read files and run commands without blocking.
- If the review may run longer than the default 5-minute print timeout, pass `--print-timeout 15m` (or similar).

### 3c. Cursor Agent (composer-2.5)
Run the EXACT SAME `REVIEW_PROMPT` through the Cursor Agent CLI (`cursor-agent`), using `composer-2.5` for code review. **Reuse the same temp file written in step 3b** — the skill mandates identical prompts across all reviewers, so writing the prompt twice would create a drift surface for no benefit. Pipe it via stdin:

```
cursor-agent -p --force --trust --model composer-2.5 < /tmp/review-prompt-<random>.txt
```

- `-p` (alias for `--print`) runs a single prompt non-interactively and prints the response.
- With no positional prompt argument, `cursor-agent -p` reads the prompt from stdin.
- `--force` auto-approves tool/permission requests (analogue of agy's `--dangerously-skip-permissions`).
- `--trust` trusts the current workspace; cursor-agent requires this in fully-headless `--print` mode or it will refuse to run tools.
- `--model composer-2.5` selects the "Composer 2.5" model — used here because GPT-5.5 is gated to the Max tier on this account.
- **Timeout caveat:** cursor-agent has no `--print-timeout` flag, so this run is bounded by the Bash tool's 10-minute cap. If you hit that cap on a large PR, retry once with `--model composer-2.5-fast` (same model, optimized for latency). If it still times out, warn the user and proceed with the remaining sources.
- **Auth:** `cursor-agent` requires either `CURSOR_API_KEY` in the environment or a prior `cursor-agent login`. The skill does NOT pre-check — if the invocation errors with an auth message, surface it to the user verbatim.

## Step 4: Cross-Reference and Validate

**CRITICAL: DO NOT do any of your own code research, file reading, or EXPLAIN queries until ALL FOUR sources (Oplane, Claude sub-agent, Antigravity, Cursor (composer-2.5)) have returned their results.** If you investigate the code first, you will form your own opinions and become a 5th agent with a veto over the other 4 — biased toward confirming your own findings and dismissing theirs. The whole point of this step is to be an OBJECTIVE judge of four independent reviewers.

### Step 4a: Compile findings FIRST (no research yet)

Collect and deduplicate all findings from the four sources into a single list. For each unique issue, note which source(s) reported it. Do NOT yet judge whether the issues are real — just organize them.

### Step 4b: NOW do your own research to validate

Only after compiling the full list, go through each finding and verify it:

- **Read the actual source code** around each reported issue (not just the diff)
- **Run EXPLAIN ANALYZE** on any flagged SQL queries against local database
- **Check test files** to see if flagged "missing tests" actually exist
- **Trace the logic** for any reported functional bugs — actually verify the bug is real

For each unique issue, determine:
- Is it a **real issue** (confirmed by your investigation)?
- Is it a **hallucination** (the code doesn't actually have this problem)?
- Which sources found it and which missed it?

Be especially careful not to dismiss a finding just because only one source reported it — sometimes the lone dissenter found the most critical bug.

## Step 5: Write Report to Obsidian Vault

**Do NOT dump the full report into the chat.** Write it as a Markdown note in the `Codereview/` directory of the user's Obsidian vault, using the **Obsidian MCP** (`mcp__obsidian__*`) — do NOT write to the local file system. In the chat, surface only the vault-relative path of the saved note plus a one- or two-sentence merge recommendation.

### Step 5a: Vault access

The Obsidian MCP is already pointed at the user's vault, so all paths are **relative to the vault root** (e.g. `Codereview/2026-05-27_PR280_cloudview.md`). You don't need to locate the vault on disk. `mcp__obsidian__vault_write` creates the `Codereview/` directory automatically if it doesn't exist; call `mcp__obsidian__vault_list` with `path: "Codereview"` first if you want to match the shape of existing notes.

### Step 5b: Pick a filename

Use the pattern `YYYY-MM-DD_PR<number>_<repo>.md`:

- `YYYY-MM-DD` — today's date
- `<number>` — the PR number
- `<repo>` — the short repo name (the part after `/` in `gh repo view --json owner,name --jq '.name'`)

Example: `2026-05-27_PR280_cloudview.md`.

### Step 5c: Write the note

Write the note with `mcp__obsidian__vault_write`, passing `path: "Codereview/<filename>"` (vault-relative) and `content` set to the full report.

Use the structure below — it mirrors the existing notes in the directory, so keep callouts, table shapes, and severity grouping consistent. Each finding gets a sub-heading like `### C1 — <short title>` (C/H/M/L = critical/high/medium/low, numbered within section).

```markdown
---
title: "PR #<num> — <PR title>"
date: <YYYY-MM-DD>
repo: <owner>/<repo>
pr: <num>
branch: <head>
base: <base>
url: <PR url>
tags:
  - codereview
  - <repo-short-name>
  - code-review-turbo
sources:
  - oplane
  - claude
  - antigravity
  - cursor-composer-2.5
verdict: <ready-to-merge | merge-after-fixes | needs-rework>
---

# Code Review Turbo — PR #<num>

> [!info] Sources
> Four sources cross-referenced: **Oplane** (security threat model), **Claude sub-agent**, **Antigravity (`agy`)**, **Cursor (composer-2.5)** (`cursor-agent` running composer-2.5). Findings validated against actual source.

- **Repo:** `<owner>/<repo>`
- **Branch:** `<head>` → `<base>`
- **Title:** <PR title>
- **PR:** <PR url>
- **Threat model:** <Oplane threat model link, if available>

---

## Critical Issues

### C1 — <short title>

**File:** `<path>:<line-range>`
**Sources:** <which of Oplane / Claude / Antigravity / Cursor (composer-2.5) flagged it> · **Verdict: REAL**

<explanation anchored to actual code, with line citations>

> [!tip] Suggestion
> <how to fix; code block if useful>

---

## High Issues
<!-- H1, H2, ... — same shape as Critical -->

## Medium Issues
<!-- M1, M2, ... -->

## Low Issues
<!-- L1, L2, ... -->

---

## Dismissed Findings

| #   | Source | Finding | Why dismissed |
| --- | ------ | ------- | ------------- |
| D1  | ...    | ...     | ...           |

---

## Agent Agreement Summary

| Issue | Oplane | Claude | Antigravity | Cursor (composer-2.5) | Verdict |
| ----- | :----: | :----: | :---------: | :-------------------: | ------- |
| ...   |  ...   |  ...   |     ...     |          ...          |   ...   |

<one or two sentences calling out where the agents agreed/disagreed and what that implies>

---

## Merge Recommendation

> [!warning] <one-line verdict matching the frontmatter `verdict`>
> <2–4 sentences explaining what's blocking merge and why>

<optional ordered list of must-fix items before merge>
```

Notes on the format:

- Use Obsidian callouts (`> [!info]`, `> [!tip]`, `> [!warning]`) — they render natively in Obsidian.
- The frontmatter `verdict` value must be one of `ready-to-merge`, `merge-after-fixes`, or `needs-rework`, and should match the heading in the Merge Recommendation callout.
- Omit empty severity sections (e.g. drop the `## Low Issues` heading entirely if there are no low issues) — do not leave placeholder text.
- The Dismissed Findings table should briefly explain *why* each finding was discarded (hallucination, intentional trade-off, already addressed, etc.).

### Step 5d: Reply in the chat

After the note is written, your chat response should be just:

1. The vault-relative path of the saved note (e.g. `Codereview/2026-05-27_PR280_cloudview.md`).
2. The merge recommendation, in one or two sentences.

No headings, no full reproduction of findings — the vault is the source of truth.
