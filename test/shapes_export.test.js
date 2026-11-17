import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildBodyShape } from '../src/core/shapes.ts'
import { computeBodies, buildPhysicsFromSnapshot } from '../src/core/pipeline.ts'
import { exportAsset } from '../src/core/export.ts'
import { makeConstraint, sanitizeConstraint } from '../src/core/constraints.ts'
import { createStore } from '../src/core/store.ts'
import { mat4Compose, quatAxisAngle } from '../src/util/math.ts'

// helpers ----------------------------------------------------------------

function cubeVerts(x0, y0, z0, x1, y1, z1) {
	return [x0, y0, z0, x1, y0, z0, x1, y1, z0, x0, y1, z0, x0, y0, z1, x1, y0, z1, x1, y1, z1, x0, y1, z1]
}

function meshVerts() {
	// two triangles (a quad), 4 unique positions, non-indexed
	return [0, 0, 0, 8, 0, 0, 8, 8, 0, 0, 0, 0, 8, 8, 0, 0, 8, 0]
}

const PROPS = { shape: 'auto', density: 1000 }

// buildBodyShape ---------------------------------------------------------

test('cube auto → single centered Box (scaled to meters)', () => {
	// cube spans [-8, 8] on all axes → centered
	const { shape, skipped } = buildBodyShape(
		[
			{
				kind: 'cube',
				uuid: 'e1',
				localVerts: cubeVerts(-8, -8, -8, 8, 8, 8),
				indices: null,
				props: PROPS
			}
		],
		1 / 16
	)
	assert.equal(skipped.length, 0)
	assert.equal(shape.type, 'Box')
	assert.deepEqual(shape.halfExtents, [0.5, 0.5, 0.5])
	assert.equal(shape.density, 1000)
})

test('off-center cube gets wrapped in RotatedTranslated', () => {
	const { shape } = buildBodyShape(
		[
			{
				kind: 'cube',
				uuid: 'e1',
				localVerts: cubeVerts(0, 0, 0, 16, 16, 16),
				indices: null,
				props: PROPS
			}
		],
		1 / 16
	)
	assert.equal(shape.type, 'RotatedTranslated')
	assert.equal(shape.inner.type, 'Box')
	assert.deepEqual(shape.position, [0.5, 0.5, 0.5])
	assert.deepEqual(shape.rotation, [0, 0, 0, 1])
})

test('two cubes → StaticCompound with two children', () => {
	const { shape } = buildBodyShape(
		[
			{
				kind: 'cube',
				uuid: 'e1',
				localVerts: cubeVerts(-8, -8, -8, 8, 8, 8),
				indices: null,
				props: PROPS
			},
			{
				kind: 'cube',
				uuid: 'e2',
				localVerts: cubeVerts(16, -4, -4, 32, 4, 4),
				indices: null,
				props: PROPS
			}
		],
		1 / 16
	)
	assert.equal(shape.type, 'StaticCompound')
	assert.equal(shape.children.length, 2)
	assert.deepEqual(shape.children[1].position, [1.5, 0, 0])
})

test('capsule along X gets a non-identity axis rotation', () => {
	// long along X, thin in Y/Z
	const { shape } = buildBodyShape(
		[
			{
				kind: 'cube',
				uuid: 'e1',
				localVerts: cubeVerts(-16, -2, -2, 16, 2, 2),
				indices: null,
				props: { ...PROPS, shape: 'capsule' }
			}
		],
		1 / 16
	)
	const capsule = shape.inner || shape
	assert.equal(capsule.type, 'Capsule')
	const rotation = shape.rotation || [0, 0, 0, 1]
	assert.ok(Math.abs(rotation[2]) > 0.5, `expected Z rotation, got ${rotation}`)
})

