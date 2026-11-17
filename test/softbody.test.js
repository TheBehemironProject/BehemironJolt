import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSoftBodyMesh } from '../src/core/softbody.ts'

const cube = (x, y, z, s = 1) => ({ min: [x, y, z], max: [x + s, y + s, z + s] })

test('single cube → 8 vertices, 5 tets, 12 surface triangles, 18 unique edges', () => {
	const mesh = buildSoftBodyMesh([cube(0, 0, 0)])
	assert.equal(mesh.vertices.length, 8)
	assert.equal(mesh.tetrahedra.length, 5)
	assert.equal(mesh.faces.length, 12)
	assert.equal(mesh.edges.length, 18)
	assert.equal(mesh.degenerateTets.length, 0)
})

test('volume is preserved (sum of tet volumes = cube volume)', () => {
	const mesh = buildSoftBodyMesh([cube(0, 0, 0, 2)])
	let vol = 0
	for (const [a, b, c, d] of mesh.tetrahedra) {
		const v = mesh.vertices
		const ab = v[b].map((n, i) => n - v[a][i])
		const ac = v[c].map((n, i) => n - v[a][i])
		const ad = v[d].map((n, i) => n - v[a][i])
		vol +=
			Math.abs(
				ab[0] * (ac[1] * ad[2] - ac[2] * ad[1]) -
					ab[1] * (ac[0] * ad[2] - ac[2] * ad[0]) +
					ab[2] * (ac[0] * ad[1] - ac[1] * ad[0])
			) / 6
	}
	assert.ok(Math.abs(vol - 8) < 1e-9, `expected volume 8, got ${vol}`)
})

test('adjacent cubes weld shared corners: 12 verts, 10 tets, 10 surface quads (20 tris), no duplicate edges', () => {
	const mesh = buildSoftBodyMesh([cube(0, 0, 0), cube(1, 0, 0)])
	assert.equal(mesh.vertices.length, 12, '4 shared corners welded')
	assert.equal(mesh.tetrahedra.length, 10)
	assert.equal(mesh.faces.length, 20, '10 surface quads (12 faces − 2 internal) × 2 tris')
	const keys = new Set(mesh.edges.map(([a, b]) => `${a}:${b}`))
	assert.equal(keys.size, mesh.edges.length, 'edges unique')
})

test('flat (cloth-like) cube exposes tiny tet volumes so callers can skip volume constraints', () => {
	const flat = { min: [0, 0, 0], max: [1, 1, 0.01] }
	const mesh = buildSoftBodyMesh([flat])
	assert.equal(mesh.degenerateTets.length, 0)
	const total = mesh.tetVolumes.reduce((s, v) => s + v, 0)
	assert.ok(Math.abs(total - 0.01) < 1e-9, 'thin volume preserved for edge/bend constraints')
	assert.ok(Math.max(...mesh.tetVolumes) < 1e-2, 'per-tet volume small → caller skips Volume constraints')
})

test('invalid cubes are skipped', () => {
	const mesh = buildSoftBodyMesh([cube(0, 0, 0), { min: [5, 5, 5], max: [5, 6, 5] }])
	assert.equal(mesh.vertices.length, 8)
	assert.equal(mesh.tetrahedra.length, 5)
})

test('soft body controller params sanitize with defaults and bendType enum', async () => {
	const { sanitizeControllerParams, controllerDefaults } = await import('../src/core/controllers.ts')
	const defs = controllerDefaults('softbody')
	assert.equal(defs.bendType, 'Distance')
	assert.equal(defs.useVolumeConstraints, true)
	const clean = sanitizeControllerParams('softbody', {
		bendType: 'Bogus',
		edgeCompliance: -5,
		vertexMass: 0.2
	})
	assert.equal(clean.bendType, 'Distance')
	assert.equal(clean.edgeCompliance, 0, 'clamped to min')
	assert.equal(clean.vertexMass, 0.2)
})
