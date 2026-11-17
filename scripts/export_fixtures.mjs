// Generates fixtures/*.json — engine-contractual reference vectors.
// Run: node scripts/export_fixtures.mjs   (test/fixtures.test.js keeps them honest)

import { mkdirSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outDir = join(root, 'fixtures')
mkdirSync(outDir, { recursive: true })

const { generateHairStrands } = await import(pathToFileURL(join(root, 'src/core/hair.ts')))
const { buildSoftBodyMesh } = await import(pathToFileURL(join(root, 'src/core/softbody.ts')))
const { buildBodyShape } = await import(pathToFileURL(join(root, 'src/core/shapes.ts')))
const { makeConstraint, constraintToExport, CONSTRAINT_TYPE_NAMES } = await import(
	pathToFileURL(join(root, 'src/core/constraints.ts'))
)

function refConstraint(type) {
	const c = makeConstraint(type, 'bodyA', 'bodyB', { comA: anchorA, comB: anchorB })
	c.id = `ref-${type}`
	return c
}

const SCALE = 1 / 16 // default unitsPerMeter

function write(name, data) {
	writeFileSync(join(outDir, name), JSON.stringify(data, null, 2) + '\n')
	console.log('fixture', name)
}

// ---- hair strands: two parameter sets, full deterministic output ----
write('hair_strands.json', {
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
})

// ---- soft body: two welded cubes -> tets/faces/edges ----
write('softbody_tets.json', {
	note: '5-tet decomposition per cube, corners welded across cubes (eps 1e-4).',
	result: buildSoftBodyMesh([
		{ min: [0, 0, 0], max: [1, 1, 1] },
		{ min: [1, 0, 0], max: [2, 1, 1] }
	])
})

// ---- shapes: auto inference + aggregation ----
const cubeVerts = [
	// 8 corners of a 16-unit cube centered at origin
	-8, -8, -8, 8, -8, -8, -8, 8, -8, 8, 8, -8, -8, -8, 8, 8, -8, 8, -8, 8, 8, 8, 8, 8
]
const offsetCubeVerts = cubeVerts.map((v, i) => v + (i % 3 === 0 ? 32 : 0)) // shifted along X
write('shapes_auto.json', {
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
})

// ---- constraints: one minimal instance per type, storage + export form ----
const anchorA = [16, 32, 16]
const anchorB = [48, 32, 16]
write('constraints_export.json', {
	note: 'makeConstraint (storage, BB units/deg) then constraintToExport (meters/radians) at scale 1/16.',
	types: CONSTRAINT_TYPE_NAMES.map(type => ({
		type,
		storage: refConstraint(type),
		export: constraintToExport(
			makeConstraint(type, 'bodyA', 'bodyB', { comA: anchorA, comB: anchorB }),
			SCALE
		)
	}))
})
