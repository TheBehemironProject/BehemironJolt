import { test } from 'node:test'
import assert from 'node:assert/strict'
import { buildSkinWeights } from '../src/core/skin.ts'

const UPM = 16

test('weights transfer by position and normalize', () => {
	const meshes = [{ meshUuidPrefix: 'abc', vertices: { v1: [0, 0, 0], v2: [16, 0, 0], v3: [16, 16, 0] } }]
	const bones = [
		{ boneUuid: 'b1', boneName: 'arm', weights: { 'abc:v1': 1, 'abc:v2': 0.5 } },
		{ boneUuid: 'b2', boneName: 'hand', weights: { 'abc:v2': 0.5, 'abc:v3': 1 } }
	]
	// soft verts in meters: v1=(0,0,0), v2=(1,0,0), v3=(1,1,0); v4 unmatched
	const soft = [
		[0, 0, 0],
		[1, 0, 0],
		[1, 1, 0],
		[9, 9, 9]
	]
	const { bindings, pinned } = buildSkinWeights(soft, meshes, bones, UPM)
	assert.equal(bindings.length, 2)
	const b1 = bindings.find(b => b.boneUuid === 'b1')
	const b2 = bindings.find(b => b.boneUuid === 'b2')
	assert.ok(Math.abs(b1.weights[0] - 1) < 1e-9, 'v1 fully arm')
	assert.ok(Math.abs(b1.weights[1] - 0.5) < 1e-9 && Math.abs(b2.weights[1] - 0.5) < 1e-9, 'v2 split')
	assert.ok(Math.abs(b2.weights[2] - 1) < 1e-9, 'v3 fully hand')
	assert.equal(b1.weights[3], 0, 'unmatched vert unbound')
	assert.deepEqual(pinned, [0, 2], 'single-bone full weight → pinned')
})

test('no bones / empty meshes are safe', () => {
	const { bindings, pinned } = buildSkinWeights([[0, 0, 0]], [], [], UPM)
	assert.deepEqual(bindings, [])
	assert.deepEqual(pinned, [])
})
