---
name: sequence-diagram
description: >
  Generates a high-fidelity, interactive sequence diagram as a single self-contained HTML file.
  Use this skill whenever the user wants to visualize a code flow, API request lifecycle,
  service interaction, or any multi-step process involving participants and messages.
  Trigger on phrases like: "create a sequence diagram", "show me the flow of", "trace this
  request", "visualize how X works", "generate a sequence diagram for", "interactive diagram",
  "HTML sequence diagram". Use this even when the user doesn't say "diagram" explicitly but
  clearly wants to understand and visualize a multi-layer flow through code.
---

# Sequence Diagram Skill

Produces a sleek dark-themed interactive HTML sequence diagram — the kind that makes code flows
genuinely enjoyable to explore. The output is a single `.html` file with collapsible groups,
sticky participants, hover/click detail panels, and GitHub source links.

**Always self-review the HTML before finishing.** A diagram that renders broken is worse than no diagram.

---

## Step 1 — Research the Flow

Before writing a single line of HTML, understand the full sequence:

1. Find the entry point (e.g. the HTTP controller, the function being called)
2. Trace through every layer — delivery → domain → external, or whatever applies
3. For each significant step collect:
   - **from/to participants** (e.g. Controller → Action, Action → LLM)
   - **kind**: `req` (call), `res` (return/response), or `async` (fire-and-forget)
   - **exact function/method name and file path + line number**
   - **a one-sentence description** of what happens and why
4. Group related steps logically (e.g. "Content Moderation", "LLM Generation", "Post-response tasks")
5. Identify async fire-and-forget operations — they get dashed purple arrows

---

## Step 2 — Build the HTML

### Critical layout rules (hard-won from debugging)

#### Full-page flex layout

The body must be a fixed-height flex column. This is the only way to make
the scroll container work correctly for both axes.

```css
html, body { height: 100%; }
body {
  display: flex;
  flex-direction: column;
  height: 100vh;
  overflow: hidden;
}
```

The header sits outside the scroll area and never scrolls away.

#### Scroll wrapper — the single scroll container

```css
.scroll-wrapper {
  flex: 1;
  overflow: auto;   /* BOTH axes — horizontal AND vertical */
  min-height: 0;    /* required: flex children won't shrink without this */
}
```

All diagram content (participants + rows) lives inside `.scroll-wrapper`.

#### Sticky participants — top: 0, not header height

```css
.participants-row {
  position: sticky;
  top: 0;    /* relative to .scroll-wrapper, NOT the viewport */
  z-index: 100;
  background: var(--bg);
}
```

**Why `top: 0` not `top: <header-height>`:** The header is *outside* the scroll wrapper,
so the scroll wrapper's coordinate system starts at y=0 right at the participants row.
Setting `top: 81px` would push the participants row *down* 81px at page load, hiding
group headers behind it.

#### Row heights — always set inline

```javascript
const row = document.createElement('div');
row.className = 'seq-row';
row.style.height = '46px';   // inline — do NOT rely on CSS class alone
```

CSS class `height` alone is unreliable when the row is a flex child. Set it inline too.

#### Group collapse — max-height CSS, no requestAnimationFrame

```css
.group-body {
  overflow: hidden;
  max-height: 9999px;           /* open state */
  transition: max-height 0.35s ease;
}
.group-body.collapsed {
  max-height: 0;
}
```

```javascript
headerEl.addEventListener('click', () => {
  bodyEl.classList.toggle('collapsed');
});
```

**Never** do this:
```javascript
// ❌ BROKEN — overflow: hidden on a flex column causes scrollHeight ≈ 0 at RAF time
requestAnimationFrame(() => { body.style.maxHeight = body.scrollHeight + 'px'; });
```

The `overflow: hidden` on the flex column container causes `scrollHeight` to return
near-zero at `requestAnimationFrame` time, collapsing every group to ~5px.

### SVG arrows — one per row

Each row gets a full-width `<svg>` that draws lifelines + arrow. Crucially, **do not add
`<div>` lifeline children to rows** — that pushes content off-screen.

