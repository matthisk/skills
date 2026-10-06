/**
 * Canvas → Chrome MCP bridge.
 *
 * Chrome DevTools MCP can only click/hover/drag by `uid`, and uids come from the accessibility-tree
 * snapshot. PIXI-painted canvas controls have no DOM, so they are invisible to it.
 *
 * This mirrors every canvas control into a transparent DOM node with role=button + aria-label, so
 * `take_snapshot` lists them and `click` / `drag` work natively.
 *
 * The proxies are `pointer-events: none` on purpose: MCP dispatches REAL mouse input at the
 * element's centre, which then falls straight through to the canvas and is handled by PIXI's own
 * hit-testing. No synthetic events, no forwarding, so hover states and drags behave exactly as they
 * do for a user.
 *
 * REQUIRES `?autotest` on the board URL. `window.cmd.board.api.e2e` is only registered when that
 * query parameter is present (DeprecatedCanvasAPIActivator.ts) — it is otherwise absent even on
 * staging, so the bridge has nothing to read positions from.
 *
 * Inject with evaluate_script, then:
 *   __canvasMcp.mount()    // build the overlay (call again after the viewport or selection moves)
 *   __canvasMcp.scan()     // list controls without touching the DOM
 *   __canvasMcp.unmount()
 *
 * Positions are a snapshot, not a binding. Anything that moves the canvas — selecting a widget,
 * panning, zooming — leaves the proxies stale, so re-`mount()` before clicking.
 */
