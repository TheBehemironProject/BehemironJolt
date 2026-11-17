// Constraint gizmo renderer: SVG overlay on the active preview viewport.
// Screen-space drawing (Godot-style fixed gizmo size), theme-adaptive via Blockbench CSS vars.
// Clicking a gizmo opens its constraint editor (Godot: select joint node → inspector).

import { buildConstraintViz, type VizPrimitive } from '../core/vizdata.ts'
import { sanitizeConstraint, buildConstraintHandles } from '../core/constraints.ts'
import { onEvent } from '../bb/adapter.ts'
import type { ConstraintData } from '../core/store.ts'
import type { Vec3 } from '../util/math.ts'

const SVG_NS = 'http://www.w3.org/2000/svg'
const SAMPLE = 24

export interface DebugVector {
	from: Vec3
	to: Vec3
}

export interface VizDeps {
	projectPoint(world: Vec3): { x: number; y: number } | null
	screenToWorld?(px: number, py: number, planePoint: Vec3): Vec3 | null
	comByUuid(uuid: string): Vec3 | null
	getSelectionUuids(): string[]
	onPickConstraint(id: string): void
	onMoveHandle?(constraintId: string, field: string, worldBB: Vec3, index: number | null): void
	isSimActive?(): boolean
	getDebugVectors?(): DebugVector[]
	getSensorDots?(): { pos: Vec3; active: boolean }[]
}

export interface ConstraintViz {
	refresh(constraints?: ConstraintData[]): void
	updateDebug(vectors?: DebugVector[]): void
	dispose(): void
}

interface DragState {
	constraintId: string
	field: string
	index: number | null
	planePoint: Vec3
}

let styleInjected = false
let styleEl: HTMLStyleElement | null = null

function injectStyle(): void {
	if (styleInjected) return
	styleInjected = true
	const css = `
		.behemiron_jolt_viz { position: absolute; inset: 0; width: 100%; height: 100%; pointer-events: none; overflow: visible; }
		.behemiron_jolt_viz .bj-c { pointer-events: auto; cursor: pointer; }
		.behemiron_jolt_viz line, .behemiron_jolt_viz polyline, .behemiron_jolt_viz path {
			fill: none; stroke-width: 2; vector-effect: non-scaling-stroke; stroke-linecap: round; }
		.behemiron_jolt_viz .role-joint { color: var(--color-accent, #7cc4ff); }
		.behemiron_jolt_viz .role-a { color: #6db3f2; }
		.behemiron_jolt_viz .role-b { color: #63d0e6; }
		.behemiron_jolt_viz .bj-c { opacity: 0.45; }
		.behemiron_jolt_viz .bj-c.active { opacity: 1; }
		.behemiron_jolt_viz .bj-c.active line, .behemiron_jolt_viz .bj-c.active polyline, .behemiron_jolt_viz .bj-c.active path { stroke-width: 2.75; }
		.behemiron_jolt_viz .bj-c:hover { opacity: 1; }
		.behemiron_jolt_viz .bj-handle { cursor: grab; pointer-events: auto; }
		.behemiron_jolt_viz .bj-handle rect { fill: var(--color-accent, #7cc4ff); stroke: #fff; stroke-width: 1; }
		.behemiron_jolt_viz .bj-handle:hover rect { fill: #fff; }
		.behemiron_jolt_viz .bj-debug line { stroke: var(--color-accent, #7cc4ff); stroke-dasharray: 4 3; opacity: 0.8; }
		.behemiron_jolt_viz .bj-sensor { fill: none; stroke: var(--color-accent, #7cc4ff); stroke-width: 2; opacity: 0.5; }
		.behemiron_jolt_viz .bj-sensor.active { fill: var(--color-accent, #7cc4ff); opacity: 1; }
	`
	const style = document.createElement('style')
	style.textContent = css
	document.head.appendChild(style)
	styleEl = style
}

function el(name: string, attrs: Record<string, string>): SVGElement {
	const node = document.createElementNS(SVG_NS, name)
	for (const [key, value] of Object.entries(attrs)) node.setAttribute(key, value)
	return node
}

