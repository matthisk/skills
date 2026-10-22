---
name: codebase-research
description: Research a question about the current codebase and save a well-structured answer as an Obsidian markdown note in the vault's Researh directory. Use this skill whenever the user explicitly asks to answer a research question and capture the result in Obsidian.
---

# Codebase Research Skill

Research a question about the current codebase and produce a written answer saved as an Obsidian note in the vault's Research directory.

## Vault Access (Obsidian MCP)

Notes are read and written through the **Obsidian MCP** (`mcp__obsidian__*`) — do NOT write to the local file system. The MCP is already pointed at the user's vault, so all paths are **relative to the vault root** (e.g. `Research/My Note.md`). `mcp__obsidian__vault_write` creates any missing parent directories automatically.

Research notes live in the `Research/` directory of the vault. To confirm it exists or browse existing notes, call `mcp__obsidian__vault_list` with `path: "Research"`.

## Two Invocation Modes

### Mode A — Prompted (argument provided)
The user has a specific question. Follow the full workflow below: research the codebase, then write the note.

### Mode B — Unprompted (no argument)
The user is invoking the skill after a conversation has already produced useful findings — they want to capture what was already learned, not ask a new question.

In this mode:
1. **Skip new research.** The answers are already in the conversation.
2. **Synthesize the conversation** — read back through the recent exchanges and extract: what was being investigated, what was found, what files were involved, any open questions or surprises.
3. **Derive a title** from the topic that was discussed, the same way you would for a prompted research note.
4. **Write the Obsidian note** (via `mcp__obsidian__vault_write`) using the same format as Mode A, but sourcing content from the conversation rather than new tool calls.
5. **Tell the user** the vault-relative path and a one-sentence confirmation.

The note should read as a clean research artifact — not a transcript of the conversation. Synthesize and structure; don't dump Q&A.

## Workflow

### 1. Understand the question

Clarify scope if needed. If the user's question is ambiguous, ask one focused clarifying question before diving in. Otherwise, proceed.

### 2. Research the codebase

Use whatever combination of tools fits the question:
- `Glob` — find files by name/pattern
- `Grep` — search for symbols, patterns, usages across the codebase
- `Read` — read specific files in depth
- `Bash` — run `git log`, `git blame`, or other shell commands for history/context

Go deep enough to give a thorough, accurate answer. If you discover something surprising or contradictory while researching, note it in the output.

### 3. Write the Obsidian note

**File naming:** `YYYY-MM-DD <concise descriptive title>.md`
- Date comes first so files sort chronologically
- Title should describe the answer, not the question (e.g., `2026-04-10 How Rate Limiting Works in Sidekicks.md`)
- Use today's date from context

**Save with** `mcp__obsidian__vault_write`, passing `path: "Research/<filename>"` (vault-relative) and `content` set to the full note. The directory is created automatically if it doesn't exist yet.

**Codebase tag:** Before writing the note, determine the repository name by running:
```bash
basename $(git rev-parse --show-toplevel)
```
Add this as a tag in the frontmatter (e.g., if the repo is `sidekicks`, add `- sidekicks`). This makes all research notes for a given codebase filterable in Obsidian.

**Note format** (Obsidian Flavored Markdown):

```markdown
---
title: <same as filename without date and .md>
date: YYYY-MM-DD
tags:
  - research
  - <repo-name>
  - <relevant-topic-tag>
---

# <Title>

> [!question] Research Question
> <the user's original question, verbatim or lightly cleaned up>

## Summary

<2–4 sentence executive summary of the answer>

## Findings

<The main body of the research. Use headings, code blocks, and bullet lists to organize.>

### <Sub-topic>

<Detail, with code snippets where illuminating>

```kotlin
// relevant code
```

## Key Files

| File | Role |
|------|------|
| `path/to/file.kt` | What it does |

## Open Questions

<Things that were unclear, surprising, or worth investigating further. Omit this section if there's nothing to flag.>
```

**Formatting rules:**
- Use standard Markdown for structure (headings, bullets, tables, code fences)
- Use `[[wikilinks]]` only to link to other notes that actually exist in the vault — don't invent links. Verify a target exists with `mcp__obsidian__search_simple` or `mcp__obsidian__vault_list` before linking
- Use callouts (`> [!note]`, `> [!warning]`, etc.) for important asides
- Use fenced code blocks with language identifiers (`kotlin`, `yaml`, `sql`, etc.)
- Keep prose concise — this is a reference document, not an essay

### 4. Tell the user

After saving, tell the user:
- The vault-relative path of the note (e.g. `Research/2026-04-10 How Rate Limiting Works.md`)
- A brief summary of what you found (2–3 sentences)

Do NOT paste the entire note into the chat — just the summary and the path.
