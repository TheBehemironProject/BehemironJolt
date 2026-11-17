import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildConstraintViz } from '../src/core/vizdata.ts'
import { makeConstraint, constraintToExport, sanitizeConstraint } from '../src/core/constraints.ts'

const comOf = uuid => ({ bodyA: [10, 0, 0], bodyB: [-10, 0, 0] })[uuid] || null

test('Hinge gizmo: axis segment + two per-body arcs; limits converted degrees → radians', () => {
	const c = makeConstraint('Hinge', 'bodyA', 'bodyB', { comA: [0, 0, 0], comB: [16, 0, 0] })
	c.limitsMin = -90
	c.limitsMax = 90
	const viz = buildConstraintViz(c, comOf)
	const arcs = viz.filter(p => p.kind === 'arc')
	assert.equal(arcs.length, 2)
	assert.equal(arcs[0].role, 'a')
	assert.equal(arcs[1].role, 'b')
	assert.ok(Math.abs(arcs[0].from + Math.PI / 2) < 1e-9)
	assert.ok(Math.abs(arcs[0].to - Math.PI / 2) < 1e-9)
	assert.ok(arcs[0].radius < arcs[1].radius, 'body B circle slightly larger (Godot pattern)')
	assert.ok(viz.some(p => p.kind === 'segment'))
	assert.ok(viz.some(p => p.kind === 'cross'))
})

test('Hinge without limits draws full circles', () => {
	const c = makeConstraint('Hinge', 'bodyA', 'bodyB', {})
	const arcs = buildConstraintViz(c, comOf).filter(p => p.kind === 'arc')
	assert.ok(arcs.every(a => a.to - a.from >= Math.PI * 2 - 1e-9))
})

test('Slider gizmo: rail between limits with end crosses', () => {
	const c = makeConstraint('Slider', 'bodyA', 'bodyB', { comA: [0, 0, 0], comB: [0, 16, 0] })
	c.limitsMin = -8
	c.limitsMax = 24
	const viz = buildConstraintViz(c, comOf)
	const rail = viz.find(p => p.kind === 'segment' && p.role === 'joint')
	assert.ok(rail)
	const dir = [rail.b[0] - rail.a[0], rail.b[1] - rail.a[1], rail.b[2] - rail.a[2]]
	assert.ok(Math.abs(dir[1] - 32) < 1e-9, 'rail spans limitsMin..limitsMax along Y')
})

test('Pulley gizmo: rope polyline through four points', () => {
	const c = makeConstraint('Pulley', 'bodyA', 'bodyB', { comA: [0, 0, 0], comB: [16, 0, 0] })
	const viz = buildConstraintViz(c, comOf)
	const rope = viz.find(p => p.kind === 'polyline')
	assert.equal(rope.points.length, 4)
})

test('Gear gizmo: drawn at body COMs (no anchors in data)', () => {
	const c = makeConstraint('Gear', 'bodyA', 'bodyB', {})
	const viz = buildConstraintViz(c, comOf)
	const crosses = viz.filter(p => p.kind === 'cross')
	assert.equal(crosses.length, 2)
	assert.deepEqual(crosses[0].at, [10, 0, 0])
	assert.deepEqual(crosses[1].at, [-10, 0, 0])
})

test('Path gizmo: polyline transformed by pathPosition/pathRotation', () => {
	const c = makeConstraint('Path', 'bodyA', 'bodyB', { comA: [0, 0, 0], comB: [0, 16, 0] })
	c.pathPosition = [100, 0, 0]
	c.pathRotation = [0, 0, 0, 1]
	const viz = buildConstraintViz(c, comOf)
	const line = viz.find(p => p.kind === 'polyline')
	assert.ok(Math.abs(line.points[0][0] - 100) < 1e-9)
	assert.ok(
		Math.abs(line.points[1][1] - 16) < 1e-9,
		'point transformed by pathPosition offset (units unchanged)'
	)
})

test('all 12 types produce at least one primitive', () => {
	for (const type of [
		'Fixed',
		'Distance',
		'Hinge',
		'Slider',
		'Point',
		'Cone',
		'SwingTwist',
		'SixDOF',
		'Pulley',
		'Gear',
		'RackAndPinion',
		'Path'
	]) {
		const c = makeConstraint(type, 'bodyA', 'bodyB', { comA: [0, 0, 0], comB: [16, 16, 16] })
		const viz = buildConstraintViz(sanitizeConstraint(c) || c, comOf)
		assert.ok(viz.length > 0, `${type} produced no gizmo primitives`)
	}
})

test('motor contract: Hinge rad/s + degrees→radians; Slider linear m/s; EMotorState passthrough', () => {
	const h = makeConstraint('Hinge', 'a', 'b', {})
	h.motorState = 'Velocity'
	h.motorTargetVelocity = 180
	h.motorMaxTorque = 50
	const he = constraintToExport(h, 1 / 16)
	assert.equal(he.motorState, 'Velocity')
	assert.ok(Math.abs(he.motorTargetVelocity - Math.PI) < 1e-9, '180 °/s → π rad/s')
	assert.equal(he.motorMaxTorque, 50)

	const s = makeConstraint('Slider', 'a', 'b', {})
	s.motorState = 'Position'
	s.motorTargetVelocity = 32
	s.motorTargetPosition = 16
	const se = constraintToExport(s, 1 / 16)
	assert.equal(se.motorState, 'Position')
	assert.ok(Math.abs(se.motorTargetVelocity - 2) < 1e-9, '32 units/s → 2 m/s')
	assert.ok(Math.abs(se.motorTargetPosition - 1) < 1e-9, '16 units → 1 m')
})
