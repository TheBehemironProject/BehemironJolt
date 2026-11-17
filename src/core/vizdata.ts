// Constraint gizmo geometry (pure, testable). Emits world-space primitives in BlockBench units;
// the renderer projects them to screen space.
// Vocabulary follows Godot's joint_3d_gizmo_plugin: per-body tinted limit circles + axis lines.

import { mat4Compose, transformPoint, type Vec3 } from '../util/math.ts'
import type { ConstraintData } from './store.ts'

export type VizRole = 'joint' | 'a' | 'b'

export type VizPrimitive =
	| { role: VizRole; kind: 'segment'; a: Vec3; b: Vec3 }
	| { role: VizRole; kind: 'cross'; at: Vec3; size: number }
	| {
			role: VizRole
			kind: 'arc'
			center: Vec3
			axis: Vec3
			radius: number
			from: number | null
			to: number | null
			ref?: Vec3
	  }
	| { role: VizRole; kind: 'polyline'; points: Vec3[] }

const AXIS_HALF = 8
const CROSS = 2.5
const RADIUS_A = 6
const RADIUS_B = 6.5
const DEG2RAD = Math.PI / 180

function norm(v: Vec3): Vec3 {
	const l = Math.hypot(v[0], v[1], v[2]) || 1
	return [v[0] / l, v[1] / l, v[2] / l]
}

function vec(value: unknown, fallback: Vec3): Vec3 {
	return Array.isArray(value) && value.length === 3 && (value as number[]).every(Number.isFinite)
		? (value as Vec3)
		: fallback
}

