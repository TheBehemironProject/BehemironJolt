// Ghost rendering: clones of the preview meshes driven by physics transforms.
// Originals are hidden, never modified; restore() brings everything back.
// Uses only instance methods (no global THREE): matrices via our math, clones via mesh.clone().

import { mat4Multiply, type Mat4 } from '../util/math.ts'

/** A THREE.Mesh from the Blockbench preview (typed loosely: we only use clone/visibility/matrix) */
export interface GhostMeshLike {
	clone(): GhostMeshLike
	visible: boolean
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

export class GhostView {
	private scene: GhostScene
	private clones: GhostEntry[] = []
	private hidden: GhostMeshLike[] = []

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
		for (const mesh of this.hidden) {
			mesh.visible = true
		}
		this.hidden = []
	}
}