test('sphere from cube', () => {
	const { shape } = buildBodyShape(
		[
			{
				kind: 'cube',
				uuid: 'e1',
				localVerts: cubeVerts(-4, -4, -4, 4, 4, 4),
				indices: null,
				props: { ...PROPS, shape: 'sphere' }
			}
		],
		1 / 16
	)
	assert.equal((shape.inner || shape).type, 'Sphere')
	assert.ok(Math.abs((shape.inner || shape).radius - Math.hypot(4, 4, 4) / 16) < 1e-9)
})

test('mesh auto → ConvexHull; explicit mesh → Mesh with welded vertices', () => {
	const hull = buildBodyShape(
		[{ kind: 'mesh', uuid: 'm1', localVerts: meshVerts(), indices: null, props: PROPS }],
		1 / 16
	)
	assert.equal((hull.shape.inner || hull.shape).type, 'ConvexHull')
	const pts = (hull.shape.inner || hull.shape).points
	assert.equal(pts.length, 4)

	const mesh = buildBodyShape(
		[
			{
				kind: 'mesh',
				uuid: 'm1',
				localVerts: meshVerts(),
				indices: [0, 1, 2, 3, 4, 5],
				props: { ...PROPS, shape: 'mesh' }
			}
		],
		1 / 16
	)
	const meshShape = mesh.shape.inner || mesh.shape
	assert.equal(meshShape.type, 'Mesh')
	assert.equal(meshShape.vertices.length, 4)
	assert.deepEqual(meshShape.triangles[0], [0, 1, 2])
})

test('shape none and degenerate are skipped', () => {
	const { shape, skipped } = buildBodyShape(
		[
			{
				kind: 'cube',
				uuid: 'e1',
				localVerts: cubeVerts(0, 0, 0, 16, 16, 16),
				indices: null,
				props: { ...PROPS, shape: 'none' }
			},
			{ kind: 'cube', uuid: 'e2', localVerts: [1, 1, 1], indices: null, props: PROPS }
		],
		1 / 16
	)
	assert.equal(shape, null)
	assert.equal(skipped.length, 2)
})

// computeBodies / pipeline ----------------------------------------------

function makeSnapshot() {
	return {
		elements: [
			{
				uuid: 'e1',
				name: 'cube1',
				kind: 'cube',
				groupUuid: 'g1',
				matrix: mat4Compose([0, 0, 0], [0, 0, 0, 1], [1, 1, 1]),
				verts: cubeVerts(0, 0, 0, 16, 16, 16),
				indices: null
			},
			{
				uuid: 'e2',
				name: 'cube2',
				kind: 'cube',
				groupUuid: null,
				matrix: mat4Compose([40, 0, 0], [0, 0, 0, 1], [1, 1, 1]),
				verts: cubeVerts(40, 0, 0, 48, 8, 8),
				indices: null
			}
		],
		groups: [
			{
				uuid: 'g1',
				name: 'bone1',
				parentUuid: null,
				matrix: mat4Compose([0, 10, 0], quatAxisAngle([0, 1, 0], Math.PI / 2), [1, 1, 1])
			}
		]
	}
}

test('computeBodies: top-level group + root element', () => {
	const bodies = computeBodies(makeSnapshot())
	assert.equal(bodies.length, 2)
	assert.equal(bodies[0].uuid, 'g1')
	assert.deepEqual(bodies[0].elementUuids, ['e1'])
	assert.equal(bodies[1].uuid, 'e2')
})

test('nested group elements roll up to the top-level group', () => {
	const snapshot = makeSnapshot()
	snapshot.groups.push({
		uuid: 'g2',
		name: 'child',
		parentUuid: 'g1',
		matrix: mat4Compose([0, 0, 0], [0, 0, 0, 1], [1, 1, 1])
	})
	snapshot.elements.push({
		uuid: 'e3',
		name: 'deep',
		kind: 'cube',
		groupUuid: 'g1',
		matrix: mat4Compose([0, 0, 0], [0, 0, 0, 1], [1, 1, 1]),
		verts: cubeVerts(0, 0, 0, 4, 4, 4),
		indices: null
	})
	const bodies = computeBodies(snapshot)
	const g1 = bodies.find(b => b.uuid === 'g1')
	assert.deepEqual(g1.elementUuids.sort(), ['e1', 'e3'])
})

