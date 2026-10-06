---
name: miro-codebase-analyse
description: Explain an unfamiliar codebase (or module) to engineers as a minimal set of accurate Mermaid diagrams, uploaded to a Miro board as structured diagrams. Use when someone wants to understand, map, or onboard onto a codebase visually — "help me understand this repo", "diagram this codebase", "give me an architecture overview of this service on Miro", "map the modules of X and put it on a board", "visualise how this system works". Trigger even if the user doesn't say "Mermaid", and even if they only say "diagram" without naming Miro when the intent is a shared visual overview of code. For a single ad-hoc diagram of something already understood, use miro-structured-diagram instead.
---

# Codebase analysis → Miro diagrams

Produce high-signal, notation-correct visual explanations of a codebase for an
**engineering audience**, then publish them to a Miro board as structured
(Mermaid) diagrams so they stay editable.

Audience is always engineers: assume they read code, know the stack, and want
architecture, boundaries, and behaviour — not product narrative.

Three failure modes to avoid above all:
- **Fabrication.** Every node and edge must come from something you actually
  read in the repo. Unknowns get marked, not guessed.
- **Mega-diagrams.** One diagram, one question, one zoom level. Split early.
- **Paths in labels.** Never write a repo path inside a node. Traceability is a
  clickable GitHub link on the node — see R10 in `references/diagramming-rules.md`.

## Workflow

Do not skip to Mermaid. The order matters: analysis → plan → drafts → publish.

### 1. Scope

Establish the boundary before reading everything: whole repo, one service, one
module, or one flow. If the user hasn't said, skim the top-level layout and ask
**one** bounded question (`AskUserQuestion`) offering 2–3 concrete scopes.
Ask nothing they already answered.

### 2. Analyse the repo (no rendering yet)

Read enough to ground the artefact. Extract, as available:

- **Runtime units** — apps, services, jobs, workers, datastores, external systems
- **Code structure** — modules, packages, bounded contexts, dependency direction
- **Domain model** — persistent entities and their relationships
- **Behaviour** — request lifecycles, pipelines, events, background jobs
- **Algorithms** — localised control flow worth drawing

Entry points, build/deploy config, module manifests, and route/handler
registries pay off fastest. Fan out with `Explore` subagents for large repos.

Keep candidate views separate — do not let them bleed into one another.

**Resolve the GitHub link base once, here**, so drafting can hang links on
nodes later:

```bash
git remote get-url origin      # -> owner/repo, if it is a GitHub remote
git rev-parse HEAD             # -> SHA for stable permalinks
```

Normalise `git@github.com:owner/repo.git` and `https://github.com/owner/repo.git`
to `https://github.com/owner/repo`. Permalink form is
`<base>/blob/<sha>/<path>` (append `#L<start>-L<end>` for a symbol). Use the SHA,
not `main` — links then survive later commits.

If the remote is not GitHub (or there is no remote), there are no node links:
say so once and fall back to anchors in the companion doc. Do **not** substitute
raw paths into node labels.

### 3. Plan the diagram set

Write a short plan, one entry per diagram:

- `id` (D1, D2, …), `title`
- **question it answers** (one explicit sentence)
- **scope**: included / excluded
- **notation**: FLOWCHART / UML_CLASS / UML_SEQUENCE / ERD
- **edge semantics** in one line (e.g. "compile-time dependencies", "runtime
  calls", "reads/writes")
- key elements that must appear
- 1–3 code anchors (file/module/symbol) that justify it, recorded as GitHub
  permalinks — these become the node links, not label text

Aim for the **minimal set** that covers core understanding — typically 3–5
diagrams. Prefer several small diagrams over one big one. Drop any diagram that
duplicates another's question or zoom level.

Show the plan to the user and get a nod before drafting, unless they asked you
to just go.

### 4. Draft each diagram in Mermaid

Follow `references/diagramming-rules.md` — it is the authoritative rule set for
notation choice, edge labelling, splitting, and unknowns. `references/view-catalog.md`
has a Mermaid skeleton per view type.

Before publishing, run the pre-flight checks at the end of the rules file
(size, banned edge labels, import-graph convention, ERD field bloat,
path-in-label, link validity).

Then call `diagram_get_mermaid_instructions` (or the equivalent instruction tool
on the configured Miro MCP) and apply what it says about **rendering**: colours,
`classDef` fills, strokes, and the Mermaid version to target. Follow it exactly
on those points.

Its scope stops there. It is a styling guide, **not** a syntax whitelist:
- Its worked example is one illustration of colouring, not the set of
  constructs you may use. A construct missing from that example is not
  forbidden — `subgraph`, `click`, node shapes, and direction all remain
  available.
- What goes *in* the diagram — notation choice, structure, grouping, edge
  labelling, splitting — is decided by `references/diagramming-rules.md`, which
  the styling guide does not override.
- The only thing that overrides this skill is a hard constraint the tool states
  outright (an unsupported Mermaid version or an explicitly rejected construct),
  or an actual error from `diagram_create_mermaid`.

### 5. Publish to Miro

1. Resolve the target board. If the user named one, use it (`board_search_boards`
   / their URL). Otherwise propose creating a board named after the repo or
   module — confirm the destination before creating anything.
2. Lay the board out as a **guided tour**, not a pile of shapes:
   - The companion doc goes **top-left**, first thing a reader hits.
   - Each D# gets its **own named section/frame** (`section_create`), titled
     `D# — <title>` with the question it answers, placed in plan order.
   - Use `board_get_space` to find free space and keep sections from
     overlapping existing content.

   Sections and `subgraph`s solve different problems and do not substitute for
   each other. A section is board furniture: it separates D1 from D2 and gives
   the tour its order. A `subgraph` is diagram content: it shows zones *within*
   one diagram. Creating a section never discharges the obligation to draw the
   boundaries inside the diagram (R9b), and you should never split one
   diagram's zones across several sections to fake grouping.
3. Create **one structured diagram per D#** with `diagram_create_mermaid`,
   inside its section, in plan order.
4. Write the companion doc (`doc_create`) capturing: scope, the diagram index
   with the question each answers, code anchors as markdown links to the same
   GitHub permalinks used on the nodes, the commit SHA the links are pinned to,
   and every UNKNOWN/VERIFY note.
5. If a diagram already exists on the board and you are revising it, read its
   current Mermaid back first and update in place (`diagram_update_mermaid`)
   rather than creating a duplicate.

## Output

Report the board link, the list of diagrams with the question each answers, the
commit SHA the node links are pinned to (or that there are no links, and why),
and every UNKNOWN/VERIFY item in one place so the reader knows exactly which parts
of the picture are unverified. Never claim you saved files or performed actions
you did not perform.