function num(value: unknown, fallback: number): number {
	return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function addCross(out: VizPrimitive[], role: VizRole, at: Vec3, size = CROSS): void {
	out.push({ role, kind: 'cross', at: at.slice(), size })
}

function addSegment(out: VizPrimitive[], role: VizRole, a: Vec3, b: Vec3): void {
	out.push({ role, kind: 'segment', a: a.slice(), b: b.slice() })
}

function addAxis(out: VizPrimitive[], role: VizRole, center: Vec3, axis: Vec3, half = AXIS_HALF): void {
	const n = norm(axis)
	addSegment(
		out,
		role,
		[center[0] - n[0] * half, center[1] - n[1] * half, center[2] - n[2] * half],
		[center[0] + n[0] * half, center[1] + n[1] * half, center[2] + n[2] * half]
	)
}

// full circle when from/to are null; angles in radians
function addArc(
	out: VizPrimitive[],
	role: VizRole,
	center: Vec3,
	axis: Vec3,
	radius: number,
	from: number | null,
	to: number | null,
	ref?: Vec3
): void {
	out.push({
		role,
		kind: 'arc',
		center: center.slice(),
		axis: norm(axis),
		radius,
		from,
		to,
		ref: ref ? ref.slice() : undefined
	})
}

function addCirclePolyline(
	out: VizPrimitive[],
	role: VizRole,
	center: Vec3,
	axis: Vec3,
	radius: number,
	at?: Vec3
): void {
	const n = norm(axis)
	const ref = Math.abs(n[1]) < 0.9 ? [0, 1, 0] : [1, 0, 0]
	const u = norm([
		n[1] * ref[2] - n[2] * ref[1],
		n[2] * ref[0] - n[0] * ref[2],
		n[0] * ref[1] - n[1] * ref[0]
	])
	const v: Vec3 = [n[1] * u[2] - n[2] * u[1], n[2] * u[0] - n[0] * u[2], n[0] * u[1] - n[1] * u[0]]
	const c = at || center
	const points: Vec3[] = []
	for (let i = 0; i <= 32; i++) {
		const t = (i / 32) * Math.PI * 2
		const cos = Math.cos(t) * radius,
			sin = Math.sin(t) * radius
		points.push([
			c[0] + u[0] * cos + v[0] * sin,
			c[1] + u[1] * cos + v[1] * sin,
			c[2] + u[2] * cos + v[2] * sin
		])
	}
	out.push({ role, kind: 'polyline', points })
}

function limitArc(
	out: VizPrimitive[],
	role: VizRole,
	center: Vec3,
	axis: Vec3,
	radius: number,
	minDeg: number | null,
	maxDeg: number | null,
	ref?: Vec3
): void {
	if (minDeg === null || maxDeg === null) {
		addArc(out, role, center, axis, radius, 0, Math.PI * 2, ref)
	} else {
		addArc(out, role, center, axis, radius, minDeg * DEG2RAD, maxDeg * DEG2RAD, ref)
	}
}

// projection of `dir` onto the plane perpendicular to unit `axis` (Godot look_body convention)
function perpOf(axis: Vec3, dir: Vec3): Vec3 | undefined {
	const n = norm(axis)
	const d = [dir[0], dir[1], dir[2]]
	const dot = d[0] * n[0] + d[1] * n[1] + d[2] * n[2]
	const p: Vec3 = [d[0] - n[0] * dot, d[1] - n[1] * dot, d[2] - n[2] * dot]
	const l = Math.hypot(...p)
	return l > 1e-6 ? [p[0] / l, p[1] / l, p[2] / l] : undefined
}

// c: sanitized constraint (BB units / degrees); comOf(uuid) → [x,y,z] | null
export function buildConstraintViz(c: ConstraintData, comOf: (uuid: string) => Vec3 | null): VizPrimitive[] {
	const out: VizPrimitive[] = []
	switch (c.type) {
		case 'Fixed':
			addCross(out, 'joint', vec(c.point1, [0, 0, 0]))
			addSegment(out, 'joint', vec(c.point1, [0, 0, 0]), vec(c.point2, [0, 0, 0]))
			break
		case 'Distance':
			addSegment(out, 'joint', vec(c.point1, [0, 0, 0]), vec(c.point2, [0, 0, 0]))
			addCross(out, 'a', vec(c.point1, [0, 0, 0]), CROSS * 0.8)
			addCross(out, 'b', vec(c.point2, [0, 0, 0]), CROSS * 0.8)
			break
		case 'Hinge': {
			addCross(out, 'joint', vec(c.point1, [0, 0, 0]), CROSS * 0.8)
			addAxis(out, 'joint', vec(c.point1, [0, 0, 0]), vec(c.hingeAxis1, [0, 1, 0]))
			const p1 = vec(c.point1, [0, 0, 0])
			const axis = vec(c.hingeAxis1, [0, 1, 0])
			const comA = comOf(c.bodyA)
			const comB = comOf(c.bodyB)
			const refA = comA ? perpOf(axis, [comA[0] - p1[0], comA[1] - p1[1], comA[2] - p1[2]]) : undefined
			const refB = comB ? perpOf(axis, [comB[0] - p1[0], comB[1] - p1[1], comB[2] - p1[2]]) : undefined
			limitArc(
				out,
				'a',
				p1,
				axis,
				RADIUS_A,
				(c.limitsMin as number | null) ?? null,
				(c.limitsMax as number | null) ?? null,
				refA
			)
			limitArc(
				out,
				'b',
				p1,
				axis,
				RADIUS_B,
				(c.limitsMin as number | null) ?? null,
				(c.limitsMax as number | null) ?? null,
				refB
			)
			break
		}
		case 'Slider': {
			const n = norm(vec(c.sliderAxis1, [0, 1, 0]))
			const p1 = vec(c.point1, [0, 0, 0])
			const lo =
				c.limitsMin === null || c.limitsMin === undefined ? -AXIS_HALF : num(c.limitsMin, -AXIS_HALF)
			const hi =
				c.limitsMax === null || c.limitsMax === undefined ? AXIS_HALF : num(c.limitsMax, AXIS_HALF)
			const at = (d: number): Vec3 => [p1[0] + n[0] * d, p1[1] + n[1] * d, p1[2] + n[2] * d]
			addSegment(out, 'joint', at(lo), at(hi))
			addCross(out, 'joint', at(lo), CROSS * 0.6)
			addCross(out, 'joint', at(hi), CROSS * 0.6)
			addCross(out, 'a', p1, CROSS * 0.8)
			addCross(out, 'b', vec(c.point2, [0, 0, 0]), CROSS * 0.8)
			break
		}
		case 'Point':
			addCross(out, 'a', vec(c.point1, [0, 0, 0]), CROSS * 0.8)
			addCross(out, 'b', vec(c.point2, [0, 0, 0]), CROSS * 0.8)
			break
		case 'Cone': {
			const p1 = vec(c.point1, [0, 0, 0])
			const axis = vec(c.twistAxis1, [0, 1, 0])
			addCross(out, 'joint', p1, CROSS * 0.8)
			addAxis(out, 'joint', p1, axis, AXIS_HALF * 0.6)
			const half = num(c.halfConeAngle, 45) * DEG2RAD
			const na = norm(axis)
			const base: Vec3 = [
				p1[0] + na[0] * AXIS_HALF * 0.6,
				p1[1] + na[1] * AXIS_HALF * 0.6,
				p1[2] + na[2] * AXIS_HALF * 0.6
			]
			addCirclePolyline(out, 'a', p1, axis, Math.tan(half) * AXIS_HALF * 0.6, base)
			break
		}
		case 'SwingTwist': {
			const p1 = vec(c.position1, [0, 0, 0])
			const axis = vec(c.twistAxis1, [0, 1, 0])
			addCross(out, 'joint', p1, CROSS * 0.8)
			addAxis(out, 'joint', p1, axis, AXIS_HALF * 0.6)
			const half = Math.max(num(c.normalHalfConeAngle, 45), num(c.planeHalfConeAngle, 45)) * DEG2RAD
			const na = norm(axis)
			const base: Vec3 = [
				p1[0] + na[0] * AXIS_HALF * 0.6,
				p1[1] + na[1] * AXIS_HALF * 0.6,
				p1[2] + na[2] * AXIS_HALF * 0.6
			]
			addCirclePolyline(out, 'a', p1, axis, Math.tan(half) * AXIS_HALF * 0.6, base)
			break
		}
		case 'SixDOF':
			addCross(out, 'joint', vec(c.position1, [0, 0, 0]))
			addCross(out, 'joint', vec(c.position2, [0, 0, 0]))
			addSegment(out, 'joint', vec(c.position1, [0, 0, 0]), vec(c.position2, [0, 0, 0]))
			break
		case 'Pulley':
			addCross(out, 'a', vec(c.bodyPoint1, [0, 0, 0]), CROSS * 0.8)
			addCross(out, 'b', vec(c.bodyPoint2, [0, 0, 0]), CROSS * 0.8)
			out.push({
				role: 'joint',
				kind: 'polyline',
				points: [
					vec(c.bodyPoint1, [0, 0, 0]),
					vec(c.fixedPoint1, [0, 8, 0]),
					vec(c.fixedPoint2, [0, 8, 0]),
					vec(c.bodyPoint2, [0, 0, 0])
				]
			})
			addCross(out, 'joint', vec(c.fixedPoint1, [0, 8, 0]), CROSS * 0.6)
			addCross(out, 'joint', vec(c.fixedPoint2, [0, 8, 0]), CROSS * 0.6)
			break
		case 'Gear': {
			const comA = comOf(c.bodyA),
				comB = comOf(c.bodyB)
			if (comA) {
				addCross(out, 'a', comA)
				addAxis(out, 'a', comA, vec(c.hingeAxis1, [0, 1, 0]), AXIS_HALF * 0.7)
			}
			if (comB) {
				addCross(out, 'b', comB)
				addAxis(out, 'b', comB, vec(c.hingeAxis2, [0, 1, 0]), AXIS_HALF * 0.7)
			}
			break
		}
		case 'RackAndPinion': {
			const comA = comOf(c.bodyA),
				comB = comOf(c.bodyB)
			if (comA) {
				addCross(out, 'a', comA)
				addAxis(out, 'a', comA, vec(c.hingeAxis, [0, 1, 0]), AXIS_HALF * 0.7)
			}
			if (comB) {
				addCross(out, 'b', comB)
				addAxis(out, 'b', comB, vec(c.sliderAxis, [1, 0, 0]), AXIS_HALF * 0.7)
			}
			break
		}
		case 'Path': {
			const m = mat4Compose(
				vec(c.pathPosition, [0, 0, 0]),
				Array.isArray(c.pathRotation) ? (c.pathRotation as number[]) : [0, 0, 0, 1],
				[1, 1, 1]
			)
			const points = Array.isArray(c.pathPoints)
				? (c.pathPoints as Vec3[]).map(p => transformPoint(m, p))
				: []
			if (points.length >= 2) out.push({ role: 'joint', kind: 'polyline', points })
			if (points.length) addCross(out, 'joint', points[0], CROSS * 0.8)
			break
		}
	}
	return out
}
