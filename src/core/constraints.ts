// Constraint metadata: one definition drives UI forms, authored storage and engine contract.
// Storage units: points in BlockBench units, angles in degrees, lengths in BlockBench units.
// Export/contract units (see constraintToExport): points → meters, angles → radians.
//
// Field kinds:
//   point3      world-space anchor (RVec3 in Jolt)      → scaled to meters on export
//   pos3        position in a settings local frame (Vec3) → scaled to meters on export
//   vec3        direction axis (Vec3)                   → never scaled
//   quat        [x,y,z,w]                               → never scaled
//   pathPoints  array of [x,y,z] (PathConstraintPathHermite) → scaled to meters
//   float       unit: 'deg' converts to radians on export; 'm' converts to meters; null = as-is
//   floatOrNull null = unlimited
//   bool / enum (enumName = jolt-jni enum prefix) / vec6 (3 translation + 3 rotation axes)
//
// Type names map 1:1 to jolt-jni settings classes: `${type}ConstraintSettings`.

import type { ConstraintData } from './store.ts'
import { mat4Compose, mat4Invert, transformPoint, type Vec3, type Quat } from '../util/math.ts'

function vec(value: unknown, fallback: Vec3): Vec3 {
	return Array.isArray(value) && value.length === 3 && (value as number[]).every(Number.isFinite)
		? (value as Vec3)
		: fallback
}

export type FieldKind =
	'point3' | 'pos3' | 'vec3' | 'quat' | 'pathPoints' | 'float' | 'floatOrNull' | 'bool' | 'enum' | 'vec6'
export type FieldSection = 'anchors' | 'limits' | 'motor' | 'path'

export interface FieldDef {
	key: string
	label: string
	kind: FieldKind
	def: unknown
	min?: number
	max?: number
	step?: number
	unit?: 'deg' | 'm'
	section?: FieldSection
	labelKey?: string
	enumName?: string
	options?: readonly string[]
}

export interface ConstraintTypeMeta {
	label: string
	hasSpace?: boolean
	fields: FieldDef[]
}

const V = (x: number, y: number, z: number): Vec3 => [x, y, z]

export const CONSTRAINT_SPACE = 'WorldSpace' // v1: world-space anchors only

