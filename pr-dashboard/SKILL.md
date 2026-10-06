---
name: pr-merge-readiness
description: Produce a merge-readiness report for the current user's open GitHub PRs and render it as a datatable + priority summary on a fixed reusable Miro board. For each open PR it checks mergeability/conflicts, draft status, review decision and requested reviewers, required/failing checks, blocking security or bot comments (Oplane, SonarQube, Wiz), unresolved review threads, and whether a review was already asked for in Slack. Use this whenever the user asks about the state of their pull requests, wants to know "what's ready to merge", "what am I waiting on", a "PR status / merge readiness report", a "PR roundup", or wants their open PRs triaged onto a Miro board. Trigger even if the user doesn't say "Miro" or "merge readiness" verbatim — any request to review, summarize, or prioritize their own open PRs across repos should use this skill.
metadata:
  argument-hint: '[optional: author or extra instructions]'
allowed-tools: Bash(gh:*) Read Agent mcp__plugin_slack_slack__slack_search_public_and_private mcp__plugin_slack_slack__slack_read_thread mcp__plugin_miro_miro__board_list_items mcp__plugin_miro_miro__table_list_rows mcp__plugin_miro_miro__table_sync_rows mcp__plugin_miro_miro__doc_create mcp__plugin_miro_miro__doc_update
---

# PR Merge-Readiness Report

Survey the user's open GitHub PRs, judge how close each is to merging, verify whether a review was already requested in Slack, and refresh a fixed Miro board with a datatable plus a short priority summary.

The value of this skill is **honest triage**: every claim is grounded in real data (GitHub API + Slack search), nothing is guessed, and the final board tells the user at a glance what they can merge now versus what's stuck and why.

## Output contract

The skill reuses a **single fixed Miro board** — it never creates a new board:

- Board URL: `https://miro.com/app/board/uXjVHG5fAOs=/`

On that board, the skill refreshes:

1. The existing **datatable** with exactly these columns:
   `PR | Repository | Merge Readiness | Waiting On | Asked for Review | Comments`
2. A **priority summary** document next to/below the table, grouping PRs into: ready/almost ready, blocked by CI/checks, blocked by review, and stale/needs-a-decision.

The **Comments** column is always preserved — if a row for the same PR existed previously, carry forward whatever the user typed into Comments; for brand-new PR rows leave it empty.

Default scope is **the current user's own open PRs**. If `$ARGUMENTS` names a different author or adds constraints (e.g. a specific repo), honor that; otherwise use `@me`.

---

## Step 1 — Find the open PRs

```
gh search prs --author=@me --state=open --json repository,number,title,url,isDraft,createdAt,updatedAt --limit 100
```

If the user asked about a different author, swap `@me` for `--author=<login>`. If they scoped to a repo, add `--repo <owner/repo>`.

If there are zero results, say so plainly and stop — there's nothing to report.

## Step 2 — Gather per-PR detail

