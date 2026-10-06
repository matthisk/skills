---
name: canvas-docs
description: Use for ANY canvas / PIXI / widget / Visuals 2.0 / Sekiro engine / diagram-as-code-canvas task in the Miro client repo. Points at ~/dev/github.com/miroapp-dev/canvas-docs/ which holds Confluence-mirrored canonical docs side-by-side with agent-authored notes (`<topic>.md` + `<topic>_notes.md`). Trigger keywords - canvas, PIXI, widget, Visuals 2.0, Sekiro, CDM, CanvasObject, IWidget, local widget, diagram-as-code-canvas, DiagramElementFactory, custom cursor, contour, visual size.
---

# canvas-docs

`~/dev/github.com/miroapp-dev/canvas-docs/` is a personal knowledge base for canvas / PIXI / widget / Visuals 2.0
/ Sekiro engine work. Flat folder. Two file kinds:

- `<topic>.md` — canonical doc (`status: mirrored`), bound to a Confluence `source:` URL.
- `<topic>_notes.md` — agent-authored notes living next to the canonical doc.
- `<standalone>_notes.md` — notes for a topic with no Confluence source.

## Where to read

For ANY canvas / PIXI / widget / Visuals 2.0 / Sekiro / diagram-as-code-canvas task,
**read first** `~/dev/github.com/miroapp-dev/canvas-docs/canvas-overview.md` — the canonical hub (two-layer
model + vocabulary). It points onward to the other canonical mirrors (`canvas-cdm.md`,
`sekiro-engine.md`) and to the deeper cross-cutting notes
(`canvas-api-reference_notes.md`); follow those only as the task needs.

For diagram-as-code-canvas work also read
`~/dev/github.com/miroapp-dev/canvas-docs/diagram-as-code-canvas_notes.md`.

If a relevant file does not exist, list `~/dev/github.com/miroapp-dev/canvas-docs/` to discover what is
available — file names tell you topic + kind at a glance.

## Where to write (decision tree)

When you discover something worth recording:

- **Confluence-worthy concept** (any canvas worker would want this) → extend the matching
  `<topic>.md`. If no file covers the topic, propose importing the relevant Confluence
  page (use `mcp__glean__search` / `mcp__glean__read_document` to fetch).
- **Repo / package / debugging detail** (only relevant to a specific package or bug) →
  extend the sibling `<topic>_notes.md`, or create `<standalone>_notes.md` if no
  canonical doc exists.
- **In doubt** → `_notes.md`. Promotion is cheap, demotion is not.

## Editing canonical `<topic>.md` — the rules

Canonical files are editable but **bound to a Confluence source**. When you edit one:

1. Preserve the frontmatter. Never remove `source:` or change `status:` away from
   `mirrored`.
2. Bump `last_synced:` to today's date.
3. If your edit added factual knowledge (not just better phrasing or restructuring),
   include `sync-needed: <one-line reason>` in the commit message body — this signals
   the user to update Confluence.
4. Never repurpose a canonical file for an unrelated topic. Create a new one (or import
   the relevant Confluence page).
5. Never inline package-specific implementation details (file paths under
   `packages/`, DI key names, debug recipes). Those belong in the sibling
   `<topic>_notes.md`. Keep canonical content at the conceptual level Confluence
   operates at.

## Editing `_notes.md` — the rules

1. Frontmatter required: `scope:`, optional `related: [<topic>.md]`, `status: notes`.
2. Link into the canonical sibling instead of restating its prose.
3. Free to cite repo file paths, function names, package internals, gotchas.

## Workflow

`~/dev/github.com/miroapp-dev/canvas-docs/` is a git repo. Commit per logical change. Use commit prefixes:
`import:`, `sync:`, `notes:`, `reorg:`, `chore:`. Append `sync-needed: <reason>` to the
body of any commit that added facts the Confluence source does not have.

## Why this skill exists

Replaces the freeform "Canvas API Reference" entry that previously lived in
`MEMORY.md`. The skill is the single source of truth for how to find, read, and extend
canvas knowledge. The full guardrails live in `~/dev/github.com/miroapp-dev/canvas-docs/README.md` — read it
the first time you touch the folder in a session.
