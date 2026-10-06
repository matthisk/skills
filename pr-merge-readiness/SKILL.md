---
name: pr-dashboard
description: Produce a merge-readiness + next-action report for the current user's open GitHub PRs and render it as a datatable, a stack-dependency diagram, and a priority summary on a new Miro board. For each open PR it checks mergeability/conflicts, draft status, review decision and requested reviewers, required/failing checks, blocking security or bot comments (Oplane, SonarQube, Wiz), unresolved review threads, age and how long a review ask has gone unanswered, the linked Jira ticket's priority/status, and whether a review was already asked for in Slack — then judges whose court the ball is in and the single next action to move each PR forward. Use this whenever the user asks about the state of their pull requests, wants to know "what's ready to merge", "what am I waiting on", "what should I work on next", a "PR status / merge readiness report", a "PR roundup", or wants their open PRs triaged onto a Miro board. Trigger even if the user doesn't say "Miro" or "merge readiness" verbatim — any request to review, summarize, prioritize, or figure out next steps for their own open PRs across repos should use this skill.
metadata:
  argument-hint: '[optional: author or extra instructions]'
allowed-tools: Bash(gh:*) Bash(date:*) Read Agent mcp__plugin_slack_slack__slack_search_public_and_private mcp__plugin_slack_slack__slack_read_thread mcp__atlassian__searchJiraIssuesUsingJql mcp__atlassian__getJiraIssue mcp__plugin_miro_miro__board_create mcp__plugin_miro_miro__table_create mcp__plugin_miro_miro__table_sync_rows mcp__plugin_miro_miro__doc_create mcp__plugin_miro_miro__diagram_get_mermaid_instructions mcp__plugin_miro_miro__diagram_create_mermaid
---

# PR Dashboard — Merge-Readiness & Next Actions

Survey the user's open GitHub PRs, judge how close each is to merging **and whose court the ball is in**, work out the single next action that moves each one forward, then lay it all out on a new Miro board: a triage datatable, a dependency diagram for any stacked PRs, and a short priority summary.

The value of this skill is **honest, actionable triage**. A status report tells you what's true; this should tell you what to *do*. Every claim is grounded in real data (GitHub + Slack + Jira), nothing is guessed, and the board answers two questions at a glance: *what can I merge now*, and *what's the highest-leverage thing I can do next*.

## Output contract

A new Miro board containing, in this order:

1. A **triage datatable** with these columns:
   `PR | Repository | Ticket | Merge Readiness | Court | Next Action | Waiting On | Asked for Review | Comments`
2. A **stack-dependency diagram** (only if any PRs are stacked) showing merge order and per-node status.
3. A **priority summary** document grouping PRs into: quick wins / ready, your court (you must act), blocked by review, and stale/needs-a-decision.

The **Comments** column is always left empty — it's the user's space for their own notes.

Default scope is **the current user's own open PRs**. If `$ARGUMENTS` names a different author or adds constraints (e.g. a specific repo), honor that; otherwise use `@me`.

First, get today's date so age math is correct: `date -u +%Y-%m-%d`.

---

## Step 1 — Find the open PRs

```
gh search prs --author=@me --state=open --json repository,number,title,url,isDraft,createdAt,updatedAt --limit 100
```

Swap `@me` for `--author=<login>` or add `--repo <owner/repo>` if the user scoped it. Zero results → say so plainly and stop.

## Step 2 — Gather per-PR detail

