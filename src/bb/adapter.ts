// The ONLY module (besides main.ts registration) that touches Blockbench globals.
// Everything else receives plain data from here. Swap this module to port or to mock in tests.
// Blockbench runtime shapes vary (Object3D vs Mesh unions), so BB nodes are typed pragmatically.

import { mat4FromElements, bboxOfPoints, type Vec3, type Mat4 } from '../util/math.ts'
import type { Snapshot } from '../core/pipeline.ts'

type AnyEl = any

function topGroupUuid(element: AnyEl): string | null {
	let node: AnyEl = element.parent
	let top: AnyEl = null
	while (node && node !== 'root') {
		if (node.type === 'group') top = node
		node = node.parent
	}
	return top ? top.uuid : null
}

export interface SelectionResult {
	elements: AnyEl[]
	groups: AnyEl[]
}

export function getSelection(): SelectionResult {
	// Outliner.selected only ever contains elements (Project.selected_elements); group selection
	// lives in Group.selected (Project.selected_groups) — group.js:554-563, project.ts:108,172
	const Group: AnyEl = (globalThis as any).Group
	const selectedElements: AnyEl[] = (globalThis as any).Outliner?.selected || []
	const groups: AnyEl[] = (Group?.selected || []).slice()
	const Cube: AnyEl = (globalThis as any).Cube
	const Mesh: AnyEl = (globalThis as any).Mesh
	const elements: AnyEl[] = []
	for (const node of selectedElements) {
		if (node instanceof Cube || node instanceof Mesh) {
			elements.push(node)
		}
	}
	// Elements inside selected groups are represented by the group
	const filteredElements = elements.filter(el => !groups.some((g: AnyEl) => isDescendantOf(el, g)))
	return { elements: filteredElements, groups }
}

function isDescendantOf(element: AnyEl, group: AnyEl): boolean {
	let node: AnyEl = element.parent
	while (node && node !== 'root') {
		if (node === group) return true
		node = node.parent
	}
	return false
}

export function takeSnapshot(): Snapshot {
	const Canvas: AnyEl = (globalThis as any).Canvas
	Canvas.scene.updateMatrixWorld(true)
	const elements: Snapshot['elements'] = []
	const Cube: AnyEl = (globalThis as any).Cube
	const Mesh: AnyEl = (globalThis as any).Mesh
	const all: AnyEl[] = [...(Cube.all || []), ...(Mesh.all || [])]
	for (const el of all) {
		if (!el.mesh || el.export === false) continue
		const geometry = el.mesh.geometry
		const position = geometry?.attributes?.position
		if (!position) continue
		const matrix: Mat4 = mat4FromElements(el.mesh.matrixWorld.elements)
		const source = position.array
		const verts = new Array<number>(source.length)
		for (let i = 0; i < source.length; i++) verts[i] = source[i]
		const indices = geometry.index ? Array.from(geometry.index.array as number[]) : null
		elements.push({
			uuid: el.uuid,
			name: el.name,
			kind: el instanceof Cube ? 'cube' : 'mesh',
			groupUuid: topGroupUuid(el),
			matrix,
			verts,
			indices
		})
	}
	const Group: AnyEl = (globalThis as any).Group
	const groups: Snapshot['groups'] = (Group.all || [])
		.map((group: AnyEl) => ({
			uuid: group.uuid,
			name: group.name,
			parentUuid:
				group.parent && group.parent !== 'root' && group.parent.uuid ? group.parent.uuid : null,
			matrix: group.mesh ? mat4FromElements(group.mesh.matrixWorld.elements) : null
		}))
		.filter((g: { matrix: Mat4 | null }) => g.matrix)
	// weight-paint skinning sources: armature bones + their mesh vertices
	const ArmatureBone: AnyEl = (globalThis as any).ArmatureBone
	const bones: { boneUuid: string; boneName: string; weights: Record<string, number> }[] = []
	const skinMeshes: Record<string, Record<string, number[]>> = {}
	if (ArmatureBone?.all) {
		for (const bone of ArmatureBone.all) {
			if (!bone.vertex_weights) continue
			bones.push({ boneUuid: bone.uuid, boneName: bone.name, weights: { ...bone.vertex_weights } })
			const armature = bone.getArmature?.()
			const meshes = armature?.children?.filter((c: AnyEl) => c instanceof Mesh) || []
			for (const mesh of meshes) {
				const prefix = mesh.uuid.slice(0, 8)
				if (!skinMeshes[prefix] && mesh.vertices) {
					const verts: Record<string, number[]> = {}
					for (const [vkey, v] of Object.entries(mesh.vertices)) {
						const arr: AnyEl = v
						if (Array.isArray(arr)) verts[vkey] = [arr[0], arr[1], arr[2]]
						else if (arr && typeof arr.x === 'number') verts[vkey] = [arr.x, arr.y, arr.z]
					}
					skinMeshes[prefix] = verts
				}
			}
		}
	}
	return {
		elements,
		groups: groups as Snapshot['groups'],
		bones: bones.length ? bones : undefined,
		skinMeshes: Object.keys(skinMeshes).length ? skinMeshes : undefined
	}
}

