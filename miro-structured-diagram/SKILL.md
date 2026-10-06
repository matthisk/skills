---
name: miro-structured-diagram
description: Create or refine a structured (Mermaid-based) diagram on a Miro board. Use whenever the user asks to diagram, chart, visualize, or map something onto a Miro board — e.g. "data flow diagram", "architecture diagram", "flowchart", "sequence diagram", "diagram the pipeline / this code", "add a diagram to a miro board", "put this on a new miro board". Trigger even when the user names a diagram type and a board but not "Mermaid". This skill turns a vague diagram request into an accurate one by asking targeted clarifying questions before generating Mermaid, and can revise an existing structured diagram in place. Requires a Mermaid/structured diagram tool (e.g. diagram_create_mermaid) on the Miro MCP; if only a generic diagram tool exists, use miro-diagram instead.
---

# Miro Structured Diagram

Shortcut to the Miro MCP server's Mermaid-based diagramming tools.

Structured diagrams keep their Mermaid source on the board after creation, so
they can be edited later — by regenerating the code or by editing the diagram
directly on the board. That only pays off if the diagram is accurate up
front. Do not generate Mermaid straight from a vague request — a diagram
users can't trust is worse than no diagram.

## Applicability

Check the Miro MCP tool list. If it includes a Mermaid / structured diagram
creation tool, use this skill. If only a generic diagram tool exists, use the
`miro-diagram` skill instead.

## Workflow

1. **Understand what's being diagrammed** well enough to draw it correctly.
   Don't interrogate the user — ask only what's needed to close real gaps,
   and skip anything they've already told you. `references/clarifying-questions.md`
   has prompts to draw from, organized by common diagram shapes; adapt them
   to the user's role and the diagram's purpose rather than reciting them.

   **When the subject is an artifact you can read (a codebase, file, or doc),
   reading it is not enough.** It tells you what exists, not which slice, at
   what altitude, or for whom — and a large codebase can be drawn many
   equally-valid ways (module dependencies, call flow from one entry point,
   class structure, request sequence, data flow). Reading answers the wrong
   question, so proceeding "because the code is right there" produces a diagram
   the user didn't ask for. Skim enough to make the options concrete, then ask
   ONE bounded question — a single `AskUserQuestion` offering 2-3 specific
   diagram framings plus scope — before generating. One choice, not an
   interview.
2. **Revising an existing structured diagram?** Read its current Mermaid
   source back first and confirm with the user what's wrong or missing,
   rather than regenerating blind.
3. Pick the diagram type that matches the relationships being described,
   then write its source following the exact syntax, structure, and
   conventions the MCP tool's schema and description specify.
4. Create or update the diagram with the appropriate tool.

## Output

Report the board link and a one-line summary of what the diagram shows. If
you inferred or guessed at anything non-obvious, say so and invite
correction.
