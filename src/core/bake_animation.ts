// Physics → animation baking: pure helpers. Performance contract (PLAN §5):
// sampling writes into preallocated Float64Arrays (zero per-sample allocation),
// chunking/cancellation live in ui/bake_dialog.ts (time-sliced, <40ms per slice).

import { quatToEulerDegContinuous, type Vec3, type Quat } from '../util/math.ts'
export interface BakeBody {
	uuid: string
	name: string
}

export interface BakeSetup {
	/** seconds */
	duration: number
	/** output samples per second */
	fps: number
	/** physics steps between samples, fractional-accurate (sums to exact 60·duration over the bake) */
	sampleSteps: number[]
	/** timestamp of each sample in seconds (derived from actual step counts) */
	sampleTimes: number[]
	numSamples: number
}

export function planBake(duration: number, fps: number): BakeSetup {
	const safeDuration = Math.min(Math.max(duration, 0.1), 120)
	const safeFps = Math.min(Math.max(Math.round(fps), 1), 60)
	const numSamples = Math.max(2, Math.floor(safeDuration * safeFps) + 1)
	const exactSteps = 60 / safeFps
	const sampleSteps: number[] = [0]
	const sampleTimes: number[] = [0]
	let accumulated = 0
	let prevFloor = 0
	let totalSteps = 0
	for (let s = 1; s < numSamples; s++) {
		accumulated += exactSteps
		const f = Math.floor(accumulated)
		sampleSteps.push(Math.max(1, f - prevFloor))
		prevFloor = f
		totalSteps += sampleSteps[s]
		sampleTimes.push(totalSteps / 60)
	}
	return { duration: safeDuration, fps: safeFps, sampleSteps, sampleTimes, numSamples }
}

/** Flattened per-body sample buffers, preallocated once. Index = bodyIndex * numSamples * stride. */
export interface SampleBuffers {
	/** xyz per sample */
	positions: Float64Array
	/** xyzw per sample */
	quats: Float64Array
	/** how many samples written so far */
	written: number
}

export function createSampleBuffers(numBodies: number, numSamples: number): SampleBuffers {
	return {
		positions: new Float64Array(numBodies * numSamples * 3),
		quats: new Float64Array(numBodies * numSamples * 4),
		written: 0
	}
}

export function writeSample(
	buffers: SampleBuffers,
	bodyIndex: number,
	sampleIndex: number,
	numSamples: number,
	pos: Vec3,
	quat: Quat
): void {
	const pi = (bodyIndex * numSamples + sampleIndex) * 3
	buffers.positions[pi] = pos[0]
	buffers.positions[pi + 1] = pos[1]
	buffers.positions[pi + 2] = pos[2]
	const qi = (bodyIndex * numSamples + sampleIndex) * 4
	buffers.quats[qi] = quat[0]
	buffers.quats[qi + 1] = quat[1]
	buffers.quats[qi + 2] = quat[2]
	buffers.quats[qi + 3] = quat[3]
	if (sampleIndex + 1 > buffers.written) buffers.written = sampleIndex + 1
}

export interface BakedChannels {
	times: number[]
	/** BlockBench units */
	positions: Vec3[]
	/** degrees, branch-continuous */
	rotationsDeg: Vec3[]
}

/** Read one body's column out of the sample buffers into BB-ready keyframe values. */
export function extractChannels(
	buffers: SampleBuffers,
	bodyIndex: number,
	numSamples: number,
	fps: number,
	unitsPerMeter: number,
	timesOverride?: number[]
): BakedChannels {
	const times: number[] = []
	const positions: Vec3[] = []
	const rotationsDeg: Vec3[] = []
	let prevEuler: Vec3 | undefined
	let prevQuat: Quat | undefined
	for (let s = 0; s < buffers.written; s++) {
		const pi = (bodyIndex * numSamples + s) * 3
		const qi = (bodyIndex * numSamples + s) * 4
		times.push(timesOverride ? timesOverride[s] : s / fps)
		positions.push([
			buffers.positions[pi] * unitsPerMeter,
			buffers.positions[pi + 1] * unitsPerMeter,
			buffers.positions[pi + 2] * unitsPerMeter
		])
		const quat: Quat = [
			buffers.quats[qi],
			buffers.quats[qi + 1],
			buffers.quats[qi + 2],
			buffers.quats[qi + 3]
		]
		const euler = quatToEulerDegContinuous(quat, prevEuler, prevQuat)
		rotationsDeg.push(euler)
		prevEuler = euler
		prevQuat = quat
	}
	return { times, positions, rotationsDeg }
}
