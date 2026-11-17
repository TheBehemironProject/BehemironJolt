// Ghost rendering: clones of the preview meshes driven by physics transforms.
// Originals are hidden, never modified; restore() brings everything back.
// Uses only instance methods (no global THREE): matrices via our math, clones via mesh.clone().
// Clones get their own slightly transparent material copy so the simulation read is visually
// distinct from the authored model (and the copies are disposed on restore — no GPU leak).

import { mat4Multiply, type Mat4 } from '../util/math.ts'

/** A THREE.Material (typed loosely: we only clone it and tweak transparency) */
export interface GhostMaterialLike {
	transparent: boolean
	opacity: number
	clone(): GhostMaterialLike
	dispose(): void
}

/** A THREE.Mesh from the Blockbench preview (typed loosely: we only use clone/visibility/matrix) */
export interface GhostMeshLike {
	clone(): GhostMeshLike
	visible: boolean
	material: GhostMaterialLike | GhostMaterialLike[]
	matrix: {
		elements: ArrayLike<number>
		fromArray(arr: number[]): unknown
	}
	matrixWorld: {
		elements: ArrayLike<number>
		fromArray(arr: number[]): unknown
	}
	matrixAutoUpdate: boolean
	matrixWorldNeedsUpdate: boolean
}

export interface GhostItem {
	mesh: GhostMeshLike
	offset: Mat4
}

export interface GhostBody {
	bodyIndex: number
	bodyMatrix: Mat4
	items: GhostItem[]
}

interface GhostScene {
	add(obj: GhostMeshLike): void
	remove(obj: GhostMeshLike): void
}

interface GhostEntry {
	clone: GhostMeshLike
	bodyIndex: number
	offset: Mat4
}

const GHOST_OPACITY = 0.85

function ghostify(material: GhostMaterialLike): GhostMaterialLike {
	const copy = material.clone()
	copy.transparent = true
	copy.opacity = Math.min(copy.opacity ?? 1, GHOST_OPACITY)
	return copy
}

export class GhostView {
	private scene: GhostScene
	private clones: GhostEntry[] = []
	private hidden: GhostMeshLike[] = []
	private materials: GhostMaterialLike[] = []

	constructor(scene: GhostScene) {
		this.scene = scene
	}

	// bodyVis: [{bodyIndex, bodyMatrix, items: [{mesh, offset}]}]
	build(bodyVis: GhostBody[]): void {
		for (const body of bodyVis) {
			for (const item of body.items) {
				const clone = item.mesh.clone()
				clone.matrixAutoUpdate = false
				clone.matrix.fromArray(mat4Multiply(body.bodyMatrix, item.offset))
				clone.matrixWorld.fromArray(Array.from(clone.matrix.elements))
				clone.matrixWorldNeedsUpdate = true
				clone.visible = true
				const source = item.mesh.material
				if (Array.isArray(source)) {
					clone.material = source.map(ghostify)
					this.materials.push(...(clone.material as GhostMaterialLike[]))
				} else if (source) {
					clone.material = ghostify(source)
					this.materials.push(clone.material as GhostMaterialLike)
				}
				this.scene.add(clone)
				this.clones.push({ clone, bodyIndex: body.bodyIndex, offset: item.offset })
				if (item.mesh.visible) {
					item.mesh.visible = false
					this.hidden.push(item.mesh)
				}
			}
		}
	}

	// worldMatrix: body world transform in BlockBench units
	updateBody(bodyIndex: number, worldMatrix: Mat4): void {
		for (const entry of this.clones) {
			if (entry.bodyIndex !== bodyIndex) continue
			entry.clone.matrix.fromArray(mat4Multiply(worldMatrix, entry.offset))
			entry.clone.matrixWorldNeedsUpdate = true
		}
	}

	restore(): void {
		for (const entry of this.clones) {
			this.scene.remove(entry.clone)
		}
		this.clones = []
		for (const material of this.materials) {
			material.dispose()
		}
		this.materials = []
		for (const mesh of this.hidden) {
			mesh.visible = true
		}
		this.hidden = []
	}
}