export const CONSTRAINT_TYPES: Record<string, ConstraintTypeMeta> = {
	Fixed: {
		label: 'Fixed',
		fields: [
			{ key: 'autoDetectPoint', label: 'Auto detect point', kind: 'bool', def: true },
			{ key: 'point1', label: 'Point 1', kind: 'point3', def: V(0, 0, 0) },
			{ key: 'axisX1', label: 'Axis X 1', kind: 'vec3', def: V(1, 0, 0) },
			{ key: 'axisY1', label: 'Axis Y 1', kind: 'vec3', def: V(0, 1, 0) },
			{ key: 'point2', label: 'Point 2', kind: 'point3', def: V(0, 0, 0) },
			{ key: 'axisX2', label: 'Axis X 2', kind: 'vec3', def: V(1, 0, 0) },
			{ key: 'axisY2', label: 'Axis Y 2', kind: 'vec3', def: V(0, 1, 0) }
		]
	},
	Distance: {
		label: 'Distance',
		fields: [
			{ key: 'point1', label: 'Point 1', kind: 'point3', def: V(0, 0, 0) },
			{ key: 'point2', label: 'Point 2', kind: 'point3', def: V(0, 0, 0) },
			{
				key: 'minDistance',
				label: 'Min distance',
				kind: 'float',
				def: 0,
				min: 0,
				unit: 'm',
				section: 'limits'
			},
			{
				key: 'maxDistance',
				label: 'Max distance (0 = none)',
				kind: 'floatOrNull',
				def: null,
				min: 0,
				unit: 'm',
				section: 'limits'
			}
		]
	},
	Hinge: {
		label: 'Hinge',
		fields: [
			{ key: 'point1', label: 'Anchor 1', kind: 'point3', def: V(0, 0, 0) },
			{ key: 'hingeAxis1', label: 'Hinge axis 1', kind: 'vec3', def: V(0, 1, 0) },
			{ key: 'normalAxis1', label: 'Normal axis 1', kind: 'vec3', def: V(1, 0, 0) },
			{ key: 'point2', label: 'Anchor 2', kind: 'point3', def: V(0, 0, 0) },
			{ key: 'hingeAxis2', label: 'Hinge axis 2', kind: 'vec3', def: V(0, 1, 0) },
			{ key: 'normalAxis2', label: 'Normal axis 2', kind: 'vec3', def: V(1, 0, 0) },
			{
				key: 'limitsMin',
				label: 'Limit min (°)',
				kind: 'floatOrNull',
				def: null,
				unit: 'deg',
				section: 'limits'
			},
			{
				key: 'limitsMax',
				label: 'Limit max (°)',
				kind: 'floatOrNull',
				def: null,
				unit: 'deg',
				section: 'limits'
			},
			{
				key: 'maxFrictionTorque',
				label: 'Max friction torque',
				kind: 'float',
				def: 0,
				min: 0,
				section: 'limits'
			},
			{
				key: 'motorState',
				label: 'Motor state',
				kind: 'enum',
				def: 'Off',
				enumName: 'EMotorState',
				options: ['Off', 'Velocity', 'Position'],
				section: 'motor'
			},
			{
				key: 'motorTargetVelocity',
				label: 'Motor target velocity (°/s)',
				kind: 'float',
				def: 0,
				unit: 'deg',
				section: 'motor'
			},
			{
				key: 'motorTargetAngle',
				label: 'Motor target angle (°)',
				kind: 'float',
				def: 0,
				unit: 'deg',
				section: 'motor'
			},
			{
				key: 'motorMaxTorque',
				label: 'Motor max torque',
				kind: 'float',
				def: 0,
				min: 0,
				section: 'motor'
			}
		]
	},
	Slider: {
		label: 'Slider',
		fields: [
			{ key: 'point1', label: 'Anchor 1', kind: 'point3', def: V(0, 0, 0) },
			{ key: 'sliderAxis1', label: 'Slider axis 1', kind: 'vec3', def: V(0, 1, 0) },
			{ key: 'normalAxis1', label: 'Normal axis 1', kind: 'vec3', def: V(1, 0, 0) },
			{ key: 'point2', label: 'Anchor 2', kind: 'point3', def: V(0, 0, 0) },
			{ key: 'sliderAxis2', label: 'Slider axis 2', kind: 'vec3', def: V(0, 1, 0) },
			{ key: 'normalAxis2', label: 'Normal axis 2', kind: 'vec3', def: V(1, 0, 0) },
			{
				key: 'limitsMin',
				label: 'Limit min',
				kind: 'floatOrNull',
				def: null,
				unit: 'm',
				section: 'limits'
			},
			{
				key: 'limitsMax',
				label: 'Limit max',
				kind: 'floatOrNull',
				def: null,
				unit: 'm',
				section: 'limits'
			},
			{
				key: 'maxFrictionForce',
				label: 'Max friction force',
				kind: 'float',
				def: 0,
				min: 0,
				section: 'limits'
			},
			{
				key: 'motorState',
				label: 'Motor state',
				kind: 'enum',
				def: 'Off',
				enumName: 'EMotorState',
				options: ['Off', 'Velocity', 'Position'],
				section: 'motor'
			},
			{
				key: 'motorTargetVelocity',
				labelKey: 'motorTargetVelocityM',
				label: 'Motor target velocity (m/s)',
				kind: 'float',
				def: 0,
				unit: 'm',
				section: 'motor'
			},
			{
				key: 'motorTargetPosition',
				label: 'Motor target position',
				kind: 'float',
				def: 0,
				unit: 'm',
				section: 'motor'
			},
			{
				key: 'motorMaxForce',
				label: 'Motor max force',
				kind: 'float',
				def: 0,
				min: 0,
				section: 'motor'
			}
		]
	},
	Point: {
		label: 'Point',
		fields: [
			{ key: 'point1', label: 'Point 1', kind: 'point3', def: V(0, 0, 0) },
			{ key: 'point2', label: 'Point 2', kind: 'point3', def: V(0, 0, 0) }
		]
	},
	Cone: {
		label: 'Cone',
		fields: [
			{ key: 'point1', label: 'Point 1', kind: 'point3', def: V(0, 0, 0) },
			{ key: 'twistAxis1', label: 'Twist axis 1', kind: 'vec3', def: V(0, 1, 0) },
			{ key: 'point2', label: 'Point 2', kind: 'point3', def: V(0, 0, 0) },
			{ key: 'twistAxis2', label: 'Twist axis 2', kind: 'vec3', def: V(0, 1, 0) },
			{
				key: 'halfConeAngle',
				label: 'Half cone angle (°)',
				kind: 'float',
				def: 45,
				min: 0,
				max: 180,
				unit: 'deg'
			}
		]
	},
	SwingTwist: {
		label: 'SwingTwist',
		fields: [
			{ key: 'position1', label: 'Position 1', kind: 'point3', def: V(0, 0, 0) },
			{ key: 'twistAxis1', label: 'Twist axis 1', kind: 'vec3', def: V(0, 1, 0) },
			{ key: 'planeAxis1', label: 'Plane axis 1', kind: 'vec3', def: V(1, 0, 0) },
			{ key: 'position2', label: 'Position 2', kind: 'point3', def: V(0, 0, 0) },
			{ key: 'twistAxis2', label: 'Twist axis 2', kind: 'vec3', def: V(0, 1, 0) },
			{ key: 'planeAxis2', label: 'Plane axis 2', kind: 'vec3', def: V(1, 0, 0) },
			{
				key: 'swingType',
				label: 'Swing type',
				kind: 'enum',
				def: 'Cone',
				enumName: 'ESwingType',
				options: ['Cone', 'Pyramid']
			},
			{
				key: 'normalHalfConeAngle',
				label: 'Normal half cone (°)',
				kind: 'float',
				def: 45,
				min: 0,
				max: 180,
				unit: 'deg',
				section: 'limits'
			},
			{
				key: 'planeHalfConeAngle',
				label: 'Plane half cone (°)',
				kind: 'float',
				def: 45,
				min: 0,
				max: 180,
				unit: 'deg',
				section: 'limits'
			},
			{
				key: 'twistMinAngle',
				label: 'Twist min (°)',
				kind: 'float',
				def: -180,
				min: -180,
				max: 180,
				unit: 'deg',
				section: 'limits'
			},
			{
				key: 'twistMaxAngle',
				label: 'Twist max (°)',
				kind: 'float',
				def: 180,
				min: -180,
				max: 180,
				unit: 'deg',
				section: 'limits'
			},
			{
				key: 'maxFrictionTorque',
				label: 'Max friction torque',
				kind: 'float',
				def: 0,
				min: 0,
				section: 'limits'
			}
		]
	},
	SixDOF: {
		label: 'SixDOF',
		fields: [
			{ key: 'position1', label: 'Position 1', kind: 'point3', def: V(0, 0, 0) },
			{ key: 'axisX1', label: 'Axis X 1', kind: 'vec3', def: V(1, 0, 0) },
			{ key: 'axisY1', label: 'Axis Y 1', kind: 'vec3', def: V(0, 1, 0) },
			{ key: 'position2', label: 'Position 2', kind: 'point3', def: V(0, 0, 0) },
			{ key: 'axisX2', label: 'Axis X 2', kind: 'vec3', def: V(1, 0, 0) },
			{ key: 'axisY2', label: 'Axis Y 2', kind: 'vec3', def: V(0, 1, 0) },
			{
				key: 'limitMin',
				label: 'Limit min (6 axes)',
				kind: 'vec6',
				def: [null, null, null, null, null, null],
				section: 'limits'
			},
			{
				key: 'limitMax',
				label: 'Limit max (6 axes)',
				kind: 'vec6',
				def: [null, null, null, null, null, null],
				section: 'limits'
			}
		]
	},
	Pulley: {
		label: 'Pulley',
		fields: [
			{ key: 'bodyPoint1', label: 'Body point 1', kind: 'point3', def: V(0, 0, 0) },
			{ key: 'fixedPoint1', label: 'Fixed point 1', kind: 'point3', def: V(0, 8, 0) },
			{ key: 'bodyPoint2', label: 'Body point 2', kind: 'point3', def: V(0, 0, 0) },
			{ key: 'fixedPoint2', label: 'Fixed point 2', kind: 'point3', def: V(0, 8, 0) },
			{ key: 'ratio', label: 'Ratio', kind: 'float', def: 1, min: 0 },
			{
				key: 'minLength',
				label: 'Min length',
				kind: 'float',
				def: 0,
				min: 0,
				unit: 'm',
				section: 'limits'
			},
			{
				key: 'maxLength',
				label: 'Max length (empty = none)',
				kind: 'floatOrNull',
				def: null,
				min: 0,
				unit: 'm',
				section: 'limits'
			}
		]
	},
	Gear: {
		label: 'Gear',
		fields: [
			{ key: 'hingeAxis1', label: 'Hinge axis 1', kind: 'vec3', def: V(0, 1, 0) },
			{ key: 'hingeAxis2', label: 'Hinge axis 2', kind: 'vec3', def: V(0, 1, 0) },
			{ key: 'ratio', label: 'Ratio', kind: 'float', def: 1 }
		]
	},
	RackAndPinion: {
		label: 'RackAndPinion',
		fields: [
			{ key: 'hingeAxis', label: 'Hinge axis (pinion)', kind: 'vec3', def: V(0, 1, 0) },
			{ key: 'sliderAxis', label: 'Slider axis (rack)', kind: 'vec3', def: V(1, 0, 0) },
			{ key: 'ratio', label: 'Ratio (m per radian)', kind: 'float', def: 0.05 }
		]
	},
	Path: {
		label: 'Path',
		hasSpace: false,
		fields: [
			{ key: 'pathPosition', label: 'Path position', kind: 'pos3', def: V(0, 0, 0), section: 'path' },
			{
				key: 'pathRotation',
				label: 'Path rotation [x,y,z,w]',
				kind: 'quat',
				def: [0, 0, 0, 1],
				section: 'path'
			},
			{
				key: 'pathFraction',
				label: 'Start fraction (0..1)',
				kind: 'float',
				def: 0,
				min: 0,
				max: 1,
				section: 'path'
			},
			{
				key: 'rotationConstraintType',
				label: 'Rotation constraint',
				kind: 'enum',
				def: 'Free',
				enumName: 'EPathRotationConstraintType',
				options: [
					'Free',
					'ConstrainAroundTangent',
					'ConstrainAroundNormal',
					'ConstrainAroundBinormal',
					'ConstrainToPath',
					'FullyConstrained'
				],
				section: 'path'
			},
			{ key: 'maxFrictionForce', label: 'Max friction force', kind: 'float', def: 0, min: 0 },
			{
				key: 'pathPoints',
				label: 'Path points (one x,y,z per line)',
				kind: 'pathPoints',
				def: [],
				section: 'path'
			}
		]
	}
}