```javascript
function colCx(idx) { return idx * COL_W + COL_W / 2; }

function buildRowSVG(fromIdx, toIdx, kind, rowH) {
  const fx = colCx(fromIdx), tx = colCx(toIdx), y = rowH / 2;
  const color = { req: '#60a5fa', res: '#4ade80', async: '#a78bfa' }[kind];

  const lifelines = participants.map((_, i) => {
    const x = colCx(i);
    return `<line x1="${x}" y1="0" x2="${x}" y2="${rowH}"
              stroke="rgba(42,51,72,0.7)" stroke-width="1"/>`;
  }).join('');

  const goRight = tx >= fx;
  const head = goRight
    ? `<polygon points="${tx},${y} ${tx-8},${y-4} ${tx-8},${y+4}" fill="${color}"/>`
    : `<polygon points="${tx},${y} ${tx+8},${y-4} ${tx+8},${y+4}" fill="${color}"/>`;
  const dash = kind === 'async' ? 'stroke-dasharray="6,4" opacity="0.75"' : 'opacity="0.9"';
  const line = `<line x1="${fx}" y1="${y}" x2="${tx}" y2="${y}"
    stroke="${color}" stroke-width="1.5" ${dash}/>`;

  return `<svg style="position:absolute;inset:0;pointer-events:none;overflow:visible"
    width="${DIAGRAM_W}" height="${rowH}" xmlns="http://www.w3.org/2000/svg">
    ${lifelines}${line}${head}
  </svg>`;
}
```

Note rows (informational callouts) use only the lifelines SVG. Their text is absolutely
positioned spanning the full row width:

```javascript
// note row — text is position:absolute, not a flex child
const txt = document.createElement('div');
txt.style.cssText =
  'position:absolute;left:12px;right:12px;top:50%;transform:translateY(-50%);' +
  'font-size:10px;color:#fbbf24;font-style:italic;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;';
txt.textContent = 'ℹ  ' + step.text;
```

### Visual design

```
Background:    #0f1117    (near-black)
Surface:       #1e2535    (card backgrounds)
Border:        #2a3348    (default), #3d4f6b (bright)
Text:          #e2e8f0    (primary), #8892a4 (dim), #4a5568 (muted)

Arrows:
  request →    #60a5fa  (blue, solid)
  response ←   #4ade80  (green, solid)
  async - - →  #a78bfa  (purple, dashed)

Participant box border colors by layer:
  client:      #3d6e9e
  delivery:    #5b6e8e
  domain:      #4a7c5e
  external:    #7c5b4a
  infra:       #6b5b8e
```

Column width: **160px**. Diagram width: `N_participants × 160 + 16px` (right padding).

### Detail panels

- Hover → show a `position: fixed` tooltip on the right side (CSS `:hover` + `display: flex`)
- Click → pin the panel (persists on scroll, `Escape` closes)
- Each panel shows: step title, exact code call (monospace), description, GitHub link

### GitHub links

Derive the GitHub URL from the repo remote, or ask the user once:

```javascript
const BLOB = 'https://github.com/<org>/<repo>/blob/main';
// file link: `${BLOB}/${step.file}#L${step.line}`
```

---

## Step 3 — Self-Review Checklist

Before finishing, re-read the generated HTML and verify each of these by inspection:

| Check | What to look for |
|-------|-----------------|
| `html, body` height | Both have `height: 100%` / `height: 100vh` and `overflow: hidden` |
| `.scroll-wrapper` | Has `flex: 1`, `overflow: auto`, and `min-height: 0` |
| `.participants-row` sticky | `position: sticky; top: 0` — NOT `top: <header-height>px` |
| Row heights | Every `.seq-row` has an **inline** `style="height: 46px"` in addition to any CSS class |
| Group collapse | `.group-body` uses `max-height: 9999px` (open) / `max-height: 0` (collapsed) in CSS — no `requestAnimationFrame` + `scrollHeight` pattern anywhere |
| Note rows | Text uses `position: absolute` spanning the full row — no `<div>` lifeline children added to note rows |
| SVG arrows | Each row has a full-width `<svg>` drawing lifelines + arrow; lifelines are NOT separate `<div>` elements |

Fix any violations before proceeding.

---

## Example: Data Model

Use this as the structural template. Only the data changes — the rendering engine is always the same.

```javascript
const BLOB = 'https://github.com/<org>/<repo>/blob/main/src/';
const COL_W = 160;  // px per participant column
const ROW_H  = 46;  // normal step row height
const NOTE_H = 33;  // note/callout row height