test('pipeline produces meter-scale body descs', () => {
	const store = createStore()
	const { bodyDescs, groundY, scale } = buildPhysicsFromSnapshot(makeSnapshot(), store)
	assert.equal(scale, 1 / 16)
	assert.equal(bodyDescs.length, 2)
	const g1 = bodyDescs.find(b => b.uuid === 'g1')
	// group origin at [0,10,0] BB → meters [0, 0.625, 0]; scale of group baked away
	assert.ok(Math.abs(g1.position[1] - 10 / 16) < 1e-9)
	// single off-center element → wrapped shape tree rooted at Box
	assert.ok(g1.shape.type === 'RotatedTranslated' || g1.shape.type === 'StaticCompound')
	assert.equal((g1.shape.inner || g1.shape.children?.[0] || g1.shape).type, 'Box')
	assert.ok(groundY <= 0)
})

// export -----------------------------------------------------------------

test('exportAsset assembles bodies and converts constraint anchors', () => {
	const store = createStore()
	store.setBodyProps('g1', { motionType: 'Static' })
	const { bodyDescs, settings } = buildPhysicsFromSnapshot(makeSnapshot(), store)
	const constraint = makeConstraint('Hinge', 'g1', 'e2', { comA: [0, 10, 0], comB: [44, 4, 4] })
	constraint.limitsMin = -90
	constraint.limitsMax = 90
	const { asset, errors } = exportAsset({
		name: 'test',
		settings,
		bodies: bodyDescs,
		constraints: [constraint]
	})
	assert.equal(errors.length, 0)
	assert.equal(asset.format, 'behemiron-jolt-asset')
	assert.equal(asset.bodies.length, 2)
	assert.equal(asset.bodies[0].motionType, 'Static')
	assert.equal(asset.constraints.length, 1)
	const hinge = asset.constraints[0]
	assert.equal(hinge.type, 'Hinge')
	assert.equal(hinge.bodyA, 0)
	assert.equal(hinge.bodyB, 1)
	// anchors converted BB → m
	assert.ok(Math.abs(hinge.point1[1] - 10 / 16) < 1e-9)
	// limits converted degrees → radians
	assert.ok(Math.abs(hinge.limitsMin + Math.PI / 2) < 1e-9)
	assert.ok(Math.abs(hinge.limitsMax - Math.PI / 2) < 1e-9)
})

test('exportAsset errors on dangling constraint and shapeless body', () => {
	const store = createStore()
	const { bodyDescs, settings } = buildPhysicsFromSnapshot(makeSnapshot(), store)
	const bad = makeConstraint('Point', 'g1', 'ghost-body', { comA: [0, 0, 0], comB: [0, 0, 0] })
	const { errors } = exportAsset({ name: 't', settings, bodies: bodyDescs, constraints: [bad] })
	assert.ok(errors.some(e => e.includes('ghost-body')))
	const { errors: errors2 } = exportAsset({
		name: 't',
		settings,
		bodies: [
			{
				uuid: 'x',
				name: 'empty',
				position: [0, 0, 0],
				rotation: [0, 0, 0, 1],
				props: store.getBodyProps('x'),
				shape: null
			}
		],
		constraints: []
	})
	assert.ok(errors2.some(e => e.includes('empty')))
})

test('sanitizeConstraint repairs bad values', () => {
	const c = sanitizeConstraint({
		type: 'Cone',
		bodyA: 'a',
		bodyB: 'b',
		halfConeAngle: 999,
		twistAxis1: 'bad'
	})
	assert.equal(c.halfConeAngle, 180)
	assert.deepEqual(c.twistAxis1, [0, 1, 0])
	assert.equal(sanitizeConstraint({ type: 'Nope', bodyA: 'a', bodyB: 'b' }), null)
})