export const CONSTRAINT_TYPE_NAMES: string[] = Object.keys(CONSTRAINT_TYPES)

function makeId(): string {
	if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
	return 'jc_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

const POINT_KEYS_1 = new Set(['point1', 'position1', 'bodyPoint1'])
const POINT_KEYS_2 = new Set(['point2', 'position2', 'bodyPoint2'])

export interface AnchorContext {
	comA?: Vec3
	comB?: Vec3
}

// anchors: { comA:[bb units], comB:[bb units] }
export function makeConstraint(
	type: string,
	bodyA: string,
	bodyB: string,
	anchors: AnchorContext = {}
): ConstraintData {
	const meta = CONSTRAINT_TYPES[type]
	if (!meta) throw new Error(`Unknown constraint type: ${type}`)
	const comA: Vec3 = anchors.comA || [0, 0, 0]
	const comB: Vec3 = anchors.comB || [0, 0, 0]
	const constraint: ConstraintData = { id: makeId(), type, bodyA, bodyB, space: CONSTRAINT_SPACE }
	for (const field of meta.fields) {
		if (POINT_KEYS_1.has(field.key)) constraint[field.key] = comA.slice()
		else if (POINT_KEYS_2.has(field.key)) constraint[field.key] = comB.slice()
		else if (field.key === 'fixedPoint1') constraint[field.key] = [comA[0], comA[1] + 8, comA[2]]
		else if (field.key === 'fixedPoint2') constraint[field.key] = [comB[0], comB[1] + 8, comB[2]]
		else if (field.key === 'pathPoints') constraint[field.key] = [comA.slice(), comB.slice()]
		else if (field.kind === 'vec3' || field.kind === 'point3' || field.kind === 'pos3')
			constraint[field.key] = (field.def as Vec3).slice()
		else if (field.kind === 'quat') constraint[field.key] = (field.def as Quat).slice()
		else if (field.kind === 'vec6') constraint[field.key] = (field.def as (number | null)[]).slice()
		else constraint[field.key] = field.def
	}
	if (type === 'Distance') {
		constraint.maxDistance = Math.hypot(comB[0] - comA[0], comB[1] - comA[1], comB[2] - comA[2])
	}
	// Common optional field: break threshold (engine removes the constraint when the
	// constraint impulse exceeds it); unset = never breaks
	constraint.breakImpulse = null
	return constraint
}

function sanitizeVec3(value: unknown, fallback: Vec3): Vec3 {
	return Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)
		? value.slice()
		: fallback.slice()
}