// Each participant gets a column. Layer drives the border color.
const PARTICIPANTS = [
  { name: 'Client',         layer: 'client',   desc: 'Browser / Frontend' },
  { name: 'ChatController', layer: 'delivery', desc: 'HTTP entry point',        file: 'controller/ChatController.kt' },
  { name: 'ChatService',    layer: 'domain',   desc: 'Core orchestration',       file: 'service/ChatService.kt' },
  { name: 'LLM Gateway',   layer: 'external', desc: 'Spring AI + AI Gateway' },
  { name: 'EventPublisher', layer: 'infra',    desc: 'Async domain events' },
];

// Steps are grouped into collapsible sections.
const GROUPS = [
  {
    title: 'Request Setup',
    steps: [
      // Arrow step: from/to are PARTICIPANTS indices
      { from: 0, to: 1, kind: 'req',
        label: 'POST /api/v3/chats/{id}/messages/stream',  // shown on arrow
        detail: 'ChatController.streamMessage()',           // panel title
        file: 'controller/ChatController.kt', line: 42,
        desc: 'One-sentence explanation of what happens and why.' },
      { from: 1, to: 2, kind: 'req',
        label: 'streamResponse(request, authCtx)',
        detail: 'ChatService.streamResponse()',
        file: 'service/ChatService.kt', line: 186,
        desc: 'Delegates to ChatService which owns streaming orchestration.' },
    ]
  },
  {
    title: 'LLM Streaming',
    steps: [
      { from: 2, to: 3, kind: 'req',
        label: 'chatClient.prompt().stream()',
        detail: 'Spring AI ChatClient streaming call',
        file: 'service/ChatService.kt', line: 320,
        desc: 'Builds prompt with system message, user message, tools, advisors.' },
      { from: 3, to: 4, kind: 'async',    // dashed purple — fire-and-forget
        label: 'RunStartedEvent emitted',
        detail: 'SidekickEventPublisher → AiHistorySubscriber',
        file: 'events/SidekickEventPublisher.kt', line: 63,
        desc: 'Emits event for AI history persistence via gRPC.' },
      { from: 3, to: 2, kind: 'res',      // green arrow back
        label: 'Flux<ChatResponse> (token chunks)',
        detail: 'Reactive token stream',
        file: 'service/ChatService.kt', line: 643,
        desc: 'Reactive stream of LLM token chunks forwarded to SSE.' },
      // Note rows: no from/to/kind — just a text callout
      { kind: 'note', text: 'Parallel: fetchWidgetContext · loadSidekickFiles · loadVisualContext' },
      { from: 2, to: 0, kind: 'res',
        label: 'SSE: MessagePart (text · tool output)',
        detail: 'Server-Sent Events to client',
        file: 'service/ChatService.kt', line: 745,
        desc: 'Each token/tool result forwarded to HTTP SSE response in real-time.' },
    ]
  },
];
```

**Arrow kinds:** `req` = blue solid (call), `res` = green solid (return), `async` = purple dashed (fire-and-forget).  
**Participant layers** and their border colors: `client` #3d6e9e · `delivery` #5b6e8e · `domain` #4a7c5e · `external` #7c5b4a · `infra` #6b5b8e.  
**Note rows** render as a full-width italic yellow callout — no arrow, no click interaction.  
**Panel on click** shows: kind badge, detail title, label in monospace, desc, GitHub link (`BLOB + file + '#L' + line`).

---

## Step 4 — Report

Tell the user:
- The file path
- A screenshot summary of what it looks like
- Any interesting steps or interactions (hover, collapse, GitHub links)
- Invite them to open it in a browser