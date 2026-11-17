// Snapshot → Jolt shape tree (meters). Pure logic; input geometry is already in body-local space.
// Shape type names map 1:1 to jolt-jni settings classes: `${type}ShapeSettings` (StaticCompound stays).

import { bboxOfPoints, quatBetween, QUAT_IDENTITY, type Vec3, type Quat } from '../util/math.ts'
import type { ElementProps } from './store.ts'

const DEFAULT_CONVEX_RADIUS = 0.05 // meters, Jolt default
const WELD_EPS = 1e-4 // BlockBench units

/** Discriminated shape tree — the engine contract (see docs/FORMAT.md §3). */
export type ShapeNode =
	| { type: 'Box'; halfExtents: Vec3; convexRadius?: number; density?: number }
	| { type: 'Sphere'; radius: number; density?: number }
	| { type: 'Capsule'; halfHeightOfCylinder: number; radius: number; density?: number }
	| {
			type: 'TaperedCapsule'
			halfHeightOfCylinder: number
			topRadius: number
			bottomRadius: number
			density?: number
	  }
	| { type: 'Cylinder'; halfHeight: number; radius: number; convexRadius?: number; density?: number }
	| {
			type: 'TaperedCylinder'
			halfHeight: number
			topRadius: number
			bottomRadius: number
			convexRadius?: number
			density?: number
	  }
	| { type: 'ConvexHull'; points: Vec3[]; maxConvexRadius?: number; density?: number }
	| { type: 'Mesh'; vertices: Vec3[]; triangles: number[][] }
	| { type: 'RotatedTranslated'; position: Vec3; rotation: Quat; inner: ShapeNode }
	| { type: 'StaticCompound'; children: ShapeChild[] }

export type ShapeChild = ShapeNode & { position: Vec3; rotation: Quat }

export interface BodyGeom {
	kind: 'cube' | 'mesh'
	uuid: string
	localVerts: ArrayLike<number>
	indices: number[] | null
	props: ElementProps
}

export interface BuildShapeResult {
	shape: ShapeNode | null
	skipped: string[]
}

interface WeldResult {
	points: number[]
	remap: Map<string, number>
}

function weldPoints(verts: ArrayLike<number>, stride = 3): WeldResult {
	const map = new Map<string, number>()
	const out: number[] = []
	for (let i = 0; i < verts.length; i += stride) {
		const key = `${Math.round(verts[i] / WELD_EPS)}:${Math.round(verts[i + 1] / WELD_EPS)}:${Math.round(verts[i + 2] / WELD_EPS)}`
		if (!map.has(key)) {
			map.set(key, out.length / 3)
			out.push(verts[i], verts[i + 1], verts[i + 2])
		}
	}
	return { points: out, remap: map }
}

function toPoints(verts: ArrayLike<number>): Vec3[] {
	const points: Vec3[] = []
	for (let i = 0; i < verts.length; i += 3) points.push([verts[i], verts[i + 1], verts[i + 2]])
	return points
}

interface BoxFrame {
	axis: 0 | 1 | 2
	he: Vec3
	center: Vec3
	min: Vec3
	max: Vec3
}

// Longest bbox axis
function boxFrame(points: Vec3[]): BoxFrame {
	const { min, max } = bboxOfPoints(points)
	const he: Vec3 = [(max[0] - min[0]) / 2, (max[1] - min[1]) / 2, (max[2] - min[2]) / 2]
	const center: Vec3 = [(max[0] + min[0]) / 2, (max[1] + min[1]) / 2, (max[2] + min[2]) / 2]
	let axis: 0 | 1 | 2 = 0
	if (he[1] >= he[0] && he[1] >= he[2]) axis = 1
	else if (he[2] >= he[0]) axis = 2
	return { axis, he, center, min, max }
}

const AXIS_UNIT: Vec3[] = [
	[1, 0, 0],
	[0, 1, 0],
	[0, 0, 1]
]

