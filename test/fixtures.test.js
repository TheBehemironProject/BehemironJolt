// Fixtures are engine-contractual: they must equal what the code generates today.
// Regenerate with `node scripts/export_fixtures.mjs` after an intentional change.

import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const SCALE = 1 / 16
const anchorA = [16, 32, 16]
const anchorB = [48, 32, 16]

async function generated() {
	const { generateHairStrands } = await import(pathToFileURL(join(root, 'src/core/hair.ts')))
	const { buildSoftBodyMesh } = await import(pathToFileURL(join(root, 'src/core/softbody.ts')))
	const { buildBodyShape } = await import(pathToFileURL(join(root, 'src/core/shapes.ts')))
	const { makeConstraint, constraintToExport, CONSTRAINT_TYPE_NAMES } = await import(
		pathToFileURL(join(root, 'src/core/constraints.ts'))
	)
	const { collisionPairs } = await import(pathToFileURL(join(root, 'src/core/collide.ts')))
	const refConstraint = type => {
		const c = makeConstraint(type, 'bodyA', 'bodyB', { comA: anchorA, comB: anchorB })
		c.id = `ref-${type}`
		return c
	}

	const cubeVerts = [-8, -8, -8, 8, -8, -8, -8, 8, -8, 8, 8, -8, -8, -8, 8, 8, -8, 8, -8, 8, 8, 8, 8, 8]
	const offsetCubeVerts = cubeVerts.map((v, i) => v + (i % 3 === 0 ? 32 : 0))

	return {
		hair_strands: {
			note: 'Engine contract: identical strands from identical params (golden-angle roots).',
			sets: [
				{
					params: {
						strandCount: 4,
						segmentsPerStrand: 2,
						strandLength: 0.4,
						rootRadius: 0.15,
						rootInvMass: 0
					},
					result: generateHairStrands({
						strandCount: 4,
						segmentsPerStrand: 2,
						strandLength: 0.4,
						rootRadius: 0.15,
						rootInvMass: 0
					})
				},
				{
					params: {
						strandCount: 3,
						segmentsPerStrand: 3,
						strandLength: 0.25,
						rootRadius: 0.1,
						rootInvMass: 0.5
					},
					result: generateHairStrands({
						strandCount: 3,
						segmentsPerStrand: 3,
						strandLength: 0.25,
						rootRadius: 0.1,
						rootInvMass: 0.5
					})
				}
			]
		},
		softbody_tets: {
			note: '5-tet decomposition per cube, corners welded across cubes (eps 1e-4).',
			result: buildSoftBodyMesh([
				{ min: [0, 0, 0], max: [1, 1, 1] },
				{ min: [1, 0, 0], max: [2, 1, 1] }
			])
		},
		shapes_auto: {
			note: 'buildBodyShape outputs at default scale (1/16); single centered box and two-cube compound.',
			singleBox: buildBodyShape(
				[
					{
						kind: 'cube',
						uuid: 'e1',
						localVerts: cubeVerts,
						indices: null,
						props: { shape: 'auto', density: 1000 }
					}
				],
				SCALE
			),
			twoCubes: buildBodyShape(
				[
					{
						kind: 'cube',
						uuid: 'e1',
						localVerts: cubeVerts,
						indices: null,
						props: { shape: 'box', density: 1000 }
					},
					{
						kind: 'cube',
						uuid: 'e2',
						localVerts: offsetCubeVerts,
						indices: null,
						props: { shape: 'box', density: 1000 }
					}
				],
				SCALE
			)
		},
		constraints_export: {
			note: 'makeConstraint (storage, BB units/deg) then constraintToExport (meters/radians) at scale 1/16.',
			types: CONSTRAINT_TYPE_NAMES.map(type => ({
				type,
				storage: refConstraint(type),
				export: constraintToExport(
					makeConstraint(type, 'bodyA', 'bodyB', { comA: [16, 32, 16], comB: [48, 32, 16] }),
					SCALE
				)
			}))
		},
		collision_matrix: {
			note: 'collidePairProps: same non-zero group never collides (wins over selfCollide); else selfCollide OR.',
			bodies: [
				{ name: 'A_default', collisionGroup: 0, selfCollide: false },
				{ name: 'B_default', collisionGroup: 0, selfCollide: false },
				{ name: 'C_self', collisionGroup: 0, selfCollide: true },
				{ name: 'D_group1', collisionGroup: 1, selfCollide: false },
				{ name: 'E_group1_self', collisionGroup: 1, selfCollide: true },
				{ name: 'F_group2', collisionGroup: 2, selfCollide: false }
			],
			get matrix() {
				return collisionPairs(this.bodies)
			}
		}
	}
}

test('fixtures match generator output', async () => {
	const gen = await generated()
	for (const name of Object.keys(gen)) {
		const checkedIn = JSON.parse(readFileSync(join(root, 'fixtures', `${name}.json`), 'utf8'))
		// JSON-string comparison: value-level equality that treats -0 == 0 (JSON round-trip
		// normalizes -0, live objects can carry it from formulas like -(length*0)).
		assert.equal(
			JSON.stringify(checkedIn),
			JSON.stringify(gen[name]),
			`fixture ${name}.json stale — run scripts/export_fixtures.mjs`
		)
	}
})
