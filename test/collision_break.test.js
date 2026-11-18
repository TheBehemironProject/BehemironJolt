// Editor-sim wiring for collisionGroup / selfCollide (docs/FORMAT.md §3):
// drives the PATCHED Jolt WASM through SimSession in node, no Blockbench needed.
// Also asserts zero native-wrapper leaks for the GroupFilterTable/CollisionGroup path.
//
// Constraint sessions (break tests) live in separate files on purpose: creating more than
// one JoltInterface-with-constraints per node process trips an upstream joltphysics-js
// Emscripten glue fault (memory access out of bounds on the next JoltInterface allocation;
// reproduces on unpatched HEAD). BlockBench (browser) is unaffected in practice — the user
// re-runs constraint sims there routinely. One session per test file = one process = stable.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const J = await (await import('../vendor/jolt-patched/jolt-physics.wasm-compat.js')).default()
const { SimSession } = await import('../src/sim/session.ts')
const { DEFAULT_BODY_PROPS } = await import('../src/core/store.ts')
const { mat4Identity } = await import('../src/util/math.ts')
const diag = await import('../src/util/diag.ts')

const BOX = { type: 'Box', halfExtents: [0.5, 0.5, 0.5], convexRadius: 0.05 }

function boxBody(uuid, position, patch = {}) {
	return {
		uuid,
		name: uuid,
		position,
		rotation: [0, 0, 0, 1],
		props: { ...DEFAULT_BODY_PROPS, ...patch },
		shape: BOX,
		frame: mat4Identity(),
		elementUuids: [uuid]
	}
}

// A falls onto static B. Returns A's final height: ≈1.0 = rested on B, very negative = fell through.
function runFallCase(patchA, patchB, steps = 150) {
	const session = new SimSession({
		Jolt: J,
		bodies: [
			boxBody('A', [0, 2, 0], patchA),
			boxBody('B', [0, 0, 0], { motionType: 'Static', ...patchB })
		],
		constraints: [],
		gravity: [0, -9.81, 0],
		ground: { enabled: false, y: 0 },
		unitsPerMeter: 16
	})
	session.start()
	for (let i = 0; i < steps; i++) session.step(1 / 60)
	let y = null
	session.readTransforms((uuid, _index, pos) => {
		if (uuid === 'A') y = pos[1]
	})
	session.stop()
	assert.equal(diag.totalLive(), 0, 'native wrapper leak')
	return y
}

test('default: same-instance bodies pass through (selfCollide is opt-in)', () => {
	const y = runFallCase({}, {})
	assert.ok(y < -5, `expected A to fall through B, y=${y}`)
})

test('selfCollide on one side collides the pair (OR rule)', () => {
	const y = runFallCase({ selfCollide: true }, {})
	assert.ok(Math.abs(y - 1.0) < 0.1, `expected A resting on B at y≈1.0, y=${y}`)
})

test('same collisionGroup never collides, selfCollide cannot override', () => {
	const y = runFallCase(
		{ collisionGroup: 7, selfCollide: true },
		{ collisionGroup: 7, selfCollide: true }
	)
	assert.ok(y < -5, `expected pass-through, y=${y}`)
})

test('different groups without selfCollide still pass through', () => {
	const y = runFallCase({ collisionGroup: 1 }, { collisionGroup: 2 })
	assert.ok(y < -5, `expected pass-through, y=${y}`)
})