// rotation mapping Jolt shape axis (Y) onto the chosen bbox axis
function axisFixRotation(axis: 0 | 1 | 2): Quat {
	if (axis === 1) return QUAT_IDENTITY.slice()
	return quatBetween([0, 1, 0], AXIS_UNIT[axis])
}

// radial extents at the two ends of the bbox along axis (for tapered shapes)
function endRadii(points: Vec3[], frame: BoxFrame, axis: 0 | 1 | 2): { bottom: number; top: number } {
	const perp = [0, 1, 2].filter(i => i !== axis) as [number, number]
	const lo = frame.min[axis] + (frame.max[axis] - frame.min[axis]) * 0.25
	const hi = frame.min[axis] + (frame.max[axis] - frame.min[axis]) * 0.75
	let rLo = 0,
		rHi = 0
	for (const p of points) {
		const atLo = Math.abs(p[axis] - lo) <= Math.abs(p[axis] - hi)
		const r = Math.hypot(p[perp[0]] - frame.center[perp[0]], p[perp[1]] - frame.center[perp[1]])
		if (atLo) rLo = Math.max(rLo, r)
		else rHi = Math.max(rHi, r)
	}
	return { bottom: rLo, top: rHi }
}

function scaledPoint(p: Vec3, s: number): Vec3 {
	return [p[0] * s, p[1] * s, p[2] * s]
}

interface BuiltElement {
	shape: ShapeNode
	center: Vec3
	rotation: Quat
	density?: number
}

// one element → shape description or null (skipped/degenerate)
function buildElementShape(
	kind: 'cube' | 'mesh',
	localVerts: ArrayLike<number>,
	indices: number[] | null,
	props: ElementProps,
	s: number
): BuiltElement | null {
	const shapeType = props.shape === 'auto' ? (kind === 'mesh' ? 'convex_hull' : 'box') : props.shape
	if (shapeType === 'none') return null
	const points = toPoints(localVerts)
	if (!points.length) return null
	const frame = boxFrame(points)
	const volumetric = shapeType !== 'convex_hull' && shapeType !== 'mesh'
	// volumetric proxies with any zero axis are invalid in Jolt (zero-thickness box/capsule/…);
	// hulls and meshes tolerate flat geometry (cloth planes), so only the all-zero case skips them
	if (volumetric ? frame.he.some(h => h <= 1e-9) : frame.he.every(h => h <= 1e-9)) return null

	switch (shapeType) {
		case 'box':
			return {
				shape: {
					type: 'Box',
					halfExtents: frame.he.map(h => h * s),
					convexRadius: DEFAULT_CONVEX_RADIUS
				},
				center: frame.center,
				rotation: QUAT_IDENTITY,
				density: props.density
			}
		case 'sphere': {
			const radius = Math.hypot(frame.he[0], frame.he[1], frame.he[2]) * s
			return {
				shape: { type: 'Sphere', radius },
				center: frame.center,
				rotation: QUAT_IDENTITY,
				density: props.density
			}
		}
		case 'capsule':
		case 'tapered_capsule':
		case 'cylinder':
		case 'tapered_cylinder': {
			const axis = frame.axis
			const radii = endRadii(points, frame, axis)
			const radiusBottom = radii.bottom * s
			const radiusTop = radii.top * s
			const radius = Math.max((radiusBottom + radiusTop) / 2, 1e-6)
			const halfHeight = Math.max(frame.he[axis] * s - radius, 1e-6)
			const rotation = axisFixRotation(axis)
			let shape: ShapeNode
			if (shapeType === 'capsule') shape = { type: 'Capsule', halfHeightOfCylinder: halfHeight, radius }
			else if (shapeType === 'cylinder')
				shape = { type: 'Cylinder', halfHeight, radius, convexRadius: DEFAULT_CONVEX_RADIUS }
			else if (shapeType === 'tapered_capsule')
				shape = {
					type: 'TaperedCapsule',
					halfHeightOfCylinder: halfHeight,
					topRadius: radiusTop,
					bottomRadius: radiusBottom
				}
			else
				shape = {
					type: 'TaperedCylinder',
					halfHeight,
					topRadius: radiusTop,
					bottomRadius: radiusBottom,
					convexRadius: DEFAULT_CONVEX_RADIUS
				}
			return { shape, center: frame.center, rotation, density: props.density }
		}
		case 'convex_hull': {
			const { points: welded } = weldPoints(localVerts)
			const count = welded.length / 3
			if (count < 4) {
				return {
					shape: {
						type: 'Box',
						halfExtents: frame.he.map(h => h * s),
						convexRadius: DEFAULT_CONVEX_RADIUS
					},
					center: frame.center,
					rotation: QUAT_IDENTITY,
					density: props.density
				}
			}
			const hullPoints: Vec3[] = []
			for (let i = 0; i < welded.length; i += 3)
				hullPoints.push([welded[i] * s, welded[i + 1] * s, welded[i + 2] * s])
			return {
				shape: { type: 'ConvexHull', points: hullPoints, maxConvexRadius: DEFAULT_CONVEX_RADIUS },
				center: [0, 0, 0],
				rotation: QUAT_IDENTITY,
				density: props.density
			}
		}
		case 'mesh': {
			const { points: welded, remap } = weldPoints(localVerts)
			if (indices && indices.length >= 3) {
				const triangles: number[][] = []
				for (let i = 0; i < indices.length; i += 3) {
					const a = remap.get(keyOf(localVerts, indices[i]))
					const b = remap.get(keyOf(localVerts, indices[i + 1]))
					const c = remap.get(keyOf(localVerts, indices[i + 2]))
					if (a !== undefined && b !== undefined && c !== undefined) triangles.push([a, b, c])
				}
				const vertices: Vec3[] = []
				for (let i = 0; i < welded.length; i += 3)
					vertices.push([welded[i] * s, welded[i + 1] * s, welded[i + 2] * s])
				return {
					shape: { type: 'Mesh', vertices, triangles },
					center: [0, 0, 0],
					rotation: QUAT_IDENTITY
				}
			}
			// no index buffer → fall back to hull
			return buildElementShape(kind, localVerts, null, { ...props, shape: 'convex_hull' }, s)
		}
	}
	return null
}

