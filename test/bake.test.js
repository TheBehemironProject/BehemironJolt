import { test } from 'node:test'
import assert from 'node:assert/strict'
import { quatAxisAngle, quatBetween } from '../src/util/math.ts'
import { quatToEulerDegContinuous } from '../src/util/math.ts'
import { planBake, createSampleBuffers, writeSample, extractChannels } from '../src/core/bake_animation.ts'

test('euler extraction roundtrips a rotation (XYZ convention)', () => {
	const q = quatAxisAngle([0, 1, 0], Math.PI / 3)
	const e = quatToEulerDegContinuous(q)
	assert.ok(Math.abs(e[1] - 60) < 1e-6, `expected y≈60°, got ${e}`)
	assert.ok(Math.abs(e[0]) < 1e-6 && Math.abs(e[2]) < 1e-6)
})

test('euler continuity avoids 180° flips across samples', () => {
	const samples = []
	for (let i = 0; i <= 10; i++) {
		// rotate past the ±90° asin branch on Y
		const angle = ((80 + i * 4) * Math.PI) / 180
		samples.push(quatAxisAngle([0, 1, 0], angle))
	}
	let prev
	let maxJump = 0
	for (const q of samples) {
		const e = quatToEulerDegContinuous(q, prev)
		if (prev) {
			for (let axis = 0; axis < 3; axis++) {
				maxJump = Math.max(maxJump, Math.abs(e[axis] - prev[axis]))
			}
		}
		prev = e
	}
	assert.ok(maxJump < 10, `euler continuity broken, max jump ${maxJump}°`)
})

test('planBake aligns physics steps to the sample rate (fractional accumulation)', () => {
	const a = planBake(5, 20)
	assert.equal(a.numSamples, 101)
	assert.equal(
		a.sampleSteps.reduce((s, n) => s + n, 0),
		300,
		'20fps × 5s = 300 physics steps exactly'
	)
	assert.equal(a.sampleTimes[100], 5, 'last sample at 5s')
	const b = planBake(2, 60)
	assert.equal(
		b.sampleSteps.reduce((s, n) => s + n, 0),
		120
	)
	const d = planBake(1, 24)
	assert.equal(
		d.sampleSteps.reduce((s, n) => s + n, 0),
		60,
		'24fps accumulates to exactly 60 steps'
	)
	const c = planBake(999, 0)
	assert.ok(c.fps >= 1 && c.duration <= 120, 'clamped to sane bounds')
})

test('sample buffers roundtrip through extractChannels with unit scaling', () => {
	const setup = planBake(1, 10)
	const buffers = createSampleBuffers(2, setup.numSamples)
	const upm = 16
	for (let s = 0; s < setup.numSamples; s++) {
		writeSample(buffers, 0, s, setup.numSamples, [1, 2, 3], [0, 0, 0, 1])
		writeSample(buffers, 1, s, setup.numSamples, [s * 0.1, 0, 0], quatAxisAngle([0, 1, 0], s * 0.1))
	}
	assert.equal(buffers.written, setup.numSamples)
	const ch = extractChannels(buffers, 0, setup.numSamples, setup.fps, upm)
	assert.equal(ch.times.length, setup.numSamples)
	assert.deepEqual(ch.positions[0], [16, 32, 48], 'meters → BB units')
	assert.ok(Math.abs(ch.rotationsDeg[0][1]) < 1e-6)
	const ch2 = extractChannels(buffers, 1, setup.numSamples, setup.fps, upm)
	// rotation continuity across samples: no >10° jump anywhere
	for (let s = 1; s < ch2.rotationsDeg.length; s++) {
		for (let axis = 0; axis < 3; axis++) {
			assert.ok(
				Math.abs(ch2.rotationsDeg[s][axis] - ch2.rotationsDeg[s - 1][axis]) < 10,
				'rotation jump'
			)
		}
	}
})

test('quatBetween-derived rotation extracts cleanly', () => {
	const q = quatBetween([1, 0, 0], [0, 1, 0])
	const e = quatToEulerDegContinuous(q)
	// rotation about Z by ~90°
	assert.ok(Math.abs(e[2] - 90) < 1e-4 || Math.abs(e[2] + 270) < 1e-4, `got ${e}`)
})
