// Soft body voxel tetrahedralization (pure). Decision (recorded in LEDGER B5-1):
// 体素填充法 — each cube → 5-tet standard decomposition; corners welded across cubes (eps 1e-4)
// so shared faces merge automatically. Surface faces (cube faces owned by exactly one cube) are
// emitted for collision/rendering; interior structure never produces duplicate edges.
// Degenerate (near-zero-volume) tets are kept but flagged so callers can skip Volume constraints
// (cloth-like configurations).

import type { Vec3 } from '../util/math.ts'

const WELD_EPS = 1e-4

export interface SoftBodyCube {
	min: Vec3
	max: Vec3
}

export interface SoftBodyMesh {
	vertices: Vec3[]
	tetrahedra: number[][]
	/** |signed rest volume| per tet (caller decides volume-constraint policy) */
	tetVolumes: number[]
	/** surface triangles (vertex indices), wound consistently outward */
	faces: number[][]
	/** unique undirected edges */
	edges: [number, number][]
	/** tet indices with |rest volume| < 1e-12 (unreachable for valid input; kept for contract completeness) */
	degenerateTets: number[]
}

// cube corner offsets in the 5-tet scheme: corners = (x,y,z) bit order
const CORNERS: Vec3[] = [
	[0, 0, 0],
	[1, 0, 0],
	[1, 1, 0],
	[0, 1, 0],
	[0, 0, 1],
	[1, 0, 1],
	[1, 1, 1],
	[0, 1, 1]
]

// standard 5-tet decomposition of a cube
const TETS = [
	[0, 1, 3, 4],
	[1, 2, 3, 6],
	[1, 3, 4, 6],
	[1, 4, 5, 6],
	[3, 4, 6, 7]
]

// cube faces as corner quads ( outward winding )
const FACES = [
	[0, 3, 2, 1], // -z? back
	[4, 5, 6, 7], // +z front
	[0, 1, 5, 4], // -y bottom
	[3, 7, 6, 2], // +y top
	[0, 4, 7, 3], // -x left
	[1, 2, 6, 5] // +x right
]

export function buildSoftBodyMesh(cubes: SoftBodyCube[], weld: number = WELD_EPS): SoftBodyMesh {
	const keyOf = (p: Vec3) =>
		`${Math.round(p[0] / weld)}:${Math.round(p[1] / weld)}:${Math.round(p[2] / weld)}`
	const vertices: Vec3[] = []
	const remap = new Map<string, number>()
	const vertIndex = (p: Vec3): number => {
		const key = keyOf(p)
		let idx = remap.get(key)
		if (idx === undefined) {
			idx = vertices.length
			remap.set(key, idx)
			vertices.push(p)
		}
		return idx
	}
	const tetrahedra: number[][] = []
	const tetVolumes: number[] = []
	const faceMap = new Map<string, { quad: number[]; count: number }>()
	const edgeSet = new Map<string, [number, number]>()
	const degenerateTets: number[] = []

	for (const cube of cubes) {
		const size: Vec3 = [cube.max[0] - cube.min[0], cube.max[1] - cube.min[1], cube.max[2] - cube.min[2]]
		if (size.some(s => s <= 0)) continue
		const corners = CORNERS.map(
			c =>
				[
					cube.min[0] + c[0] * size[0],
					cube.min[1] + c[1] * size[1],
					cube.min[2] + c[2] * size[2]
				] as Vec3
		)
		const ids = corners.map(vertIndex)
		for (const tet of TETS) {
			const a = ids[tet[0]],
				b = ids[tet[1]],
				c = ids[tet[2]],
				d = ids[tet[3]]
			tetrahedra.push([a, b, c, d])
			const vi = (i: number) => vertices[i]
			const vol = Math.abs(signedTetVolume(vi(a), vi(b), vi(c), vi(d)))
			tetVolumes.push(vol)
			if (vol < 1e-12) degenerateTets.push(tetrahedra.length - 1)
			const pushEdge = (p: number, q: number) => {
				const key = p < q ? `${p}:${q}` : `${q}:${p}`
				if (!edgeSet.has(key)) edgeSet.set(key, [Math.min(p, q), Math.max(p, q)])
			}
			pushEdge(a, b)
			pushEdge(a, c)
			pushEdge(a, d)
			pushEdge(b, c)
			pushEdge(b, d)
			pushEdge(c, d)
		}
		// face ownership for surface detection
		for (const quad of FACES) {
			const q = [ids[quad[0]], ids[quad[1]], ids[quad[2]], ids[quad[3]]]
			const key = [...q].sort((x, y) => x - y).join(':')
			const existing = faceMap.get(key)
			if (existing) existing.count++
			else faceMap.set(key, { quad: q, count: 1 })
		}
	}

	const faces: number[][] = []
	for (const { quad, count } of faceMap.values()) {
		if (count !== 1) continue
		faces.push([quad[0], quad[1], quad[2]])
		faces.push([quad[0], quad[2], quad[3]])
	}

	return { vertices, tetrahedra, tetVolumes, faces, edges: [...edgeSet.values()], degenerateTets }
}

function signedTetVolume(a: Vec3, b: Vec3, c: Vec3, d: Vec3): number {
	const ab = [b[0] - a[0], b[1] - a[1], b[2] - a[2]]
	const ac = [c[0] - a[0], c[1] - a[1], c[2] - a[2]]
	const ad = [d[0] - a[0], d[1] - a[1], d[2] - a[2]]
	return (
		(ab[0] * (ac[1] * ad[2] - ac[2] * ad[1]) -
			ab[1] * (ac[0] * ad[2] - ac[2] * ad[0]) +
			ab[2] * (ac[0] * ad[1] - ac[1] * ad[0])) /
		6
	)
}