export function sanitizeConstraint(raw: unknown): ConstraintData | null {
	if (!raw || typeof raw !== 'object') return null
	const r = raw as Record<string, unknown>
	const meta = CONSTRAINT_TYPES[r.type as string]
	if (!meta || typeof r.bodyA !== 'string' || typeof r.bodyB !== 'string') return null
	const out: ConstraintData = {
		id: typeof r.id === 'string' ? r.id : makeId(),
		type: r.type as string,
		bodyA: r.bodyA,
		bodyB: r.bodyB,
		space: CONSTRAINT_SPACE
	}
	// Common optional field: break threshold; empty / non-finite / <=0 collapses to null (never breaks)
	{
		const raw = r.breakImpulse
		const n = Number(raw)
		out.breakImpulse =
			raw !== null && raw !== undefined && raw !== '' && Number.isFinite(n) && n > 0 ? n : null
	}
	for (const field of meta.fields) {
		const value: unknown = r[field.key]
		switch (field.kind) {
			case 'vec3':
			case 'point3':
			case 'pos3':
				out[field.key] = sanitizeVec3(value, field.def as Vec3)
				break
			case 'quat':
				out[field.key] =
					Array.isArray(value) && value.length === 4 && value.every(Number.isFinite)
						? value.slice()
						: (field.def as Quat).slice()
				break
			case 'vec6':
				out[field.key] =
					Array.isArray(value) && value.length === 6
						? value.map(v =>
								v === null || v === undefined || v === '' || !Number.isFinite(Number(v))
									? null
									: Number(v)
							)
						: (field.def as (number | null)[]).slice()
				break
			case 'pathPoints':
				out[field.key] = Array.isArray(value)
					? (value as unknown[])
							.filter(
								(p): p is Vec3 =>
									Array.isArray(p) &&
									p.length === 3 &&
									(p as number[]).every(Number.isFinite)
							)
							.map(p => p.slice())
					: []
				break
			case 'floatOrNull': {
				const n = Number(value)
				if (value === null || value === undefined || value === '' || !Number.isFinite(n)) {
					out[field.key] = null
				} else {
					out[field.key] = field.min !== undefined ? Math.max(field.min, n) : n
				}
				break
			}
			case 'float': {
				const n = Number(value)
				let v = Number.isFinite(n) ? n : (field.def as number)
				if (field.min !== undefined) v = Math.max(field.min, v)
				if (field.max !== undefined) v = Math.min(field.max, v)
				out[field.key] = v
				break
			}
			case 'bool':
				out[field.key] = value === true
				break
			case 'enum':
				out[field.key] = field.options!.includes(value as string) ? value : field.def
				break
		}
	}
	return out
}

