---
name: diagram-as-code-live-render
description: |
  Two-track loop for Mermaid / diagram-as-code work in the Miro client, driving
  an already-open board via the Chrome DevTools MCP. Track A drives the diagram
  from its Mermaid source (fill the code panel, zoom to fit, screenshot). Track B
  drives it from the canvas, clicking PIXI-painted controls the a11y tree can't
  see (QDC plus buttons, anchors, nodes) via a DOM-proxy bridge.
  TRIGGER on: "render this mermaid", "screenshot the diagram", "does this
  diagram look right", "check the layout of this flowchart", validating
  diagram-as-code output, diagram/edge/waypoint/label layout regressions,
  running a Mermaid corpus against local code, clicking QDC / plus / quick-create
  buttons on a diagram, selecting a generated node, exercising canvas controls.
  Requires an already-authed board tab — does NOT bootstrap a browser or a login.
  For console-log-driven debugging use canvas-live-debug; for Playwright /
  full-autonomy runs use agent-spectator.
---

# diagram-as-code-live-render

Fast loop to exercise a Mermaid diagram against a Miro board and see the result —
no Playwright, no e2e harness. Drives an already-open board tab.

## Pick a track first

The two directions have different tools, different prerequisites, and different
verification. Mixing them is the main way this loop goes wrong.

| | **Track A — code updates** | **Track B — live view updates** |
| --- | --- | --- |
| You change | the Mermaid source | the canvas, via its own controls |
| Mechanism | `fill` the `mermaid source` textbox | DOM-proxy bridge + native `click` / `drag` |
| Data flow | code → canvas | canvas → code |
| Verify by | screenshot the render | re-read the code panel |
| Needs `?autotest` | no | **yes** |

Track A answers *"does this source render correctly?"*. Track B answers *"does
interacting with the canvas produce the right source?"*. If a task needs both
(e.g. seed a diagram, then click a plus), run A to set up, then switch to B —
and re-read the code panel afterwards, because B's real output is the source.

## Shared prerequisites

1. **Chrome DevTools MCP connected**, with an already-authed board tab. This
   skill does not bootstrap a browser or sign in.
2. **For a local build:** client dev server on :8080 with the standard `yarn start`
   watch — code changes go live on board reload, no manual rebuild. Confirm you're
   on the local build by whether your tagged logs appear; the `clientHost` /
   `clientPort` cookies are httpOnly, so `document.cookie` won't show them.
   Track B works against plain staging too — it needs no local build.

Board URL (swap the IP for the one in the dev server's `--status` banner; drop
`clientHost`/`clientPort` for staging; add `?autotest` only for Track B):

```
https://staging.testmiro.com/app/board/<BOARD_ID>=/?clientHost=<LOCAL_IP>&clientPort=8080&ffsdk_CPF-9594-mermaid-canvas-engine-domain=on&ffsdk_DIAG-4402-structured-diagrams=on&ffsdk_DIAG-4750-mermaid-animations=on&ffsdk_DIAG-4834-structured-diagram-qdc=on
```

| Flag | Enables |
| --- | --- |
| `ffsdk_CPF-9594-mermaid-canvas-engine-domain` | Mermaid rendering through the canvas engine domain |
| `ffsdk_DIAG-4402-structured-diagrams` | Structured diagrams — the baseline for this loop |
| `ffsdk_DIAG-4750-mermaid-animations` | Render animations (screenshot after they settle) |
| `ffsdk_DIAG-4834-structured-diagram-qdc` | Quick-create controls — **required for Track B on QDC** |

Keep all four unless the task is specifically about one being off — a missing
flag reads as a layout regression.

Load the schemas once:
`ToolSearch("select:mcp__chrome-devtools__list_pages,mcp__chrome-devtools__select_page,mcp__chrome-devtools__take_snapshot,mcp__chrome-devtools__fill,mcp__chrome-devtools__click,mcp__chrome-devtools__hover,mcp__chrome-devtools__take_screenshot,mcp__chrome-devtools__evaluate_script")`

---

# Track A — code updates

Source in, pixels out.

1. `list_pages` → find the tab whose URL contains the board id → `select_page`.
2. `take_snapshot` → locate the textbox labeled **`mermaid source`**. Its `uid`
   **changes on every snapshot** — always re-snapshot and use the newest one.
3. `fill` that `uid` with the full Mermaid source. This replaces the panel and
   re-renders automatically. Don't type char-by-char.
4. **Wait ~3–4s** for re-layout (a plain `sleep 4` Bash call).
5. **Zoom to fit** (script below) — the diagram lands offset/tiny otherwise.
6. `take_screenshot` with `filePath`, then `Read` the PNG to judge.

## Zoom-to-fit

Fit to the items' own bounding box; plain `viewport.zoomTo(items)` renders too
small/offset. The Miro Web SDK is live on the page as `window.miro`.

```js
async () => {
  const items = await window.miro.board.get();
  const g = items.filter(i => typeof i.x === 'number' && typeof i.width === 'number');
  if (!g.length) return 'no items';
  const x0 = Math.min(...g.map(i => i.x - i.width / 2));
  const y0 = Math.min(...g.map(i => i.y - i.height / 2));
  const x1 = Math.max(...g.map(i => i.x + i.width / 2));
  const y1 = Math.max(...g.map(i => i.y + i.height / 2));
  const w = x1 - x0, h = y1 - y0, pad = 0.1;
  await window.miro.board.viewport.set({
    viewport: { x: x0 - w * pad, y: y0 - h * pad, width: w * (1 + 2 * pad), height: h * (1 + 2 * pad) },
  });
  return 'ok';
}
```

## Prefer logs over screenshots for numeric checks

For waypoint / coordinate / label-placement questions, a tagged log beats a
screenshot. Switch to `canvas-live-debug` for that loop; the only
diagram-specific notes:

