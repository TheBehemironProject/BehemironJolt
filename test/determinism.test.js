// Deterministic replay validation (B6-3): runs the PATCHED Jolt WASM in node, no Blockbench needed.
// Validates: (1) same-build determinism (two identical runs match bit-for-bit), (2) SaveState →
// diverge → RestoreState(Rewind) → replay reproduces the original trajectory exactly.
import { test } from 'node:test'
import assert from 'node:assert/strict'

const J = await (await import('../vendor/jolt-patched/jolt-physics.wasm-compat.js')).default()

function makeWorld() {
	const objectFilter = new J.ObjectLayerPairFilterTable(2)
	objectFilter.EnableCollision(1, 1)
	objectFilter.EnableCollision(0, 1)
	const bpLayer = new J.BroadPhaseLayer(0)
	const bpInterface = new J.BroadPhaseLayerInterfaceTable(2, 1)
	bpInterface.MapObjectToBroadPhaseLayer(0, bpLayer)
	bpInterface.MapObjectToBroadPhaseLayer(1, bpLayer)
	const bpFilter = new J.ObjectVsBroadPhaseLayerFilterTable(bpInterface, 1, objectFilter, 2)
	const settings = new J.JoltSettings()
	settings.mObjectLayerPairFilter = objectFilter
	settings.mBroadPhaseLayerInterface = bpInterface
	settings.mObjectVsBroadPhaseLayerFilter = bpFilter
	const jolt = new J.JoltInterface(settings)
	const bi = jolt.GetPhysicsSystem().GetBodyInterface()
	// ground
	const gShape = new J.BoxShapeSettings(new J.Vec3(50, 1, 50), 0.05).Create().Get()
	bi.CreateAndAddBody(
		new J.BodyCreationSettings(
			gShape,
			new J.RVec3(0, -1, 0),
			new J.Quat(0, 0, 0, 1),
			J.EMotionType_Static,
			0
		),
		J.EActivation_Activate
	)
	// two stacked dynamic boxes
	const ids = []
	for (let i = 0; i < 2; i++) {
		const shape = new J.BoxShapeSettings(new J.Vec3(0.5, 0.5, 0.5), 0.05).Create().Get()
		const id = bi.CreateAndAddBody(
			new J.BodyCreationSettings(
				shape,
				new J.RVec3(0.1 * i, 2 + i * 1.2, 0),
				new J.Quat(0, 0, 0, 1),
				J.EMotionType_Dynamic,
				1
			),
			J.EActivation_Activate
		)
		ids.push(id)
	}
	return { jolt, ids }
}

const readPos = (bi, id) => {
	const p = bi.GetPosition(id)
	return [p.GetX(), p.GetY(), p.GetZ()]
}

function runSteps(world, n) {
	for (let i = 0; i < n; i++) world.jolt.Step(1 / 60, 1)
}

function snapshot(world) {
	const bi = world.jolt.GetPhysicsSystem().GetBodyInterface()
	return world.ids.map(id => readPos(bi, id))
}

test('same-build determinism: identical runs produce identical states', () => {
	const a = makeWorld()
	const b = makeWorld()
	runSteps(a, 120)
	runSteps(b, 120)
	const sa = snapshot(a),
		sb = snapshot(b)
	for (let i = 0; i < sa.length; i++) {
		for (let k = 0; k < 3; k++) assert.equal(sa[i][k], sb[i][k], `run divergence at body ${i} axis ${k}`)
	}
})

test('SaveState/RestoreState replays the original trajectory exactly', () => {
	const w = makeWorld()
	runSteps(w, 120)
	const _bi = w.jolt.GetPhysicsSystem().GetBodyInterface()
	const recorder = new J.StateRecorderImpl()
	w.jolt.GetPhysicsSystem().SaveState(recorder)
	const atCheckpoint = snapshot(w)

	// diverge: run more steps (bodies may sleep — movement is not guaranteed, replay is what matters)
	runSteps(w, 60)
	runSteps(w, 1)

	// restore + replay the same 60 steps: must reproduce the uninterrupted trajectory
	recorder.Rewind()
	w.jolt.GetPhysicsSystem().RestoreState(recorder)
	const replayedBase = snapshot(w)
	assert.deepEqual(replayedBase, atCheckpoint, 'restore must return to checkpoint state')
	const reference = makeWorld()
	runSteps(reference, 180)
	const expected = snapshot(reference)
	runSteps(w, 60)
	const replayed = snapshot(w)
	for (let i = 0; i < expected.length; i++) {
		for (let k = 0; k < 3; k++) assert.equal(replayed[i][k], expected[i][k], `replay mismatch body ${i}`)
	}
})

test('StateRecorderImpl.IsEqual compares two recorders', () => {
	const a = makeWorld()
	const b = makeWorld()
	runSteps(a, 60)
	runSteps(b, 60)
	const ra = new J.StateRecorderImpl()
	const rb = new J.StateRecorderImpl()
	a.jolt.GetPhysicsSystem().SaveState(ra)
	b.jolt.GetPhysicsSystem().SaveState(rb)
	ra.SetValidating(true)
	rb.SetValidating(true)
	assert.ok(ra.IsEqual(rb), 'identical worlds should compare equal')
})
