// Soft body skinning: map soft-body tet vertices to Blockbench armature bone weights.
// BB's weight paint stores per-bone `vertex_weights` ("meshUuidPrefix:vkey" → weight); we locate
// each welded cube corner to the nearest source mesh vertex (positional weld) and transfer weights.
// Contract: normalized weights per soft vertex; engine pins/drives as it sees fit
// (plugin simulation pins verts with a single bone at weight ≥ 0.999 via mInvMass = 0).

import type { Vec3 } from '../util/math.ts'

export interface SkinBoneSource {
	boneUuid: string
	boneName: string
	/** "meshUuidPrefix:vkey" → weight (0..1) */
	weights: Record<string, number>
}

export interface SkinMeshSource {
	meshUuidPrefix: string
	/** vertex key → body-local position (BlockBench units) */
	vertices: Record<string, Vec3>
}

export interface SkinBinding {
	boneUuid: string
	boneName: string
	/** per soft vertex, normalized to sum 1 (0 when unbound) */
	weights: number[]
}

const MATCH_EPS_BB = 1e-3

export function buildSkinWeights(
	softVertices: Vec3[],
	meshes: SkinMeshSource[],
	bones: SkinBoneSource[],
	unitsPerMeter: number
): { bindings: SkinBinding[]; pinned: number[] } {
	// index mesh vertices by rounded position for O(1) nearest lookup (exact-corner weld)
	const byPos = new Map<string, { vkey: string; meshPrefix: string }[]>()
	for (const mesh of meshes) {
		for (const [vkey, pos] of Object.entries(mesh.vertices)) {
			const key = `${Math.round(pos[0] / MATCH_EPS_BB)}:${Math.round(pos[1] / MATCH_EPS_BB)}:${Math.round(pos[2] / MATCH_EPS_BB)}`
			const list = byPos.get(key) || []
			list.push({ vkey, meshPrefix: mesh.meshUuidPrefix })
			byPos.set(key, list)
		}
	}

	const raw: { boneUuid: string; boneName: string; values: number[] }[] = bones.map(b => ({
		boneUuid: b.boneUuid,
		boneName: b.boneName,
		values: new Array<number>(softVertices.length).fill(0)
	}))
	const pinned: number[] = []

	softVertices.forEach((sv, si) => {
		const bb = [sv[0] * unitsPerMeter, sv[1] * unitsPerMeter, sv[2] * unitsPerMeter]
		const key = `${Math.round(bb[0] / MATCH_EPS_BB)}:${Math.round(bb[1] / MATCH_EPS_BB)}:${Math.round(bb[2] / MATCH_EPS_BB)}`
		const candidates = byPos.get(key)
		if (!candidates) return
		let total = 0
		const hits: { bone: (typeof raw)[0]; w: number }[] = []
		for (const { vkey, meshPrefix } of candidates) {
			for (const bone of raw) {
				const source = bones.find(b => b.boneUuid === bone.boneUuid)!
				const w = source.weights[`${meshPrefix}:${vkey}`]
				if (typeof w === 'number' && w > 0) {
					bone.values[si] += w
					total += w
					hits.push({ bone, w })
				}
			}
		}
		if (total > 0) {
			for (const bone of raw) bone.values[si] /= total
			// pin when, after normalization, exactly one bone holds the vertex (FORMAT §5.5 rule)
			const holders = raw.filter(b => (b.values[si] ?? 0) >= 0.999)
			if (holders.length === 1) pinned.push(si)
		}
	})

	return {
		bindings: raw
			.filter(b => b.values.some(v => v > 0))
			.map(b => ({ boneUuid: b.boneUuid, boneName: b.boneName, weights: b.values })),
		pinned
	}
}
