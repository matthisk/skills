# Clarifying questions by diagram shape

Pick the bucket that matches what the user is describing, then ask only the
questions that aren't already answered. These work regardless of persona —
an engineer and a PM both need to answer "what's the boundary" and "what
matters most," they just describe the content differently.

## Any diagram (ask first, always)

- What decision or conversation will this diagram support? (Knowing the
  purpose tells you what to include and what to leave out.)
- Who's the audience — will they read this alone, or will you be walking
  them through it?
- Roughly how much detail: a high-level overview, or something someone could
  act on directly?

## Diagramming a codebase / file / doc (the subject is readable)

Reading the artifact tells you what exists, not which view the user wants —
that's the gap to close, and it's the highest-value question. Skim first so
the options are concrete, then offer a choice rather than picking for them:

- Which view? A large package can be drawn many ways, and they answer
  different questions:
  - **Module / dependency graph** — how packages or modules depend on each other
  - **Call flow from an entry point** — what happens when X is invoked
  - **Class / type structure** — inheritance, composition, key types
  - **Request / interaction sequence** — who calls whom over time
  - **Data flow** — how data moves and is transformed
- What's the scope boundary — one module, one entry point, or the whole package?
- What altitude — a high-level map, or down to individual functions/classes?

Once the view is chosen, jump to the matching shape bucket below for the
follow-up questions specific to that shape.

## Process / flow (steps, decisions, handoffs)

- Where does the flow start and end?
- What are the possible outcomes at each decision point — including failure
  or exception paths, if those matter here?
- Who or what owns each step (a team, a system, a person)?

## System / architecture (components and how they connect)

- What are the boundaries — is this one service, a subsystem, or the whole
  system?
- For each connection: what actually happens on it (a call, an event, a data
  read/write)? Avoid leaving it as an unlabeled line.
- Which parts are existing and which are proposed/future?

## Sequence / interaction (who calls whom, over time)

- What's the single concrete scenario being traced (not "the general case")?
- Which participants are in scope? Anything triggering this from outside
  that scope?
- Does timing or ordering matter (e.g. async vs. sync, retries)?

## Hierarchy / org / structure (parent-child, ownership)

- What's the root or top-level node?
- Is this reporting structure, ownership, containment, or categorization —
  they look similar but mean different things?
- How deep does it need to go — every leaf, or just enough to orient?

## Closing the loop

Before generating, restate back in one or two sentences what the diagram
will show. It's cheaper to correct a sentence than a diagram.
