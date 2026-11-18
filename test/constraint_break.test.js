// breakImpulse editor wiring (docs/FORMAT.md §4.1): an overstressed constraint is removed at
// runtime and the counter surfaces it. ONE constraint session per file — see collision_break.test.js
// for why (upstream glue fault with multiple JoltInterfaces+constraints per node process).
import { test } from 'node:test'
import assert from 'node:assert/strict'

const J = await (await import('../vendor/jolt-patched/jolt-physics.wasm-compat.js')).default()
const { SimSession } = await import('../src/sim/session.ts')
const { makeConstraint, constraintToExport } = await import('../src/core/constraints.ts')
const { DEFAULT_BODY_PROPS } = await import('../src/core/store.ts')
const { mat4Identity } = await import('../src/util/math.ts')
const diag = await import('../src/util/diag.ts')

test('breakImpulse removes an overstressed constraint at runtime', () => {
	const c = makeConstraint('Fixed', 'A', 'B', { comA: [0, 32, 0], comB: [0, 0, 0] })
	c.breakImpulse = 1e-9
	const mk = (uuid, position, patch = {}) => ({
		uuid,
		name: uuid,
		position,
		rotation: [0, 0, 0, 1],
		props: { ...DEFAULT_BODY_PROPS, ...patch },
		shape: { type: 'Box', halfExtents: [0.5, 0.5, 0.5], convexRadius: 0.05 },
		frame: mat4Identity(),
		elementUuids: [uuid]
	})
	const session = new SimSession({
		Jolt: J,
		bodies: [mk('A', [0, 2, 0]), mk('B', [0, 0, 0], { motionType: 'Static' })],
		constraints: [constraintToExport(c, 1 / 16)],
		gravity: [0, -9.81, 0],
		ground: { enabled: false, y: 0 },
		unitsPerMeter: 16
	})
	session.start()
	for (let i = 0; i < 60; i++) session.step(1 / 60)
	let y = null
	session.readTransforms((uuid, _index, pos) => {
		if (uuid === 'A') y = pos[1]
	})
	const broken = session.brokenConstraints()
	session.stop()
	assert.equal(diag.totalLive(), 0, 'native wrapper leak')
	assert.equal(broken, 1)
	assert.ok(y < 0.5, `expected A to fall after breaking, y=${y}`)
})
