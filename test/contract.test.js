import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
	CONSTRAINT_TYPE_NAMES,
	makeConstraint,
	sanitizeConstraint,
	constraintToExport
} from '../src/core/constraints.ts'

const UPM = 16
const SCALE = 1 / UPM

test('all 12 constraint types are defined and constructible', () => {
	assert.equal(CONSTRAINT_TYPE_NAMES.length, 12)
	for (const type of CONSTRAINT_TYPE_NAMES) {
		const c = makeConstraint(type, 'bodyA', 'bodyB', { comA: [1, 2, 3], comB: [4, 6, 8] })
		assert.equal(c.type, type)
		const clean = sanitizeConstraint(c)
		assert.ok(clean, `sanitize failed for ${type}`)
	}
})

test('anchor defaults come from body centers', () => {
	const c = makeConstraint('Hinge', 'a', 'b', { comA: [1, 2, 3], comB: [4, 6, 8] })
	assert.deepEqual(c.point1, [1, 2, 3])
	assert.deepEqual(c.point2, [4, 6, 8])
	const p = makeConstraint('Pulley', 'a', 'b', { comA: [0, 0, 0], comB: [10, 0, 0] })
	assert.deepEqual(p.bodyPoint1, [0, 0, 0])
	assert.deepEqual(p.bodyPoint2, [10, 0, 0])
	assert.deepEqual(p.fixedPoint1, [0, 8, 0])
})

test('Pulley contract: points scaled to meters, null maxLength preserved, ratio untouched', () => {
	const c = makeConstraint('Pulley', 'a', 'b', { comA: [0, 16, 0], comB: [32, 16, 0] })
	c.maxLength = null
	c.ratio = 2
	const out = constraintToExport(c, SCALE)
	assert.equal(out.type, 'Pulley')
	assert.equal(out.space, 'WorldSpace')
	assert.ok(Math.abs(out.bodyPoint2[0] - 2) < 1e-12)
	assert.equal(out.maxLength, null)
	assert.equal(out.ratio, 2)
})

test('Gear and RackAndPinion have no anchors, axes unscaled', () => {
	const g = constraintToExport(makeConstraint('Gear', 'a', 'b', {}), SCALE)
	assert.equal(g.space, 'WorldSpace')
	assert.deepEqual(g.hingeAxis1, [0, 1, 0])
	assert.equal(g.ratio, 1)
	const r = constraintToExport(makeConstraint('RackAndPinion', 'a', 'b', {}), SCALE)
	assert.deepEqual(r.sliderAxis, [1, 0, 0])
	assert.equal(r.ratio, 0.05)
})

test('Path contract: no space field, quat passthrough, points scaled', () => {
	const c = makeConstraint('Path', 'a', 'b', { comA: [0, 0, 0], comB: [0, 16, 0] })
	c.pathRotation = [0, 0.7071, 0, 0.7071]
	const out = constraintToExport(c, SCALE)
	assert.equal(out.space, undefined)
	assert.equal(out.rotationConstraintType, 'Free')
	assert.deepEqual(out.pathRotation, [0, 0.7071, 0, 0.7071])
	assert.equal(out.pathPoints.length, 2)
	assert.ok(Math.abs(out.pathPoints[1][1] - 1) < 1e-9)
})

test('Distance maxDistance defaults to center distance and converts to meters', () => {
	const c = makeConstraint('Distance', 'a', 'b', { comA: [0, 0, 0], comB: [30, 40, 0] })
	assert.ok(Math.abs(c.maxDistance - 50) < 1e-9)
	const out = constraintToExport(c, SCALE)
	assert.ok(Math.abs(out.maxDistance - 50 / 16) < 1e-9)
	assert.equal(out.minDistance, 0)
})

test('SixDOF vec6: first three axes scaled as meters, last three as radians', () => {
	const c = makeConstraint('SixDOF', 'a', 'b', {})
	c.limitMin = [-16, null, -8, -90, null, null]
	c.limitMax = [16, null, 8, 90, null, null]
	const out = constraintToExport(c, SCALE)
	assert.deepEqual(out.limitMin.slice(0, 3), [-1, null, -0.5])
	assert.ok(Math.abs(out.limitMin[3] + Math.PI / 2) < 1e-9)
	assert.ok(Math.abs(out.limitMax[3] - Math.PI / 2) < 1e-9)
})

test('sanitizeConstraint drops malformed path points and repairs fields', () => {
	const c = sanitizeConstraint({
		type: 'Path',
		bodyA: 'a',
		bodyB: 'b',
		pathPoints: [[0, 0, 0], [1, 2], 'bad', [16, 16, 16]],
		pathRotation: [0, 0, 0],
		rotationConstraintType: 'Bogus'
	})
	assert.equal(c.pathPoints.length, 2)
	assert.deepEqual(c.pathRotation, [0, 0, 0, 1])
	assert.equal(c.rotationConstraintType, 'Free')
})

test('Hinge limits: degrees in storage, radians in contract, null preserved', () => {
	const c = makeConstraint('Hinge', 'a', 'b', {})
	c.limitsMin = -45
	c.limitsMax = null
	const out = constraintToExport(c, SCALE)
	assert.ok(Math.abs(out.limitsMin + Math.PI / 4) < 1e-9)
	assert.equal(out.limitsMax, null)
})
