// Performance benchmark (B6-4): real workloads through our SimSession on the patched Jolt WASM.
// Scene A: 200-box stacking pile. Scene B: 20k-triangle mesh body. Records step rate,
// wall time, WASM heap usage and the leak-discipline invariant (diag.totalLive() === 0 after stop).
// Run: npm run bench

import { performance } from 'node:perf_hooks'
import { SimSession } from '../src/sim/session.ts'
import { sanitizeBodyProps } from '../src/core/store.ts'
import { totalLive, reset as diagReset } from '../src/util/diag.ts'

const J = await (await import('../vendor/jolt-patched/jolt-physics.wasm-compat.js')).default()

function boxShape(hx, hy, hz) {
	return { type: 'Box', halfExtents: [hx, hy, hz], convexRadius: 0.05 }
}
function meshShape(numTriangles) {
	const vertices = []
	const triangles = []
	const ring = Math.ceil(Math.sqrt(numTriangles)) + 1
	for (let y = 0; y <= ring; y++)
		for (let x = 0; x <= ring; x++)
			// floor in the XZ plane with gentle undulation (chunky triangles; a vertical wall or
			// sliver mesh would be a pathological case, not a benchmark)
			vertices.push([x * 0.1, 0.2 * Math.sin(x * 0.7) * Math.cos(y * 0.7), y * 0.1])
	let t = 0
	for (let y = 0; y < ring && t < numTriangles; y++) {
		for (let x = 0; x < ring && t < numTriangles; x++) {
			const a = y * (ring + 1) + x
			triangles.push([a, a + 1, a + ring + 1])
			t++
		}
	}
	return { type: 'Mesh', vertices, triangles }
}
function bodyDesc(i, position, shape) {
	return {
		uuid: 'b' + i,
		name: 'body' + i,
		position,
		rotation: [0, 0, 0, 1],
		props: sanitizeBodyProps({ motionType: 'Dynamic' }),
		shape,
		frame: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, position[0], position[1], position[2], 1],
		elementUuids: ['e' + i]
	}
}

function bench(name, bodies, frames) {
	diagReset()
	const memBefore = J.JoltInterface.prototype.sGetFreeMemory()
	const session = new SimSession({
		Jolt: J,
		bodies,
		constraints: [],
		gravity: [0, -9.81, 0],
		ground: { enabled: true, y: 0 },
		unitsPerMeter: 1
	})
	session.start()
	const t0 = performance.now()
	for (let i = 0; i < frames; i++) session.step(1 / 60)
	const wallMs = performance.now() - t0
	const memAfter = J.JoltInterface.prototype.sGetFreeMemory()
	session.stop()
	const leak = totalLive()
	return {
		name,
		bodies: bodies.length,
		frames,
		wallMs: Math.round(wallMs),
		simSeconds: +(frames / 60).toFixed(1),
		realtimeX: +((frames / 60) / (wallMs / 1000)).toFixed(1),
		wasmHeapDeltaKB: Math.round((memBefore - memAfter) / 1024),
		joltObjectsLeaked: leak
	}
}

const results = []

// Scene A: 200-box pile (10x10 grid, two layers)
const pile = []
let i = 0
for (let layer = 0; layer < 2; layer++) {
	for (let x = 0; x < 10; x++) {
		for (let z = 0; z < 10; z++) {
			pile.push(bodyDesc(i++, [x * 1.1 - 5, 2 + layer * 1.1, z * 1.1 - 5], boxShape(0.5, 0.5, 0.5)))
		}
	}
}
results.push(bench('200-box pile (settle 10s)', pile, 600))

// Scene B: 20k-triangle mesh terrain (static) + 50 dynamic boxes falling on it
const meshBodies = [
	{
		uuid: 'mesh0',
		name: 'mesh0',
		position: [0, 0, 0],
		rotation: [0, 0, 0, 1],
		props: sanitizeBodyProps({ motionType: 'Static' }),
		shape: meshShape(20000),
		frame: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1],
		elementUuids: ['em']
	}
]
for (let k = 0; k < 50; k++) meshBodies.push(bodyDesc(k + 1, [(k % 10) - 5, 5 + Math.floor(k / 10), 0], boxShape(0.3, 0.3, 0.3)))
results.push(bench('20k-tri mesh + 50 boxes', meshBodies, 600))

// Scene C: long-run stability for the pile (30s) — leak discipline under sleep/wake churn
results.push(bench('200-box pile (long 30s)', pile, 1800))

console.log(JSON.stringify(results, null, 1))
