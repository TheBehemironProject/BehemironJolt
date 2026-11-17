// Snapshot → physics bodies. Pure logic (testable with fabricated snapshots).
// A body = a top-level Group (nested groups roll up) or a single root-level element.

import {
	mat4Invert,
	mat4Compose,
	mat4Decompose,
	transformPoint,
	type Mat4,
	type Vec3,
	type Quat
} from '../util/math.ts'
import { buildBodyShape, type ShapeNode, type BodyGeom } from './shapes.ts'
import type { PhysicsStore, BodyProps } from './store.ts'

export interface SnapshotElement {
	uuid: string
	name: string
	kind: 'cube' | 'mesh'
	groupUuid: string | null
	matrix: Mat4
	/** flattened xyz world-space vertices (BlockBench units) */
	verts: number[]
	indices: number[] | null
}

export interface SnapshotGroup {
	uuid: string
	name: string
	parentUuid: string | null
	matrix: Mat4
}

export interface Snapshot {
	elements: SnapshotElement[]
	groups: SnapshotGroup[]
	/** armature bones with BB weight-paint data (soft body skinning) */
	bones?: {
		boneUuid: string
		boneName: string
		weights: Record<string, number>
	}[]
	/** mesh vertices keyed for skinning: meshUuidPrefix → vkey → body-local position (BB units) */
	skinMeshes?: Record<string, Record<string, number[]>>
}

export interface BodyTarget {
	uuid: string
	name: string
	matrix: Mat4
	elementUuids: string[]
}

export interface BodyDesc {
	uuid: string
	name: string
	/** meters */
	position: Vec3
	rotation: Quat
	props: BodyProps
	shape: ShapeNode | null
	frame: Mat4
	elementUuids: string[]
	/** child groups in body-local meters (vehicle wheel candidates) */
	wheelGroups?: { name: string; position: Vec3 }[]
	/** per-cube boxes in body-local meters (soft body voxels) */
	softCubes?: { min: Vec3; max: Vec3 }[]
	/** soft body skin bindings (per soft vertex, normalized) + pinned vertex indices */
	skin?: { bindings: { boneUuid: string; boneName: string; weights: number[] }[]; pinned: number[] }
	/** raw BB weight-paint sources (bones + mesh vertices, BB units) for engine-side binding */
	skinSources?: { bones: NonNullable<Snapshot['bones']>; skinMeshes: NonNullable<Snapshot['skinMeshes']> }
}

export interface PipelineResult {
	bodyDescs: BodyDesc[]
	groundY: number
	skipped: string[]
	settings: ReturnType<PhysicsStore['getSettings']>
	scale: number
}

export function computeBodies(snapshot: Snapshot): BodyTarget[] {
	const groups = snapshot.groups.filter(g => g.parentUuid === null)
	const elements = snapshot.elements
	const bodies: BodyTarget[] = []
	for (const group of groups) {
		const own = elements.filter(e => e.groupUuid === group.uuid)
		if (own.length) {
			bodies.push({
				uuid: group.uuid,
				name: group.name,
				matrix: group.matrix,
				elementUuids: own.map(e => e.uuid)
			})
		}
	}
	for (const element of elements) {
		if (element.groupUuid === null) {
			bodies.push({
				uuid: element.uuid,
				name: element.name,
				matrix: element.matrix,
				elementUuids: [element.uuid]
			})
		}
	}
	return bodies
}

function transformVerts(verts: number[], matrix: Mat4): number[] {
	const out = new Array<number>(verts.length)
	for (let i = 0; i < verts.length; i += 3) {
		const p = transformPoint(matrix, [verts[i], verts[i + 1], verts[i + 2]])
		out[i] = p[0]
		out[i + 1] = p[1]
		out[i + 2] = p[2]
	}
	return out
}

// returns { bodyDescs, groundY, skipped, settings, scale }
export function buildPhysicsFromSnapshot(snapshot: Snapshot, store: PhysicsStore): PipelineResult {
	const settings = store.getSettings()
	const scale = 1 / settings.unitsPerMeter
	const bodies = computeBodies(snapshot)
	const elementByUuid = new Map(snapshot.elements.map(e => [e.uuid, e]))
	const bodyDescs: BodyDesc[] = []
	const skipped: string[] = []

	for (const body of bodies) {
		const decomposed = mat4Decompose(body.matrix)
		const bodyFrame = mat4Compose(decomposed.position, decomposed.quaternion, [1, 1, 1])
		const inv = mat4Invert(bodyFrame)
		const geoms: BodyGeom[] = []
		for (const uuid of body.elementUuids) {
			const element = elementByUuid.get(uuid)
			if (!element) continue
			geoms.push({
				kind: element.kind,
				uuid,
				localVerts: transformVerts(element.verts, inv),
				indices: element.indices,
				props: store.getElementProps(uuid)
			})
		}
		const { shape, skipped: bodySkipped } = buildBodyShape(geoms, scale)
		skipped.push(...bodySkipped)
		bodyDescs.push({
			uuid: body.uuid,
			name: body.name,
			position: [
				decomposed.position[0] * scale,
				decomposed.position[1] * scale,
				decomposed.position[2] * scale
			],
			rotation: decomposed.quaternion,
			props: store.getBodyProps(body.uuid),
			shape,
			frame: bodyFrame,
			elementUuids: body.elementUuids,
			wheelGroups: snapshot.groups
				.filter(g => g.parentUuid === body.uuid)
				.map(g => {
					const gd = mat4Decompose(g.matrix)
					const local = transformPoint(inv, gd.position)
					return { name: g.name, position: [local[0] * scale, local[1] * scale, local[2] * scale] }
				}),
			softCubes: geoms
				.filter(gm => gm.kind === 'cube' && gm.props.shape !== 'none')
				.map(gm => {
					const min: Vec3 = [Infinity, Infinity, Infinity]
					const max: Vec3 = [-Infinity, -Infinity, -Infinity]
					const v = gm.localVerts
					for (let i = 0; i < v.length; i += 3) {
						for (let k = 0; k < 3; k++) {
							if (v[i + k] < min[k]) min[k] = v[i + k]
							if (v[i + k] > max[k]) max[k] = v[i + k]
						}
					}
					return { min: min.map(n => n * scale), max: max.map(n => n * scale) }
				}),
			skinSources:
				snapshot.bones && snapshot.skinMeshes
					? { bones: snapshot.bones, skinMeshes: snapshot.skinMeshes }
					: undefined
		})
	}

	let groundY = 0
	let hasGroundRef = false
	for (const element of snapshot.elements) {
		for (let i = 1; i < element.verts.length; i += 3) {
			const y = element.verts[i] * scale
			if (!hasGroundRef || y < groundY) groundY = y
			hasGroundRef = true
		}
	}

	return { bodyDescs, groundY, skipped, settings, scale }
}
