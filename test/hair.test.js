import { test } from 'node:test'
import assert from 'node:assert/strict'
import { generateHairStrands } from '../src/core/hair.ts'

test('strand generation is deterministic and correctly shaped', () => {
	const params = {
		strandCount: 8,
		segmentsPerStrand: 4,
		strandLength: 0.4,
		rootRadius: 0.2,
		rootInvMass: 0
	}
	const a = generateHairStrands(params)
	const b = generateHairStrands(params)
	assert.deepEqual(a, b)
	assert.equal(a.strands.length, 8)
	assert.equal(a.vertices.length / 3, 8 * 5)
	assert.equal(a.invMass[0], 0, 'root pinned by default')
	assert.equal(a.invMass[1], 1)
	// consecutive strand ranges
	assert.equal(a.strands[1][0], a.strands[0][1])
})

test('root vertices lie on the root ring and strands hang down', () => {
	const g = generateHairStrands({
		strandCount: 4,
		segmentsPerStrand: 2,
		strandLength: 0.3,
		rootRadius: 0.1,
		rootInvMass: 0
	})
	for (const [start] of g.strands) {
		const x = g.vertices[start * 3],
			y = g.vertices[start * 3 + 1],
			z = g.vertices[start * 3 + 2]
		assert.ok(y === 0, 'root at y=0')
		assert.ok(Math.hypot(x, z) <= 0.1 + 1e-9, 'root within ring')
	}
	// last vertex of first strand at full length
	const [, end] = g.strands[0]
	assert.ok(Math.abs(g.vertices[(end - 1) * 3 + 1] + 0.3) < 1e-9, 'tip at -strandLength')
})
