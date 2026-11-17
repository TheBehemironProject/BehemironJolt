import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
	makeConstraint,
	sanitizeConstraint,
	buildConstraintHandles,
	moveConstraintHandle
} from '../src/core/constraints.ts'

test('Hinge has two draggable anchors at default body centers', () => {
	const c = makeConstraint('Hinge', 'a', 'b', { comA: [1, 2, 3], comB: [4, 5, 6] })
	const handles = buildConstraintHandles(c)
	assert.equal(handles.length, 2)
	assert.deepEqual(handles[0], { field: 'point1', index: null, position: [1, 2, 3], role: 'a' })
	assert.deepEqual(handles[1].position, [4, 5, 6])
})

test('Pulley exposes four handles; Gear none', () => {
	const p = buildConstraintHandles(makeConstraint('Pulley', 'a', 'b', {}))
	assert.equal(p.length, 4)
	assert.deepEqual(
		p.map(h => h.field),
		['bodyPoint1', 'fixedPoint1', 'fixedPoint2', 'bodyPoint2']
	)
	assert.equal(buildConstraintHandles(makeConstraint('Gear', 'a', 'b', {})).length, 0)
})

test('Path exposes frame handle plus one handle per point (world space)', () => {
	const c = makeConstraint('Path', 'a', 'b', { comA: [0, 0, 0], comB: [16, 16, 0] })
	c.pathPosition = [100, 0, 0]
	const handles = buildConstraintHandles(c)
	// pathPosition + 2 points
	assert.equal(handles.length, 3)
	assert.deepEqual(handles[0], { field: 'pathPosition', index: null, position: [100, 0, 0], role: 'joint' })
	// handles[1] = pathPoints[0] ([0,0,0] world-shifted), handles[2] = pathPoints[1]
	assert.ok(Math.abs(handles[2].position[0] - 116) < 1e-9)
	assert.ok(Math.abs(handles[2].position[1] - 16) < 1e-9)
})

test('moveConstraintHandle updates a point field without mutating the input', () => {
	const c = makeConstraint('Hinge', 'a', 'b', {})
	const updated = moveConstraintHandle(c, 'point1', [9, 8, 7], null)
	assert.deepEqual(updated.point1, [9, 8, 7])
	assert.notDeepEqual(c.point1, [9, 8, 7])
})

test('moveConstraintHandle returns null for non-draggable fields', () => {
	const c = makeConstraint('Hinge', 'a', 'b', {})
	assert.equal(moveConstraintHandle(c, 'hingeAxis1', [1, 2, 3], null), null)
	assert.equal(moveConstraintHandle(makeConstraint('Gear', 'a', 'b', {}), 'point1', [1, 2, 3], null), null)
	assert.equal(moveConstraintHandle(c, 'pathPoints', [1, 2, 3], 99), null)
})

test('moveConstraintHandle on pathPoints converts world → path local frame', () => {
	const c = makeConstraint('Path', 'a', 'b', { comA: [0, 0, 0], comB: [16, 0, 0] })
	c.pathPosition = [100, 0, 0]
	c.pathRotation = [0, 0, 0, 1]
	const updated = moveConstraintHandle(c, 'pathPoints', [100, 24, 0], 1)
	assert.ok(updated)
	const points = updated.pathPoints
	assert.deepEqual(points[0], [0, 0, 0])
	assert.ok(Math.abs(points[1][1] - 24) < 1e-9, 'world y=24 minus offset 100 → nothing on x; y stays 24')
	assert.ok(Math.abs(points[1][0]) < 1e-9)
})

test('moved constraint survives sanitize roundtrip', () => {
	const c = makeConstraint('Slider', 'a', 'b', {})
	const moved = moveConstraintHandle(c, 'point2', [-4, 20, 6], null)
	const clean = sanitizeConstraint(moved)
	assert.ok(clean)
	assert.deepEqual(clean.point2, [-4, 20, 6])
})