export function createViz(deps: VizDeps): ConstraintViz {
	let svg: SVGSVGElement | null = null
	let host: HTMLElement | null = null
	let hostPrevPosition = ''
	let resizeObserver: ResizeObserver | null = null
	let lastConstraints: ConstraintData[] = []
	let debugGroup: SVGGElement | null = null
	let rafPending = false
	let drag: DragState | null = null

	function activeHost(): HTMLElement | null {
		const preview = (globalThis as any).Preview?.selected
		if (!preview?.node || !preview.camera) return null
		if (preview.node !== host) {
			if (resizeObserver) {
				resizeObserver.disconnect()
				resizeObserver = null
			}
			if (svg) svg.remove()
			if (host && hostPrevPosition) {
				host.style.position = hostPrevPosition
				hostPrevPosition = ''
			}
			svg = null
			host = preview.node as HTMLElement
			if (getComputedStyle(host).position === 'static') {
				hostPrevPosition = host.style.position || 'static'
				host.style.position = 'relative'
			}
			svg = el('svg', { class: 'behemiron_jolt_viz' }) as SVGSVGElement
			host.appendChild(svg)
			debugGroup = null
			resizeObserver = new ResizeObserver(() => refresh())
			resizeObserver.observe(host)
		}
		return host
	}

	function projectAll(constraints: ConstraintData[]): void {
		if (!activeHost()) return
		if (!svg) return
		const selected = new Set(deps.getSelectionUuids?.() || [])
		const simActive = deps.isSimActive?.() || false
		while (svg.firstChild) svg.removeChild(svg.firstChild)
		debugGroup = el('g', { class: 'bj-debug-layer' }) as SVGGElement
		svg.appendChild(debugGroup)
		for (const constraint of constraints) {
			const clean = sanitizeConstraint(constraint)
			if (!clean) continue
			const isActive = selected.has(clean.bodyA) || selected.has(clean.bodyB)
			const primitives = buildConstraintViz(clean, deps.comByUuid)
			const group = el('g', { class: 'bj-c' + (isActive ? ' active' : '') })
			// click-vs-drag: open the editor only when press+release happen without travel (Godot selects on click)
			let downPos: { x: number; y: number } | null = null
			group.addEventListener('pointerdown', (event: Event) => {
				const e = event as PointerEvent
				downPos = { x: e.clientX, y: e.clientY }
			})
			group.addEventListener('pointerup', (event: Event) => {
				if (!downPos) return
				const e = event as PointerEvent
				const moved = Math.hypot(e.clientX - downPos.x, e.clientY - downPos.y)
				downPos = null
				if (moved < 5 && !(deps.isSimActive?.() ?? false)) {
					e.stopPropagation()
					deps.onPickConstraint?.(clean.id)
				}
			})
			for (const p of primitives) drawPrimitive(group, p)
			if (group.childNodes.length) svg.appendChild(group)
			if (!simActive && deps.onMoveHandle) drawHandles(svg, clean)
		}
		redrawDebug()
	}

	function drawHandles(root: SVGSVGElement, constraint: ConstraintData): void {
		for (const handle of buildConstraintHandles(constraint)) {
			const s = deps.projectPoint(handle.position)
			if (!s) continue
			const g = el('g', { class: 'bj-handle', 'data-field': handle.field }) as SVGGElement
			g.appendChild(
				el('rect', {
					x: String(s.x - 4),
					y: String(s.y - 4),
					width: '8',
					height: '8',
					transform: `rotate(45 ${s.x} ${s.y})`
				})
			)
			g.appendChild(el('circle', { cx: String(s.x), cy: String(s.y), r: '9', fill: 'transparent' }))
			g.addEventListener('pointerdown', (event: Event) => {
				event.stopPropagation()
				event.preventDefault()
				drag = {
					constraintId: constraint.id,
					field: handle.field,
					index: handle.index,
					planePoint: handle.position.slice()
				}
				window.addEventListener('pointermove', onDragMove)
				window.addEventListener('pointerup', onDragEnd, { once: true })
			})
			root.appendChild(g)
		}
	}

	function onDragMove(event: PointerEvent): void {
		if (!drag || !svg || !deps.screenToWorld) return
		const rect = svg.getBoundingClientRect()
		const world = deps.screenToWorld(event.clientX - rect.left, event.clientY - rect.top, drag.planePoint)
		if (!world) return
		drag.planePoint = world.slice()
		deps.onMoveHandle?.(drag.constraintId, drag.field, world, drag.index)
	}

	function onDragEnd(): void {
		drag = null
		window.removeEventListener('pointermove', onDragMove)
	}

	function redrawDebug(): void {
		if (!debugGroup) return
		while (debugGroup.firstChild) debugGroup.removeChild(debugGroup.firstChild)
		const vectors = deps.getDebugVectors?.() || []
		for (const v of vectors) {
			const a = deps.projectPoint(v.from)
			const b = deps.projectPoint(v.to)
			if (!a || !b) continue
			debugGroup.appendChild(
				el('line', { x1: String(a.x), y1: String(a.y), x2: String(b.x), y2: String(b.y) })
			)
		}
		const dots = deps.getSensorDots?.() || []
		for (const d of dots) {
			const s = deps.projectPoint(d.pos)
			if (!s) continue
			const circle = el('circle', {
				cx: String(s.x),
				cy: String(s.y),
				r: '5',
				class: 'bj-sensor' + (d.active ? ' active' : '')
			})
			debugGroup.appendChild(circle)
		}
	}

	function drawPrimitive(group: SVGElement, p: VizPrimitive): void {
		const cls = 'role-' + p.role
		if (p.kind === 'segment') {
			const a = deps.projectPoint(p.a),
				b = deps.projectPoint(p.b)
			if (!a || !b) return
			group.appendChild(
				el('line', { x1: String(a.x), y1: String(a.y), x2: String(b.x), y2: String(b.y), class: cls })
			)
		} else if (p.kind === 'cross') {
			for (const axis of [
				[1, 0, 0],
				[0, 1, 0],
				[0, 0, 1]
			]) {
				const a = deps.projectPoint([
					p.at[0] - axis[0] * p.size,
					p.at[1] - axis[1] * p.size,
					p.at[2] - axis[2] * p.size
				])
				const b = deps.projectPoint([
					p.at[0] + axis[0] * p.size,
					p.at[1] + axis[1] * p.size,
					p.at[2] + axis[2] * p.size
				])
				if (!a || !b) continue
				group.appendChild(
					el('line', {
						x1: String(a.x),
						y1: String(a.y),
						x2: String(b.x),
						y2: String(b.y),
						class: cls
					})
				)
			}
		} else if (p.kind === 'polyline') {
			const pts: string[] = []
			for (const w of p.points) {
				const s = deps.projectPoint(w)
				if (!s) return
				pts.push(`${s.x},${s.y}`)
			}
			if (pts.length >= 2) group.appendChild(el('polyline', { points: pts.join(' '), class: cls }))
		} else if (p.kind === 'arc') {
			const points = sampleArc(p.center, p.axis, p.radius, p.from, p.to, p.ref)
			const pts: string[] = []
			for (const w of points) {
				const s = deps.projectPoint(w)
				if (!s) return
				pts.push(`${s.x},${s.y}`)
			}
			if (pts.length >= 2) group.appendChild(el('polyline', { points: pts.join(' '), class: cls }))
		}
	}

	function sampleArc(
		center: Vec3,
		axis: Vec3,
		radius: number,
		from: number | null,
		to: number | null,
		refDir?: Vec3
	): Vec3[] {
		const n = axis
		const fallback = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
		const ref = refDir && Math.hypot(...refDir) > 1e-6 ? refDir : fallback
		const u0: Vec3 = [
			n[1] * ref[2] - n[2] * ref[1],
			n[2] * ref[0] - n[0] * ref[2],
			n[0] * ref[1] - n[1] * ref[0]
		]
		const l = Math.hypot(...u0) || 1
		const u: Vec3 = [u0[0] / l, u0[1] / l, u0[2] / l]
		const v: Vec3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]]
		const f = from ?? 0
		const t = to ?? Math.PI * 2
		const points: Vec3[] = []
		const steps = Math.max(8, Math.round((SAMPLE * Math.abs(t - f)) / (Math.PI * 2)))
		for (let i = 0; i <= steps; i++) {
			const tt = f + (t - f) * (i / steps)
			const cos = Math.cos(tt) * radius,
				sin = Math.sin(tt) * radius
			points.push([
				center[0] + u[0] * cos + v[0] * sin,
				center[1] + u[1] * cos + v[1] * sin,
				center[2] + u[2] * cos + v[2] * sin
			])
		}
		return points
	}

	function refresh(constraints?: ConstraintData[]): void {
		injectStyle()
		if (constraints) lastConstraints = constraints
		if (rafPending) return
		rafPending = true
		requestAnimationFrame(() => {
			rafPending = false
			projectAll(lastConstraints)
		})
	}

	function updateDebug(): void {
		if (rafPending) return
		rafPending = true
		requestAnimationFrame(() => {
			rafPending = false
			redrawDebug()
		})
	}

	const offCamera = onEvent('update_camera_position', () => refresh())
	const offSelect = onEvent('update_selection', () => refresh())

	return {
		refresh,
		updateDebug,
		dispose() {
			offCamera()
			offSelect()
			window.removeEventListener('pointermove', onDragMove)
			if (resizeObserver) {
				resizeObserver.disconnect()
				resizeObserver = null
			}
			if (svg) svg.remove()
			svg = null
			if (host && hostPrevPosition) {
				host.style.position = hostPrevPosition
				hostPrevPosition = ''
			}
			host = null
			debugGroup = null
			if (styleEl) {
				styleEl.remove()
				styleEl = null
				styleInjected = false
			}
		}
	}
}
