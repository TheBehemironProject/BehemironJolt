// Character / vehicle controller metadata: defaults + sanitize. Params are stored per body in
// `controllerParams` (free-form record, defaults merged at use time). UI/会话全量参数编辑后续批次。
// Field names follow Jolt settings classes (CharacterSettings / WheeledVehicleControllerSettings / WheelSettingsTV).

import type { Vec3 } from '../util/math.ts'

export interface ControllerParamDef {
	key: string
	def: number | Vec3 | boolean | string
	min?: number
	max?: number
	unit?: 'm' | 'deg'
	section?: string
}

export const CHARACTER_PARAMS: ControllerParamDef[] = [
	{ key: 'up', def: [0, 1, 0], section: 'character' },
	{ key: 'radius', def: 0.3, min: 0.01, unit: 'm', section: 'character' },
	{ key: 'height', def: 1.6, min: 0.01, unit: 'm', section: 'character' },
	{ key: 'mass', def: 70, min: 0.001, section: 'character' },
	{ key: 'maxSlopeAngle', def: 50, min: 0, max: 90, unit: 'deg', section: 'floor' },
	{ key: 'maxStrength', def: 100, min: 0, section: 'floor' },
	{ key: 'characterPadding', def: 0.02, min: 0, unit: 'm', section: 'floor' },
	{ key: 'maxSeparationDistance', def: 0.1, min: 0, unit: 'm', section: 'floor' },
	{ key: 'jumpSpeed', def: 4.5, min: 0, section: 'motion' }
]

export const VEHICLE_PARAMS: ControllerParamDef[] = [
	{ key: 'maxTorque', def: 500, min: 0, section: 'engine' },
	{ key: 'minRPM', def: 1000, min: 0, section: 'engine' },
	{ key: 'maxRPM', def: 6000, min: 0, section: 'engine' },
	{ key: 'inertia', def: 0.5, min: 0.001, section: 'engine' },
	{ key: 'angularDamping', def: 0.2, min: 0, section: 'engine' },
	{ key: 'clutchStrength', def: 10, min: 0, section: 'engine' },
	{ key: 'gearCount', def: 4, min: 1, max: 10, section: 'transmission' },
	{ key: 'gearSwitchTime', def: 0.3, min: 0, section: 'transmission' },
	{ key: 'maxSteeringAngle', def: 35, min: 0, max: 90, unit: 'deg', section: 'wheels' },
	{ key: 'wheelRadius', def: 0.35, min: 0.05, unit: 'm', section: 'wheels' },
	{ key: 'wheelWidth', def: 0.25, min: 0.05, unit: 'm', section: 'wheels' },
	{ key: 'maxWheelTorque', def: 1000, min: 0, section: 'wheels' },
	{ key: 'suspensionMinLength', def: 0.3, min: 0, unit: 'm', section: 'suspension' },
	{ key: 'suspensionMaxLength', def: 0.5, min: 0, unit: 'm', section: 'suspension' },
	{ key: 'suspensionSpringFrequency', def: 2.5, min: 0.1, section: 'suspension' },
	{ key: 'suspensionSpringDamping', def: 0.5, min: 0, section: 'suspension' },
	{ key: 'brakeTorque', def: 1500, min: 0, section: 'brakes' },
	{ key: 'handBrakeTorque', def: 3000, min: 0, section: 'brakes' },
	{ key: 'wheelFriction', def: 2, min: 0, section: 'brakes' }
]

export const SOFTBODY_PARAMS: ControllerParamDef[] = [
	{ key: 'edgeCompliance', def: 0.000001, min: 0 },
	{ key: 'bendType', def: 'Distance' },
	{ key: 'bendCompliance', def: 0.00001, min: 0 },
	{ key: 'volumeCompliance', def: 0.000001, min: 0 },
	{ key: 'useVolumeConstraints', def: true },
	{ key: 'linearDamping', def: 0.05, min: 0 },
	{ key: 'pressure', def: 0, min: 0 },
	{ key: 'vertexMass', def: 0.1, min: 0.0001 }
]

// Hair is authored procedurally (deterministic formula in docs/FORMAT.md): plugin and engine
// generate identical strands from these parameters. Simulation: Jolt Hair (CPU compute path in the
// patched WASM build); GPU ComputeSystem is an engine-side option via jolt-jni.
export const HAIR_PARAMS: ControllerParamDef[] = [
	{ key: 'strandCount', def: 16, min: 1, max: 4096 },
	{ key: 'segmentsPerStrand', def: 8, min: 2, max: 64 },
	{ key: 'strandLength', def: 0.4, min: 0.01, unit: 'm' },
	{ key: 'rootRadius', def: 0.15, min: 0, unit: 'm' },
	{ key: 'rootInvMass', def: 0, min: 0 },
	{ key: 'iterationsPerSecond', def: 360, min: 60, max: 1200 },
	{ key: 'bendCompliance', def: 0.00002, min: 0 },
	{ key: 'friction', def: 0.5, min: 0 },
	{ key: 'linearDamping', def: 2.0, min: 0 },
	{ key: 'angularDamping', def: 2.0, min: 0 },
	{ key: 'enableLRA', def: true },
	{ key: 'enableCollision', def: true },
	{ key: 'gravityFactorMin', def: 0.1, min: 0, max: 1 },
	{ key: 'gravityFactorMax', def: 1.0, min: 0, max: 1 }
]

export type ControllerKind = 'character' | 'vehicle' | 'softbody' | 'hair'

export function controllerDefaults(kind: ControllerKind): Record<string, number | Vec3 | boolean | string> {
	const defs =
		kind === 'character'
			? CHARACTER_PARAMS
			: kind === 'vehicle'
				? VEHICLE_PARAMS
				: kind === 'softbody'
					? SOFTBODY_PARAMS
					: HAIR_PARAMS
	const out: Record<string, number | Vec3 | boolean | string> = {}
	for (const p of defs) out[p.key] = Array.isArray(p.def) ? p.def.slice() : p.def
	return out
}

export function sanitizeControllerParams(
	kind: ControllerKind,
	raw: unknown
): Record<string, number | Vec3 | boolean | string> {
	const out = controllerDefaults(kind)
	if (!raw || typeof raw !== 'object') return out
	const r = raw as Record<string, unknown>
	const defs =
		kind === 'character'
			? CHARACTER_PARAMS
			: kind === 'vehicle'
				? VEHICLE_PARAMS
				: kind === 'softbody'
					? SOFTBODY_PARAMS
					: HAIR_PARAMS
	for (const p of defs) {
		const value = r[p.key]
		if (Array.isArray(p.def)) {
			if (Array.isArray(value) && value.length === 3 && (value as number[]).every(Number.isFinite))
				out[p.key] = value.slice()
		} else if (typeof p.def === 'boolean') {
			if (typeof value === 'boolean') out[p.key] = value
		} else if (typeof p.def === 'string') {
			if (value === 'None' || value === 'Distance' || value === 'Dihedral') out[p.key] = value
		} else {
			const n = Number(value)
			if (Number.isFinite(n)) {
				let v = n
				if (p.min !== undefined) v = Math.max(p.min, v)
				if (Number.isInteger(p.def)) v = Math.round(v)
				if (p.max !== undefined) v = Math.min(p.max, v)
				out[p.key] = v
			}
		}
	}
	return out
}