For each PR, collect the signals below. **Run one command per PR rather than a shell `for` loop** — the loop syntax is shell-dependent and silently breaks under fish (the user's default shell); independent per-PR calls also parallelize well, so issue them together in one message.

**Core status** (note: `gh pr view` requires the number as a positional arg *and* `--repo`; passing only `--repo` errors):

```
gh pr view <num> --repo <owner/repo> --json number,title,url,isDraft,mergeable,mergeStateStatus,reviewDecision,reviewRequests,latestReviews,headRefName,baseRefName,updatedAt
```

**Checks** (find anything not passing):

```
gh pr checks <num> --repo <owner/repo>
```

`gh pr checks` exits non-zero when a check is failing — that's expected, read the output anyway. Skipped checks are normal and not failures. A `mergeStateStatus` of `UNSTABLE` usually means a non-required check is failing or pending; `BLOCKED` usually means review is required; `CLEAN` means good to go; `DIRTY`/`CONFLICTING` means merge conflicts.

**Unresolved review threads** (line-level conversations that must be resolved before merge):

```
gh api graphql -f query='
query($owner:String!,$repo:String!,$num:Int!){
  repository(owner:$owner,name:$repo){
    pullRequest(number:$num){
      reviewThreads(first:50){
        nodes{ isResolved isOutdated path
          comments(first:1){ nodes{ author{login} body url } }
        }
      }
    }
  }
}' -F owner=<owner> -F repo=<repo> -F num=<num> \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved==false) | {path, author:.comments.nodes[0].author.login, body:.comments.nodes[0].body[0:200], url:.comments.nodes[0].url}'
```

**Blocking bot / security comments** — read issue comments and pick out the ones that gate merge:

```
gh pr view <num> --repo <owner/repo> --json comments --jq '.comments[] | {author:.author.login, body:.body[0:400]}'
```

Bots to weigh, and how to read them:
- **SonarQube** (`sonar-*`): a failed Quality Gate (e.g. "0% Coverage on New Code", required ≥80%) is a real blocker. Capture the specific failed condition.
- **Oplane** (`oplane-bot`): "All requirements are satisfied" = fine. "N requirement(s) need attention" = read which ones and their severity (a 🔴 *Not implemented* High is blocking; a Low may be acceptable risk — report it, don't overstate it).
- **Wiz / container scan** (`github-actions`): a PASSED scan is informational; a failed/blocking scan matters.
- Distinguish the user's own comments (e.g. `/deploy staging-eu`, design notes) — those aren't blockers, but a self-comment can be useful context.

## Step 3 — Detect stacked PRs

If one PR's `baseRefName` equals another of the user's PRs' `headRefName`, they are **stacked**: the child can't cleanly merge until the parent lands. This materially changes "waiting on" — flag the stack, identify which PR is the base (the one whose base is `main`/`master`), and note the merge order. Don't mark a child "Ready" if its parent hasn't merged; at best it's "Close, but not ready" with "parent #X must merge first" in *Waiting On*.

## Step 4 — Verify Slack review asks (never guess)

For each PR, search Slack for an **explicit** review request the user posted. This is a verification step, not a vibe check: only count a message that actually asks someone to review *that* PR (links the PR URL or names its ticket and asks for a look). A standup line that merely mentions the PR, or an announcement that shares it, does **not** count.

Run a few targeted searches (the user's own messages, by PR URL fragment and by ticket key):

```
mcp__plugin_slack_slack__slack_search_public_and_private  query="from:me <repo>/pull/<num> review"
mcp__plugin_slack_slack__slack_search_public_and_private  query="from:me <TICKET-KEY> review"
mcp__plugin_slack_slack__slack_search_public_and_private  query="from:<@USER_ID> github.com/<owner>/<repo>/pull"
```

Sort by timestamp and prefer the most recent matching ask. One Slack message can cover several stacked PRs at once — if it lists multiple PR links and asks for review, it counts for each PR it lists.

For the *Asked for Review* cell:
- Match found → `Yes — <channel/DM>, <date>: <permalink>` (use the real `permalink` from the result).
- No explicit ask → exactly `Not found`. If there's a related-but-non-review post (an announcement/share), you may append `— only an announcement post (not a review ask): <permalink>` so the user can judge, but the verdict stays "Not found".

If the Slack MCP tools aren't available in this session, don't fail — fill every *Asked for Review* cell with `Not checked (Slack unavailable)` and mention the limitation in your closing message.

## Step 5 — Judge merge readiness

Pick exactly one label per PR. These are judgment calls grounded in the signals above, not a rigid checklist — explain the *why* in *Waiting On*.

- **Ready** — Mergeable, not a draft, review satisfied (APPROVED or no review required), all required checks green, no unresolved blocking threads or bot findings, and (if stacked) no unmerged parent. It could merge right now. Soft follow-ups (an unanswered reviewer question, a non-required reviewer still pending) can still be noted in *Waiting On* without downgrading the label.
- **Close, but not ready** — Mergeable and CI green, but one clear, easy step remains: usually awaiting review approval, or it's a stacked child whose only blocker is the parent merging first.
- **Not ready** — A substantive blocker: failing required check (Sonar gate, etc.), a blocking bot/security finding, merge conflicts, requested changes, or unresolved blocking threads.
- **Stale / unclear** — Open a long time with no reviewers, no review decision, no real CI, and no clear path — or a long-dormant draft. Needs a human decision (merge or close), not just a nudge.

For each PR also write a concise **Waiting On**: the single most important thing(s) standing between it and merge, in priority order (e.g. "Fix SonarQube coverage on new code, then review + parent #291 must merge first").

## Step 6 — Refresh the fixed Miro board

The skill writes to a **single persistent board** so the user can keep their own *Comments* between runs. **Never create a new board.** **Never create a new table.** Refresh the existing widgets on the fixed board:

- Board URL: `https://miro.com/app/board/uXjVHG5fAOs=/`

If the user explicitly asks for a different output (chat/markdown), render there instead and skip the board work.

1. **Locate the existing table.** Call `mcp__plugin_miro_miro__board_list_items` against the board URL and find the table widget (type `table`). There should be exactly one; if there are several, prefer the one whose first column is `PR` (read its header via `table_list_rows`). Capture its `?moveToWidget=<id>` URL — that is what `table_list_rows` and `table_sync_rows` need.

   If no table exists on the board, stop and tell the user: this skill expects a pre-existing table on the fixed board and won't create one. Don't fall back to creating a new table.

2. **Preserve user Comments.** Call `mcp__plugin_miro_miro__table_list_rows` on the table's `moveToWidget` URL and build a map from PR URL (or `#<num>` if the link column carries that) → existing `Comments` text. When you sync rows in the next step, carry that text forward for any PR that still has an open PR; for brand-new PRs, set `Comments` to `""`.

3. **Sync rows** with `mcp__plugin_miro_miro__table_sync_rows` on the table's `moveToWidget` URL. This replaces the table contents with exactly the current set of open PRs (closed/merged PRs naturally drop off). For the `PR` link cell pass `[{"url": "<pr url>", "text": "#<num> — <short title>"}]`. Order rows by readiness (Ready first, Stale last); keep stacked PRs adjacent and in merge order. Match the existing table's columns exactly — do not invent new ones.

4. **Refresh the priority summary.** Use `mcp__plugin_miro_miro__board_list_items` to locate any existing summary document on the board (look for a doc/text widget near the table). If one exists, update it in place with `mcp__plugin_miro_miro__doc_update`; otherwise create it with `mcp__plugin_miro_miro__doc_create` positioned below the table. Content is GitHub-flavored markdown with these sections:
   - A short note on any stacked PRs and the required merge order.
   - **✅ Ready or almost ready**
   - **🔴 Blocked by CI / checks**
   - **👀 Blocked by review**
   - **⏳ Stale / needs a decision**
   - A timestamp line: `_Last refreshed: <YYYY-MM-DD HH:MM> by /pr-dashboard_`.

   Use clickable PR links in each bullet and one line on the specific blocker. Close with a one-line note that there were no unresolved review threads (if true) and that Slack asks were verified, not guessed.

The Miro tools render an interactive panel to the user with the link/preview — don't restate the link or echo the board contents back; a one-line confirmation is enough.

## Step 7 — Close out

Give the user a tight chat summary: a link to the fixed board (`https://miro.com/app/board/uXjVHG5fAOs=/`), the headline counts (how many Ready / blocked-by-CI / blocked-by-review / stale), and the single highest-leverage next action (often: the one PR that unblocks a whole stack). Mention any limitation (e.g. Slack not checked) honestly.

---

## Notes & gotchas

- **Shell loops**: the user's shell is fish; multi-line `for … end` blocks passed to the Bash tool have failed here. Prefer one explicit command per PR (they parallelize anyway).
- **`gh pr view` needs a positional number** even with `--repo` — `gh pr view --repo X` alone errors.
- **Empty `reviewDecision`** doesn't always mean "no review" — on PRs whose base is a non-default branch (stacked PRs) GitHub may return `""` even with reviewers requested. Read `reviewRequests` and `latestReviews` together.
- **Faithfulness over optimism**: if checks are red, say so with the specific failed condition; if a finding is Low severity, don't inflate it; if something's approved and green, call it Ready without hedging.
- **Reused board, not a fresh one**: the board and its table live at `https://miro.com/app/board/uXjVHG5fAOs=/` and must not be recreated. `table_sync_rows` is destructive to the rows it doesn't keep, so always read the existing Comments column first and carry user-authored notes forward.