;(() => {
	const OVERLAY_ID = 'canvas-mcp-overlay'
	const TARGET_ID = 'canvas-mcp-targets'

	// `_autotestId`s that tag interactive canvas visuals. Used to bootstrap stage discovery, and as
	// the enumeration fallback when the stage cannot be reached.
	const SEED_IDS = [
		'control_line_create',
		'control_line_end',
		'control_line_path',
		'control_divider_end',
		'control_rotate',
		'resizeAnchor__circular',
		'resize_frame__standard',
		'resize_slide__standard',
		'rteChildFrame__resize_handle',
		'structDocChildFrame__resize_handle',
		'mindmap-node__expand-btn',
		'mindmap-node__collapse-btn',
		'usm__topAdd_button',
		'usm__rightAdd_button',
		'usm__bottomAdd_button',
		'usm__leftAdd_button',
		'split_add_slide_button',
		'split_add_lane_button',
		'slide-container_coldstart_add-frame',
		'slide-container_coldstart_add-template',
		'coldstart-button-add-ui-element',
		'coldstart-button-create-with-ai',
		'coldstart-button-convert-screenshot',
		'sticker_addEmojiButton',
		'sticker_emojiReaction',
		'formatMenu_immersiveMode__button',
		'formatMenu_more__button',
		'videoWidget_posterPlayButton',
		'videoWidget_errorReloadButton',
		'contenthub__partner_reconnect_button',
		'doc_comment_bubble',
		'widget__title_text',
		'widget_frame__title_text',
		'base__frame_visual',
		'line_caption',
		'prototyping-connector-controls-visual',
	]

	const READABLE = {
		control_line_create: 'create connector',
		control_line_end: 'connector endpoint',
		control_line_path: 'connector waypoint',
		control_divider_end: 'divider end',
		control_rotate: 'rotate',
		resizeAnchor__circular: 'resize',
		resize_frame__standard: 'resize frame',
		resize_slide__standard: 'resize slide',
		'mindmap-node__expand-btn': 'expand branch',
		'mindmap-node__collapse-btn': 'collapse branch',
		usm__topAdd_button: 'add above',
		usm__rightAdd_button: 'add right',
		usm__bottomAdd_button: 'add below',
		usm__leftAdd_button: 'add left',
		split_add_slide_button: 'add slide',
		split_add_lane_button: 'add lane',
		'slide-container_coldstart_add-frame': 'add blank slide',
		'slide-container_coldstart_add-template': 'add slide from template',
		sticker_addEmojiButton: 'add reaction',
		formatMenu_more__button: 'more actions',
		videoWidget_posterPlayButton: 'play video',
	}

	const e2e = () => window.cmd?.board?.api?.e2e

	// Reaching one tagged object gives us the whole scene graph: walk `.parent` to the stage root.
	// Preferred over the per-id fallback because it also finds ids that postdate SEED_IDS.
	const findStage = () => {
		const api = e2e()
		if (!api) return undefined

		for (const id of SEED_IDS) {
			let hit
			try {
				api.getDisplayObjectPosition(id, obj => {
					hit = obj
					return true
				})
			} catch {
				continue
			}
			if (hit) {
				let node = hit
				while (node.parent) node = node.parent
				return node
			}
		}
		return undefined
	}

	// All four corners are projected, not just two: anchors set `rotation` (LineCreateAnchor rotates
	// per Direction), and a two-corner projection inverts on a rotated object — that produces
	// negative width/height and the control silently drops out of the scan.
	//
	// toGlobal yields CSS pixels. `worldBounds` is axis-aligned but in renderer pixels, so it would
	// need a devicePixelRatio divide.
	const screenRectOf = object => {
		const local = object.localBounds
		const corners = [
			{x: local.x, y: local.y},
			{x: local.x + local.width, y: local.y},
			{x: local.x, y: local.y + local.height},
			{x: local.x + local.width, y: local.y + local.height},
		].map(corner => object.toGlobal(corner))

		const xs = corners.map(corner => corner.x)
		const ys = corners.map(corner => corner.y)
		const x = Math.min(...xs)
		const y = Math.min(...ys)
		return {x, y, width: Math.max(...xs) - x, height: Math.max(...ys) - y}
	}

	const isOnScreen = rect =>
		rect.width > 0 &&
		rect.height > 0 &&
		rect.x + rect.width > 0 &&
		rect.y + rect.height > 0 &&
		rect.x < window.innerWidth &&
		rect.y < window.innerHeight

	const scanViaStage = (stage, includeHidden) => {
		const found = []

		const walk = object => {
			if (!includeHidden && !object.visible) return

			if (object._autotestId) {
				const rect = screenRectOf(object)
				if (includeHidden || isOnScreen(rect)) {
					found.push({id: object._autotestId, rect})
				}
			}

			const children = object.children
			if (children) for (const child of children) walk(child)
		}

		walk(stage)
		return found
	}

	const scanViaKnownIds = async includeHidden => {
		const api = e2e()
		const found = []

		for (const id of SEED_IDS) {
			let elements
			try {
				elements = await api.getElementsFromCanvas(id, includeHidden)
			} catch {
				continue
			}
			for (const element of elements ?? []) {
				if (includeHidden || isOnScreen(element.rectInScreen)) {
					found.push({id, rect: element.rectInScreen})
				}
			}
		}
		return found
	}

	const label = (id, index, total) => {
		const readable = READABLE[id] ?? id.replace(/[_-]+/g, ' ')
		const position = total > 1 ? ` ${index + 1} of ${total}` : ''
		return `canvas ${readable}${position} [${id}]`
	}

	const describe = raw => {
		const perId = new Map()
		for (const item of raw) perId.set(item.id, (perId.get(item.id) ?? 0) + 1)

		const seen = new Map()
		return raw.map(item => {
			const index = seen.get(item.id) ?? 0
			seen.set(item.id, index + 1)
			return {
				id: item.id,
				label: label(item.id, index, perId.get(item.id)),
				rect: {
					x: Math.round(item.rect.x),
					y: Math.round(item.rect.y),
					width: Math.round(item.rect.width),
					height: Math.round(item.rect.height),
				},
				center: {
					x: Math.round(item.rect.x + item.rect.width / 2),
					y: Math.round(item.rect.y + item.rect.height / 2),
				},
			}
		})
	}

	const scan = async ({includeHidden = false} = {}) => {
		if (!e2e()) {
			throw new Error('window.cmd.board.api.e2e is unavailable — reload the board with ?autotest in the URL')
		}

		const stage = findStage()
		const raw = stage ? scanViaStage(stage, includeHidden) : await scanViaKnownIds(includeHidden)
		return describe(raw)
	}

	// Chrome prunes zero-sized nodes from the a11y tree, so proxies are clamped to a minimum size and
	// kept at full opacity with a transparent background (opacity:0 would also get them pruned).
	const MIN_PROXY_SIZE = 12

	const mount = async ({includeHidden = false, debug = false} = {}) => {
		const elements = await scan({includeHidden})

		let overlay = document.getElementById(OVERLAY_ID)
		if (!overlay) {
			overlay = document.createElement('div')
			overlay.id = OVERLAY_ID
			overlay.setAttribute('role', 'group')
			overlay.setAttribute('aria-label', 'Canvas controls')
			overlay.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483000'
			document.body.append(overlay)
		}
		overlay.replaceChildren()

		for (const element of elements) {
			const width = Math.max(element.rect.width, MIN_PROXY_SIZE)
			const height = Math.max(element.rect.height, MIN_PROXY_SIZE)
			const proxy = document.createElement('div')
			proxy.setAttribute('role', 'button')
			proxy.setAttribute('aria-label', element.label)
			proxy.dataset.canvasId = element.id
			proxy.style.cssText = [
				'position:fixed',
				`left:${Math.round(element.center.x - width / 2)}px`,
				`top:${Math.round(element.center.y - height / 2)}px`,
				`width:${width}px`,
				`height:${height}px`,
				'pointer-events:none',
				'background:transparent',
				debug ? 'outline:1px solid magenta' : '',
			]
				.filter(Boolean)
				.join(';')
			overlay.append(proxy)
		}

		return {mounted: elements.length, elements}
	}

	const unmount = () => {
		const overlay = document.getElementById(OVERLAY_ID)
		overlay?.remove()
		return {unmounted: Boolean(overlay)}
	}

	// Bare canvas has no proxy to aim at, so an armed creation tool (or a marquee start point) is
	// unreachable by uid. This drops a standalone proxy at an arbitrary screen point to click.
	const target = ({x, y, label = 'canvas point', size = 16} = {}) => {
		let holder = document.getElementById(TARGET_ID)
		if (!holder) {
			holder = document.createElement('div')
			holder.id = TARGET_ID
			holder.style.cssText = 'position:fixed;inset:0;pointer-events:none;z-index:2147483001'
			document.body.append(holder)
		}
		const proxy = document.createElement('div')
		proxy.setAttribute('role', 'button')
		proxy.setAttribute('aria-label', `${label} (${Math.round(x)},${Math.round(y)})`)
		proxy.style.cssText = `position:fixed;left:${Math.round(x - size / 2)}px;top:${Math.round(
			y - size / 2
		)}px;width:${size}px;height:${size}px;pointer-events:none;background:transparent`
		holder.append(proxy)
		return {label: proxy.getAttribute('aria-label')}
	}

	const clearTargets = () => {
		const holder = document.getElementById(TARGET_ID)
		holder?.remove()
		return {cleared: Boolean(holder)}
	}

	window.__canvasMcp = {scan, mount, unmount, refresh: mount, target, clearTargets, SEED_IDS}
})()