For each PR collect the signals below. **Run one command per PR, not a shell `for` loop** — loop syntax is shell-dependent and silently breaks under fish (the user's default shell); independent per-PR calls also parallelize, so issue them together in one message.

**Core status** (note: `gh pr view` needs the number as a positional arg *and* `--repo`; `--repo` alone errors):

```
gh pr view <num> --repo <owner/repo> --json number,title,url,isDraft,mergeable,mergeStateStatus,reviewDecision,reviewRequests,latestReviews,headRefName,baseRefName,createdAt,updatedAt
```

`mergeStateStatus`: `CLEAN` = good; `BLOCKED` = review required; `UNSTABLE` = a non-required check failing/pending; `DIRTY`/`CONFLICTING` = merge conflicts.

**Checks** (find anything not passing):

```
gh pr checks <num> --repo <owner/repo>
```

Non-zero exit just means a check is failing — read the output. Skipped checks are normal. Classify failures: a **pending** check just needs time; a **real** failure (Sonar gate, failed build) needs action; a flaky integration test may just need a re-run. Say which kind it is.

**Unresolved review threads** (line-level conversations that gate merge):

```
gh api graphql -f query='
query($owner:String!,$repo:String!,$num:Int!){
  repository(owner:$owner,name:$repo){
    pullRequest(number:$num){
      reviewThreads(first:50){ nodes{ isResolved isOutdated path
        comments(first:1){ nodes{ author{login} body url } } } }
    }
  }
}' -F owner=<owner> -F repo=<repo> -F num=<num> \
  --jq '.data.repository.pullRequest.reviewThreads.nodes[] | select(.isResolved==false) | {path, author:.comments.nodes[0].author.login, body:.comments.nodes[0].body[0:200], url:.comments.nodes[0].url}'
```

**Blocking bot / security comments**, and any reviewer question awaiting *your* reply:

```
gh pr view <num> --repo <owner/repo> --json comments --jq '.comments[] | {author:.author.login, body:.body[0:400]}'
gh pr view <num> --repo <owner/repo> --json reviews  --jq '.reviews[] | {author:.author.login, state:.state, body:.body[0:400]}'
```

- **SonarQube** (`sonar-*`): a failed Quality Gate (e.g. "0% Coverage on New Code", required ≥80%) is a real blocker — capture the exact failed condition. This kind is usually **self-fixable** (write tests).
- **Oplane** (`oplane-bot`): "All requirements satisfied" = fine. "N requirement(s) need attention" → read which and their severity (a 🔴 *Not implemented* High blocks; a Low may be acceptable risk — report it, don't overstate it).
- **Wiz / container scan** (`github-actions`): a PASSED scan is informational.
- A **reviewer comment/`COMMENTED` review that asks you something** (e.g. "give me a description / how did you test this?") is an action on *you*, easy to miss in a status table — capture it explicitly.

**Compute age signals** from the timestamps vs today: PR **age** (since `createdAt`) and **idle** days (since `updatedAt`). These drive the "stale" judgment far better than calendar age alone.

## Step 3 — Detect stacked PRs

If one PR's `baseRefName` equals another of the user's PRs' `headRefName`, they're **stacked**: the child can't cleanly merge until the parent lands. Identify the base of each stack (the one whose base is `main`/`master`) and the merge order. A child is never "Ready" while its parent is unmerged — at best "Close, but not ready" with "parent #X must merge first" in *Waiting On*, and its *Court* is usually `Blocked: stack` unless it also has its own work for you to do (then `My court`).

## Step 4 — Enrich with Jira (if a ticket is referenced)

Extract a ticket key from the PR title or branch (pattern like `DIAG-4736`, `[A-Z]+-\d+`). Many PRs are titled `DIAG-XXXX <summary>`. For each distinct key, fetch priority + status:

```
mcp__atlassian__getJiraIssue   (issueIdOrKey: "DIAG-4736")   # read fields.priority.name, fields.status.name, fields.summary
```

Use this to (a) fill the **Ticket** column (`DIAG-4736 · High · In Progress`, linked to the issue) and (b) **sort by business value** — a High-priority blocked PR outranks a green low-priority one. Flag mismatches worth noticing (e.g. PR merge-ready but ticket still "In Review", or no ticket at all → `—`). If the Atlassian MCP isn't available, leave Ticket blank and note it.

## Step 5 — Verify Slack review asks (never guess)

For each PR, search Slack for an **explicit** review request the user posted — a message that links the PR (or names its ticket) *and* asks someone to review it. A standup line mentioning the PR, or an announcement sharing it, does **not** count.

```
mcp__plugin_slack_slack__slack_search_public_and_private  query="from:me <repo>/pull/<num> review"   sort="timestamp"
mcp__plugin_slack_slack__slack_search_public_and_private  query="from:me <TICKET-KEY> review"          sort="timestamp"
mcp__plugin_slack_slack__slack_search_public_and_private  query="from:<@USER_ID> github.com/<owner>/<repo>/pull"  sort="timestamp"
```

Prefer the most recent match. One message can cover several stacked PRs — if it lists multiple PR links and asks for review, it counts for each.

For *Asked for Review*: match → `Yes — <channel/DM>, <date>: <permalink>`; **also note how long ago** (e.g. `Yes — DM, asked 5d ago, no response`) because an unanswered ask is itself the next-action signal. No explicit ask → exactly `Not found` (optionally append `— only an announcement post: <permalink>`, but the verdict stays "Not found"). If Slack MCP is unavailable, fill `Not checked (Slack unavailable)` and say so at the end.

## Step 6 — Judge readiness, court, and next action

For each PR decide three things, all grounded in the signals above — these are judgment calls, so explain the *why* in *Waiting On*.

**Merge Readiness** (pick one):
- **Ready** — mergeable, not draft, review satisfied, required checks green, no blocking threads/findings, no unmerged parent. Could merge now. (Soft follow-ups don't downgrade it — note them in *Next Action*.)
- **Close, but not ready** — mergeable + CI green, one clear step left (usually an approval, or a stacked child whose only blocker is the parent).
- **Not ready** — substantive blocker: failing required check, blocking bot/security finding, conflicts, requested changes, unresolved blocking threads.
- **Stale / unclear** — open long, idle, no reviewers, no path (use the idle-days signal). Needs a decision, not a nudge.

**Court** — who must act next to make progress:
- **My court** — CI you must fix, a reviewer question awaiting your reply, conflicts to rebase, or a decision only you can make.
- **Their court** — green and mergeable, waiting on someone else's review/approval.
- **Blocked: stack** — can't progress until a parent PR merges (even if otherwise fine).

**Next Action** — one concrete, specific imperative, ideally naming who/what: e.g. "Add unit tests to clear the Sonar coverage gate", "Reply to <reviewer>'s question, then merge", "Rebase onto main after #291 lands", "Find a 2nd reviewer on <team> (primary is OOO)", "Decide: merge or close". If you know a requested reviewer is unavailable (e.g. surfaced as OOO in the Slack thread), let that change the action — nudging someone who's out isn't the move.

## Step 7 — Build the Miro board

Creating the board is the expected action (that's the skill's purpose) — no extra confirmation unless the user asked for a different sink (chat/markdown), in which case render there.

1. **Board** — `board_create` (set `invocation_source:"skill"`, `is_repository:true` in a git repo). Name `PR Dashboard — <YYYY-MM-DD>`. Keep the returned `miro_url`.

2. **Triage table** — `table_create` against that `miro_url` at `x:0, y:0`. Columns:
   - `PR` → **link** (clickable)
   - `Repository` → text
   - `Ticket` → **link** (e.g. text `DIAG-4736 · High · In Progress`, url to the issue); `—` if none
   - `Merge Readiness` → **select**: `Ready` `#00A341`, `Close, but not ready` `#F5A623`, `Not ready` `#E12D39`, `Stale / unclear` `#9B9B9B`
   - `Court` → **select**: `My court` `#E12D39`, `Their court` `#2D7FF9`, `Blocked: stack` `#9B9B9B`
   - `Next Action` → text
   - `Waiting On` → text (fold in the specific blocker + age/idle + stale-ask signal)
   - `Asked for Review` → text
   - `Comments` → text (leave `""`)

   The result returns a `?moveToWidget=<id>` URL — that's what `table_sync_rows` targets.

3. **Rows** — `table_sync_rows` with the table's `moveToWidget` URL. PR cell: `[{"url":"<pr url>","text":"#<num> — <short title>"}]`. **Order by what to do next**, not just readiness: quick wins (My court + nearly done) first, then My-court blockers (CI/conflicts), then Their-court (awaiting review), then Stale/decide last; break ties by Jira priority. Keep stacked PRs adjacent in merge order. Leave every `Comments` cell empty.

4. **Stack diagram** (only if stacks exist) — call `diagram_get_mermaid_instructions` first (prerequisite), then `diagram_create_mermaid` to the right of the table (e.g. `x:1700, y:0`). Draw each stack as a flowchart from base → children in merge order, label nodes `#<num> <ticket>`, and color by readiness (green/amber/red/grey to match the table). This makes "land #X first" obvious in a way a flat table can't.

5. **Priority summary** — `doc_create` below the table (e.g. `x:0, y:1000`), GitHub-flavored markdown. Lead with any stack + required merge order, then sections:
   - **⚡ Quick wins / Ready** — green + their court, or one-reply-away.
   - **🙋 Your court — you must act** — grouped by what's needed (fix CI, reply to reviewer, rebase, decide), most leveraged first; call out anything that unblocks a whole stack.
   - **👀 Blocked by review** — note who, and how long the ask has gone unanswered.
   - **⏳ Stale / needs a decision** — with idle-days.
   Use clickable PR links and one line of *why* each. Close with a one-liner: no unresolved review threads (if true), and that Slack asks were verified not guessed.

The Miro tools render an interactive panel to the user — don't restate links or echo board contents; a one-line confirmation suffices.

## Step 8 — Close out

Tight chat summary: board link, headline counts (Ready / your-court / blocked-by-review / stale), and the **single highest-leverage next action** (often the one PR that unblocks a stack). Mention any limitation (Slack/Jira not checked) honestly.

---

## Notes & gotchas

- **Shell loops**: the user's shell is fish; multi-line `for … end` blocks passed to the Bash tool have failed here. Use one explicit command per PR (they parallelize anyway).
- **`gh pr view` needs a positional number** even with `--repo`.
- **Empty `reviewDecision`** ≠ "no review" — on PRs based on a non-default branch (stacked PRs) GitHub may return `""` even with reviewers requested. Read `reviewRequests` + `latestReviews` together.
- **Faithfulness over optimism**: red checks → name the exact failed condition; a Low finding stays Low; approved + green → call it Ready without hedging. The Next Action is only useful if the diagnosis is honest.
- **Reviewer availability changes the action** — if a thread shows the requested reviewer is OOO, "nudge them" is the wrong next step; suggest a fallback reviewer instead.