const DEG2RAD = Math.PI / 180

export function degreesToRadians(value: number | null): number | null {
	if (value === null || value === undefined) return null
	return value * DEG2RAD
}

export interface ExportedConstraint {
	type: string
	bodyA: string | number
	bodyB: string | number
	space?: string
	[key: string]: unknown
}

// Engine contract form: meters, radians, null limits preserved.
// This exact output is what a jolt-jni deserializer should be written against.
export function constraintToExport(constraint: ConstraintData, scale: number): ExportedConstraint {
	const meta = CONSTRAINT_TYPES[constraint.type]
	const out: ExportedConstraint = {
		type: constraint.type,
		bodyA: constraint.bodyA,
		bodyB: constraint.bodyB
	}
	if (meta.hasSpace !== false) out.space = 'WorldSpace'
	for (const field of meta.fields) {
		const value: unknown = constraint[field.key]
		if (value === undefined) continue
		switch (field.kind) {
			case 'point3':
			case 'pos3':
				out[field.key] = vec3Scaled(value as Vec3, scale)
				break
			case 'vec3':
			case 'quat':
				out[field.key] = (value as number[]).slice()
				break
			case 'vec6':
				out[field.key] = (value as (number | null)[]).map((v, i) =>
					v === null ? null : i < 3 ? v * scale : v * DEG2RAD
				)
				break
			case 'pathPoints':
				out[field.key] = (value as Vec3[]).map(p => vec3Scaled(p, scale))
				break
			case 'floatOrNull':
				if (value === null) {
					out[field.key] = null
					break
				}
				out[field.key] = convertUnit(value as number, field.unit, scale)
				break
			case 'float':
				out[field.key] = convertUnit(value as number, field.unit, scale)
				break
			case 'bool':
				out[field.key] = value
				break
			case 'enum':
				out[field.key] = value
				break
		}
	}
	// Break threshold rides along for simulation/bake sessions (engine reads it from the storage form)
	const breakImpulse = Number(constraint.breakImpulse)
	if (Number.isFinite(breakImpulse) && breakImpulse > 0) out.breakImpulse = breakImpulse
	return out
}

