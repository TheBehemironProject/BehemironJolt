// Performance benchmark (B6-4): real workloads through our SimSession on the patched Jolt WASM.
// Scenes: 200-box stacking pile, 20k-triangle mesh terrain, 30s long-run pile stability.
// Records step rate, wall time, WASM heap usage and the leak-discipline invariant
// (diag.totalLive() === 0 after stop).
// Run: npm run bench
//
// Each scene runs in its OWN node process (spawn of benchmark_scene.mjs). The patched
// Emscripten glue corrupts its WASM heap across heavy multi-session lifecycles in one node
// process ("table index is out of bounds" on a later session's filter creation; reproduces
// with constraint sessions on unpatched HEAD too). Process isolation sidesteps it; the
// browser bundle is unaffected in practice.

import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const runner = join(here, 'benchmark_scene.mjs')

const SCENES = [
	['pile', '200-box pile (settle 10s)'],
	['mesh', '20k-tri mesh + 50 boxes'],
	['longrun', '200-box pile (long 30s)']
]

const results = []
for (const [scene, label] of SCENES) {
	const proc = spawnSync(process.execPath, [runner, scene], { encoding: 'utf8', timeout: 600000 })
	const line = (proc.stdout || '').split('\n').find(l => l.startsWith('BENCH-RESULT '))
	if (!line) {
		console.error(`scene ${scene} failed:\n${proc.stderr}`)
		process.exit(1)
	}
	const r = JSON.parse(line.slice('BENCH-RESULT '.length))
	results.push({ label, ...r })
}

console.log('')
for (const r of results) {
	console.log(
		`${r.label}: ${r.bodies} bodies, ${r.simSeconds}s sim in ${r.wallMs}ms ` +
			`= ${r.realtimeX}x realtime · heap ${r.wasmHeapDeltaKB}KB · leaked objects ${r.joltObjectsLeaked}`
	)
}
console.log('')
const anyLeak = results.some(r => r.joltObjectsLeaked !== 0)
console.log(anyLeak ? 'LEAK DETECTED' : 'leak discipline: clean')
