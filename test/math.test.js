import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
	mat4Compose,
	mat4Decompose,
	mat4Invert,
	mat4Multiply,
	transformPoint,
	quatAxisAngle,
	quatBetween,
	mat4Identity
} from '../src/util/math.ts'

test('mat4 invert roundtrip', () => {
	const m = mat4Compose([3, -2, 5], quatAxisAngle([1, 1, 0], 0.7), [1, 1, 1])
	const inv = mat4Invert(m)
	const p = [1.5, 2.5, -0.5]
	const q = transformPoint(m, p)
	const back = transformPoint(inv, q)
	assert.ok(
		Math.abs(back[0] - p[0]) < 1e-9 && Math.abs(back[1] - p[1]) < 1e-9 && Math.abs(back[2] - p[2]) < 1e-9
	)
})

test('mat4 multiply with identity', () => {
	const m = mat4Compose([1, 2, 3], [0, 0, 0, 1], [2, 2, 2])
	const product = mat4Multiply(mat4Identity(), m)
	assert.deepEqual(product, m)
})

test('compose/decompose roundtrip', () => {
	const pos = [4, 8, -2]
	const quat = quatAxisAngle([0, 1, 0], Math.PI / 3)
	const m = mat4Compose(pos, quat, [1, 1, 1])
	const d = mat4Decompose(m)
	assert.ok(
		Math.abs(d.position[0] - pos[0]) < 1e-9 &&
			Math.abs(d.position[1] - pos[1]) < 1e-9 &&
			Math.abs(d.position[2] - pos[2]) < 1e-9
	)
	const dot =
		d.quaternion[0] * quat[0] +
		d.quaternion[1] * quat[1] +
		d.quaternion[2] * quat[2] +
		d.quaternion[3] * quat[3]
	assert.ok(Math.abs(Math.abs(dot) - 1) < 1e-9, `quat mismatch: ${d.quaternion} vs ${quat}`)
})

test('quatBetween maps X to Y', () => {
	const q = quatBetween([1, 0, 0], [0, 1, 0])
	const m = mat4Compose([0, 0, 0], q, [1, 1, 1])
	const v = transformPoint(m, [1, 0, 0])
	assert.ok(Math.abs(v[0]) < 1e-9 && Math.abs(v[1] - 1) < 1e-9 && Math.abs(v[2]) < 1e-9)
})