function vec3Scaled(v: Vec3, s: number): Vec3 {
	return [v[0] * s, v[1] * s, v[2] * s]
}

function convertUnit(value: number, unit: 'deg' | 'm' | undefined, scale: number): number {
	return unit === 'deg' ? value * DEG2RAD : unit === 'm' ? value * scale : value
}

export function describeConstraint(constraint: ConstraintData, bodyName?: (uuid: string) => string): string {
	const a = bodyName?.(constraint.bodyA) || constraint.bodyA.slice(0, 8)
	const b = bodyName?.(constraint.bodyB) || constraint.bodyB.slice(0, 8)
	return `${CONSTRAINT_TYPES[constraint.type]?.label || constraint.type}: ${a} ↔ ${b}`
}

// ---- gizmo anchor dragging (Godot set_handle equivalent) --------------------

/** Draggable anchor handles for one constraint (world space, BlockBench units). */
export interface ConstraintHandle {
	field: string
	index: number | null
	position: Vec3
	role: 'a' | 'b' | 'joint'
}

const DRAGGABLE_BY_TYPE: Record<string, { fields: { field: string; role: 'a' | 'b' | 'joint' }[] }> = {
	Fixed: {
		fields: [
			{ field: 'point1', role: 'a' },
			{ field: 'point2', role: 'b' }
		]
	},
	Distance: {
		fields: [
			{ field: 'point1', role: 'a' },
			{ field: 'point2', role: 'b' }
		]
	},
	Hinge: {
		fields: [
			{ field: 'point1', role: 'a' },
			{ field: 'point2', role: 'b' }
		]
	},
	Slider: {
		fields: [
			{ field: 'point1', role: 'a' },
			{ field: 'point2', role: 'b' }
		]
	},
	Point: {
		fields: [
			{ field: 'point1', role: 'a' },
			{ field: 'point2', role: 'b' }
		]
	},
	Cone: {
		fields: [
			{ field: 'point1', role: 'a' },
			{ field: 'point2', role: 'b' }
		]
	},
	SwingTwist: {
		fields: [
			{ field: 'position1', role: 'a' },
			{ field: 'position2', role: 'b' }
		]
	},
	SixDOF: {
		fields: [
			{ field: 'position1', role: 'a' },
			{ field: 'position2', role: 'b' }
		]
	},
	Pulley: {
		fields: [
			{ field: 'bodyPoint1', role: 'a' },
			{ field: 'fixedPoint1', role: 'joint' },
			{ field: 'fixedPoint2', role: 'joint' },
			{ field: 'bodyPoint2', role: 'b' }
		]
	},
	Path: { fields: [{ field: 'pathPosition', role: 'joint' }] }
}