- Both a **board reload** and **editing the source** re-run layout, so either
  re-fires the logs.
- Editing the source is the cheaper retrigger — it keeps the viewport.

## Corpus sweeps

For a multi-case sweep, delegate the loop to a subagent — the screenshots are
high-volume and clog the main context. Have it write a self-contained HTML
report (`<img src="case-NN.png">` with the PNGs in the same dir) and return
only a verdict table.

---

# Track B — live view updates

Clicks in, source out. Use this for QDC plus buttons, selection anchors,
resize/rotate handles, and selecting generated nodes.

## Why a bridge is needed

Chrome DevTools MCP can only `click` / `hover` / `drag` by a **`uid` from the
a11y snapshot**. There is no coordinate click. PIXI-painted canvas controls have
no DOM, so they're invisible to it.

The bridge mirrors each canvas control into a transparent
`div[role=button][aria-label]` at the control's screen rect. Crucially the
proxies are **`pointer-events: none`** — MCP's real mouse input at the element
centre falls straight through to the canvas and PIXI does its own hit-testing.
No synthetic events, so hover states and drags behave exactly as for a user, and
`drag(from_uid, to_uid)` works for blue-dot connector drags.

Script: `canvas-mcp-bridge.js`, beside this file in the skill directory. `Read` it
and pass the contents to `evaluate_script` to install `window.__canvasMcp`.

| Call | Does |
| --- | --- |
| `scan({includeHidden})` | list controls (id, label, rect, center) — no DOM touched |
| `mount({debug})` | build the proxy overlay; `debug: true` outlines them magenta for screenshots |
| `unmount()` | remove the overlay |
| `target({x, y, label})` | drop a proxy at an arbitrary point — for **bare canvas**, which has no control to aim at |
| `clearTargets()` | remove `target()` proxies |

## Check for native a11y nodes first

Some canvas UI already exposes real accessible DOM and needs no bridge — the
diagram coldstart buttons ("Create with AI", "Start with freeform", "Build with
code") appear in `take_snapshot` as ordinary buttons, as do the code panel's
template buttons (Flowchart / ER diagram / Class / Sequence).

`take_snapshot` before mounting. Only reach for the bridge for controls that
genuinely aren't there: QDC plus (`control_line_create`), `control_rotate`,
`resizeAnchor__circular`, `control_line_end`, `formatMenu_*`, and the diagram
nodes themselves.

## The loop

1. Board must be loaded with **`?autotest`** — `window.cmd.board.api.e2e` is only
   registered when that param is present (`DeprecatedCanvasAPIActivator.ts`). It
   is absent otherwise, even on staging, and the bridge has nothing to read
   positions from.
2. Install the bridge (`Read` the script → `evaluate_script`).
3. **Select the node** you want controls for. Nodes are canvas-painted, so use
   `target({x, y, label})` at the node centre → `take_snapshot` → `click` that
   uid. Confirm via `cmd.board.api.getSelectionScreenPosition()`.
4. `mount()` → `take_snapshot` → `click` the control's uid.
5. **Verify by reading the source, not the pixels** (see below). The canvas
   render is a side effect; the Mermaid source is the output.

## Reading the code panel back

`[aria-label="mermaid source"]` is a CodeMirror **`div`**, not an input — its
`.value` is always `null`. Use `.innerText`:

```js
() => document.querySelector('[aria-label="mermaid source"]')?.innerText
```

Do **not** use `[data-testid="code-panel-editor"]`: its `innerText` has the
gutter line numbers prepended (`"1\n2\n3\nflowchart TD…"`). Spectator's own
`readCode` helper uses that selector and inherits the problem.

`take_snapshot` also shows the textbox's clean value, which is enough for a
quick eyeball without a script call.

## Gotchas

**Positions are a snapshot, not a binding.** Anything that moves the canvas —
selecting, panning, zooming, or the click you just made — leaves every proxy
stale at its old coordinates. Re-`mount()` before each click. Stale magenta
outlines in a debug screenshot are the tell.

**A page reload wipes `window.__canvasMcp`.** Re-inject after every navigation.

**A control missing from `scan()` may still be on screen.** If a control is
plainly visible in a screenshot but absent from the scan, suspect measurement,
not the app. Rotated controls were the original cause: `LineCreateAnchor` sets
`rotation` per `Direction`, and projecting only two corners through `toGlobal`
inverts, producing negative width/height that the on-screen filter drops. The
shipped script projects all four corners and takes min/max. Compare
`scan()` against `scan({includeHidden: true})` to tell "hidden" from "mismeasured".

**The QDC plus is a per-selection singleton, not four static dots.** It lives
under `DiagrammingCreationButtonServiceImpl` → `SelectionFrame`, and one instance
appears once a node is selected, positioned toward one edge. Don't expect four
anchors per node; if you need a specific direction, hover the relevant edge and
re-`mount()`.

**Bare canvas needs `target()`.** Placing a widget with an armed creation tool,
or starting a marquee, has no element to click — drop a target proxy at the point.

## Worked example — click a QDC plus

Verified against staging with all four flags plus `?autotest`:

1. `click` "Build with code" (native uid) → Mermaid panel opens.
2. `click` "Flowchart" (native uid) → renders Christmas → Go shopping → Let me
   think → Laptop / iPhone / Car.
3. `target({x: 538, y: 243, label: 'Christmas node'})` → `click` it → node
   selected (`getSelectionScreenPosition()` → `499,215 79×57`).
4. `mount()` → `control_line_create` enumerates at `(538, 289)`, 30×30.
5. `click` its uid → source gains:
   ```
   n1[""]
   A --> n1
   ```
6. `unmount()` + `clearTargets()` to leave the board clean.
