// Runs ONE benchmark scene in its own node process and prints the result as a single JSON
// line on stdout ("BENCH-RESULT {...}"). Spawned by benchmark.mjs — see there for why
// scenes are process-isolated.
//
// Usage: node scripts/benchmark_scene.mjs <scene>   where scene ∈ pile | mesh | longrun

import { performance } from 'node:perf_hooks'

const J = await (await import('../vendor/jolt-patched/jolt-physics.wasm-compat.js')).default()
const { SimSession } = await import('../src/sim/session.ts')
const { sanitizeBodyProps } = await import('../src/core/store.ts')
const { totalLive, reset: diagReset } = await import('../src/util/diag.ts')

const scene = process.argv[2]

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
		// selfCollide: keep the stress scenario "boxes piling onto each other" — with the
		// contract default (no same-instance collision) they would fall through one another
		props: sanitizeBodyProps({ motionType: 'Dynamic', selfCollide: true }),
		shape,
		frame: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, position[0], position[1], position[2], 1],
		elementUuids: ['e' + i]
	}
}

function buildScene(name) {
	if (name === 'pile' || name === 'longrun') {
		const pile = []
		let i = 0
		for (let layer = 0; layer < 2; layer++) {
			for (let x = 0; x < 10; x++) {
				for (let z = 0; z < 10; z++) {
					pile.push(bodyDesc(i++, [x * 1.1 - 5, 2 + layer * 1.1, z * 1.1 - 5], boxShape(0.5, 0.5, 0.5)))
				}
			}
		}
		return { bodies: pile, frames: name === 'pile' ? 600 : 1800 }
	}
	if (name === 'mesh') {
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
		for (let k = 0; k < 50; k++)
			meshBodies.push(bodyDesc(k + 1, [(k % 10) - 5, 5 + Math.floor(k / 10), 0], boxShape(0.3, 0.3, 0.3)))
		return { bodies: meshBodies, frames: 600 }
	}
	throw new Error('unknown scene ' + name)
}

diagReset()
const memBefore = J.JoltInterface.prototype.sGetFreeMemory()
const { bodies, frames } = buildScene(scene)
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

console.log(
	'BENCH-RESULT ' +
		JSON.stringify({
			name: scene,
			bodies: bodies.length,
			wallMs: Math.round(wallMs),
			simSeconds: +(frames / 60).toFixed(1),
			realtimeX: +((frames / 60) / (wallMs / 1000)).toFixed(1),
			wasmHeapDeltaKB: Math.round((memBefore - memAfter) / 1024),
			joltObjectsLeaked: leak
		})
)