export function buildConstraintHandles(c: ConstraintData): ConstraintHandle[] {
	const spec = DRAGGABLE_BY_TYPE[c.type]
	if (!spec) return []
	const out: ConstraintHandle[] = []
	for (const { field, role } of spec.fields) {
		const value = c[field]
		if (Array.isArray(value) && value.length === 3 && (value as number[]).every(Number.isFinite)) {
			out.push({ field, index: null, position: (value as Vec3).slice(), role })
		}
	}
	if (c.type === 'Path' && Array.isArray(c.pathPoints)) {
		const m = mat4Compose(
			vec(c.pathPosition, [0, 0, 0]),
			Array.isArray(c.pathRotation) ? (c.pathRotation as Quat) : [0, 0, 0, 1],
			[1, 1, 1]
		)
		;(c.pathPoints as Vec3[]).forEach((p, index) => {
			out.push({ field: 'pathPoints', index, position: transformPoint(m, p), role: 'joint' })
		})
	}
	return out
}

/**
 * Apply a dragged anchor position to a constraint. Path points arrive in world space and are
 * converted back into the path's local frame. Returns null when the field is not draggable.
 * Pure: input constraint is not mutated.
 */
export function moveConstraintHandle(
	c: ConstraintData,
	field: string,
	worldBB: Vec3,
	index: number | null = null
): ConstraintData | null {
	const updated: ConstraintData = { ...c }
	if (field === 'pathPoints') {
		if (
			!Array.isArray(c.pathPoints) ||
			index === null ||
			index < 0 ||
			index >= (c.pathPoints as Vec3[]).length
		)
			return null
		const inv = mat4Invert(
			mat4Compose(
				vec(c.pathPosition, [0, 0, 0]),
				Array.isArray(c.pathRotation) ? (c.pathRotation as Quat) : [0, 0, 0, 1],
				[1, 1, 1]
			)
		)
		const local = transformPoint(inv, worldBB)
		const points = (c.pathPoints as Vec3[]).map(p => p.slice())
		points[index] = local
		updated.pathPoints = points
		return updated
	}
	const spec = DRAGGABLE_BY_TYPE[c.type]
	if (!spec || !spec.fields.some(f => f.field === field)) return null
	const value = c[field]
	if (!Array.isArray(value) || value.length !== 3) return null
	updated[field] = worldBB.slice()
	return updated
}