// Rough center of mass for anchor defaults: average of element bbox centers (world, BB units)
export function estimateBodyCom(elementUuids: string[]): Vec3 {
	const Cube: AnyEl = (globalThis as any).Cube
	const Mesh: AnyEl = (globalThis as any).Mesh
	const centers: Vec3[] = []
	for (const el of Cube.all.concat(Mesh.all)) {
		if (!elementUuids.includes(el.uuid) || !el.mesh?.geometry) continue
		const arr: ArrayLike<number> = el.mesh.geometry.attributes.position.array
		const points: Vec3[] = []
		for (let i = 0; i < arr.length; i += 3) {
			points.push([arr[i], arr[i + 1], arr[i + 2]])
		}
		const { min, max } = bboxOfPoints(points)
		const m: ArrayLike<number> = el.mesh.matrixWorld.elements
		const cx = (min[0] + max[0]) / 2,
			cy = (min[1] + max[1]) / 2,
			cz = (min[2] + max[2]) / 2
		const w = m[3] * cx + m[7] * cy + m[11] * cz + m[15] || 1
		centers.push([
			(m[0] * cx + m[4] * cy + m[8] * cz + m[12]) / w,
			(m[1] * cx + m[5] * cy + m[9] * cz + m[13]) / w,
			(m[2] * cx + m[6] * cy + m[10] * cz + m[14]) / w
		])
	}
	if (!centers.length) return [0, 0, 0]
	return [
		centers.reduce((s, c) => s + c[0], 0) / centers.length,
		centers.reduce((s, c) => s + c[1], 0) / centers.length,
		centers.reduce((s, c) => s + c[2], 0) / centers.length
	]
}

export function getElementMesh(uuid: string): AnyEl {
	const Cube: AnyEl = (globalThis as any).Cube
	const Mesh: AnyEl = (globalThis as any).Mesh
	const el = Cube.all.find((c: AnyEl) => c.uuid === uuid) || Mesh.all.find((m: AnyEl) => m.uuid === uuid)
	return el?.mesh || null
}

export function matrixOfMesh(mesh: AnyEl): Mat4 {
	return mat4FromElements(mesh.matrixWorld.elements)
}

// Rough COM of a group (bone): average of descendant element bbox centers, world space
export function estimateGroupCom(group: AnyEl): Vec3 {
	const Cube: AnyEl = (globalThis as any).Cube
	const Mesh: AnyEl = (globalThis as any).Mesh
	const uuids: string[] = []
	// Group has no getAllChildren — forEachChild walks descendants (group.js:441)
	if (typeof group.forEachChild === 'function') {
		group.forEachChild((node: AnyEl) => {
			if (node instanceof Cube || node instanceof Mesh) uuids.push(node.uuid)
		})
	} else if (Array.isArray(group.children)) {
		const walk = (nodes: AnyEl[]) => {
			for (const node of nodes) {
				if (node instanceof Cube || node instanceof Mesh) uuids.push(node.uuid)
				if (Array.isArray(node.children)) walk(node.children)
			}
		}
		walk(group.children)
	}
	return estimateBodyCom(uuids)
}

