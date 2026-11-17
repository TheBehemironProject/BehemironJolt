// Procedural hair strand generation (pure, deterministic). The formula is part of the engine
// contract (docs/FORMAT.md): plugin and engine MUST generate identical strands from the same params.
// Strands hang from a ring of roots on the XZ plane (body-local, meters, +Y up), straight down -Y.

export interface HairStrandParams {
	strandCount: number
	segmentsPerStrand: number
	strandLength: number
	rootRadius: number
	rootInvMass: number
}

export interface HairStrands {
	/** flattened xyz per vertex (strand-major) */
	vertices: number[]
	invMass: number[]
	/** [startVertex, endVertex) per strand, consecutive */
	strands: [number, number][]
}

export function generateHairStrands(p: HairStrandParams): HairStrands {
	const count = Math.max(1, Math.min(4096, Math.round(p.strandCount)))
	const segments = Math.max(2, Math.min(64, Math.round(p.segmentsPerStrand)))
	const length = Math.max(0.01, p.strandLength)
	const radius = Math.max(0, p.rootRadius)
	const vertices: number[] = []
	const invMasses: number[] = []
	const strands: [number, number][] = []
	for (let s = 0; s < count; s++) {
		// golden-angle spiral for even root distribution (deterministic)
		const t = s / count
		const angle = s * 2.39996322972865332 // golden angle in radians
		const r = radius * Math.sqrt(t)
		const x = r * Math.cos(angle)
		const z = r * Math.sin(angle)
		const start = vertices.length / 3
		for (let i = 0; i <= segments; i++) {
			vertices.push(x, -(length * i) / segments, z)
			invMasses.push(i === 0 ? p.rootInvMass : 1)
		}
		strands.push([start, start + segments + 1])
	}
	return { vertices, invMass: invMasses, strands }
}