function keyOf(verts: ArrayLike<number>, index: number): string {
	const i = index * 3
	return `${Math.round(verts[i] / WELD_EPS)}:${Math.round(verts[i + 1] / WELD_EPS)}:${Math.round(verts[i + 2] / WELD_EPS)}`
}

// geoms: [{ kind, uuid, localVerts, indices, props }]; scale: meters per BlockBench unit
export function buildBodyShape(geoms: BodyGeom[], scale: number): BuildShapeResult {
	const children: ShapeChild[] = []
	const skipped: string[] = []
	for (const geom of geoms) {
		const built = buildElementShape(geom.kind, geom.localVerts, geom.indices, geom.props, scale)
		if (!built) {
			skipped.push(geom.uuid)
			continue
		}
		const child: ShapeChild = {
			...built.shape,
			position: roundVec(scaledPoint(built.center, scale)),
			rotation: roundQuat(built.rotation),
			...(built.density !== undefined ? { density: built.density } : {})
		} as ShapeChild
		children.push(child)
	}
	if (!children.length) return { shape: null, skipped }
	if (children.length === 1) {
		const only = children[0]
		const centered = only.position.every(v => Math.abs(v) < 1e-9) && Math.abs(only.rotation[3] - 1) < 1e-9
		if (centered) {
			const { position: _p, rotation: _r, ...shape } = only
			return { shape: shape as ShapeNode, skipped }
		}
		const { position, rotation, ...inner } = only
		return {
			shape: { type: 'RotatedTranslated', position, rotation, inner: inner as ShapeNode },
			skipped
		}
	}
	return { shape: { type: 'StaticCompound', children }, skipped }
}

function roundVec(v: Vec3): Vec3 {
	return [v[0], v[1], v[2]].map(n => (Math.abs(n) < 1e-12 ? 0 : n))
}

function roundQuat(q: Quat): Quat {
	return q.map((n, i) => (Math.abs(n) < 1e-9 ? (i === 3 ? 1 : 0) : n))
}