export function scene(): AnyEl {
	return (globalThis as any).Canvas.scene
}

// Project a world point (BlockBench units) to the active preview's local pixel coordinates
export function projectPoint(world: Vec3): { x: number; y: number } | null {
	const preview = (globalThis as any).Preview?.selected
	if (!preview?.camera) return null
	const Canvas: AnyEl = (globalThis as any).Canvas
	const v = Canvas.scene.position.clone()
	v.set(world[0], world[1], world[2])
	v.project(preview.camera)
	if (v.z > 1) return null
	const w = preview.node?.clientWidth || 1
	const h = preview.node?.clientHeight || 1
	return { x: ((v.x + 1) / 2) * w, y: ((1 - v.y) / 2) * h }
}

// Unproject a viewport-local pixel onto the plane through planePoint facing the camera.
// Godot gizmo semantics: dragging moves the handle within the view-parallel plane at its original depth.
export function screenToWorld(px: number, py: number, planePoint: Vec3): Vec3 | null {
	const preview = (globalThis as any).Preview?.selected
	if (!preview?.camera) return null
	const cam = preview.camera
	const Canvas: AnyEl = (globalThis as any).Canvas
	const w = preview.node?.clientWidth || 1
	const h = preview.node?.clientHeight || 1
	const ndcX = (px / w) * 2 - 1
	const ndcY = -(py / h) * 2 + 1
	const tmp = Canvas.scene.position.clone()
	const near: AnyEl = tmp.clone().set(ndcX, ndcY, -1).unproject(cam)
	const origin: AnyEl = cam.position.clone()
	const dir: AnyEl = near.sub(origin).normalize()
	const normal: Vec3 = [0, 0, 0]
	cam.getWorldDirection(tmp.set(0, 0, 0))
	normal[0] = tmp.x
	normal[1] = tmp.y
	normal[2] = tmp.z
	const denom = normal[0] * dir.x + normal[1] * dir.y + normal[2] * dir.z
	if (Math.abs(denom) < 1e-9) return null
	const t =
		(normal[0] * (planePoint[0] - origin.x) +
			normal[1] * (planePoint[1] - origin.y) +
			normal[2] * (planePoint[2] - origin.z)) /
		denom
	if (!Number.isFinite(t)) return null
	return [origin.x + dir.x * t, origin.y + dir.y * t, origin.z + dir.z * t]
}

// Rough COM by outliner node uuid (group or element)
export function comByUuid(uuid: string): Vec3 | null {
	const Group: AnyEl = (globalThis as any).Group
	const group = Group.all.find((g: AnyEl) => g.uuid === uuid)
	if (group) return estimateGroupCom(group)
	const element = getElementMesh(uuid)
	if (element) return estimateBodyCom([uuid])
	return null
}

export function projectName(): string {
	return (globalThis as any).Project?.name || 'unnamed'
}

export function bodyDisplayName(uuid: string): string {
	const Group: AnyEl = (globalThis as any).Group
	const Cube: AnyEl = (globalThis as any).Cube
	const Mesh: AnyEl = (globalThis as any).Mesh
	const group = Group.all.find((g: AnyEl) => g.uuid === uuid)
	if (group) return group.name
	const el = Cube.all.find((c: AnyEl) => c.uuid === uuid) || Mesh.all.find((m: AnyEl) => m.uuid === uuid)
	return el ? el.name : uuid.slice(0, 8)
}

export function showMessage(message: string, timeout = 3000): void {
	;(globalThis as any).Blockbench.showQuickMessage(message, timeout)
}

export function onEvent(name: string, callback: (...args: any[]) => void): () => void {
	const Blockbench: AnyEl = (globalThis as any).Blockbench
	Blockbench.addListener(name, callback)
	return () => Blockbench.removeListener(name, callback)
}

export function dispatch(name: string, data?: any): void {
	;(globalThis as any).Blockbench.dispatchEvent(name, data)
}
