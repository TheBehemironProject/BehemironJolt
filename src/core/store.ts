// Physics data model. Pure logic: no BlockBench / THREE / Jolt imports. Keyed by outliner UUIDs.

export const FORMAT_VERSION = 1

export const SHAPE_TYPES = [
	'auto',
	'box',
	'sphere',
	'capsule',
	'tapered_capsule',
	'cylinder',
	'tapered_cylinder',
	'convex_hull',
	'mesh',
	'none'
] as const
export type ShapeType = (typeof SHAPE_TYPES)[number]

export const MOTION_TYPES = ['Static', 'Kinematic', 'Dynamic'] as const
export type MotionType = (typeof MOTION_TYPES)[number]

export const MOTION_QUALITIES = ['Discrete', 'LinearCast'] as const
export type MotionQuality = (typeof MOTION_QUALITIES)[number]

export const OVERRIDE_MODES = [
	'CalculateMassAndInertia',
	'CalculateInertia',
	'MassAndInertiaProvided'
] as const
export type OverrideMode = (typeof OVERRIDE_MODES)[number]

export interface ElementProps {
	shape: ShapeType
	density: number
}

export interface BodyProps {
	motionType: MotionType
	objectLayer: number
	friction: number
	restitution: number
	linearDamping: number
	angularDamping: number
	gravityFactor: number
	isSensor: boolean
	allowSleeping: boolean
	motionQuality: MotionQuality
	overrideMassProperties: OverrideMode
	mass: number
	inertiaMultiplier: number
	/** B3: drive this kinematic body from the Blockbench animation while simulating */
	animationDriven: boolean
	/** B4: special controller attached to this body */
	controller: ControllerType
	/** B4: controller parameters (character/vehicle); defaults merged at use time */
	controllerParams: Record<string, number | number[] | boolean>
	/** collision group id: bodies in the same group never collide with each other (0 = no grouping) */
	collisionGroup: number
	/** true = this body collides with other bodies of the same model instance (default off) */
	selfCollide: boolean
}

/** Runtime physics state preset: per-body motion overrides applied as a group (ragdoll, prop-drop…). */
export interface PhysicsStateDef {
	name: string
	/** per-outliner-uuid body overrides; only listed keys replace the base body's props */
	bodies: Record<string, Partial<BodyProps>>
	/** constraint ids removed when the state activates (e.g. detach props) */
	breakConstraints: string[]
}
export const CONTROLLER_TYPES = ['none', 'character', 'vehicle', 'softbody', 'hair'] as const
export type ControllerType = (typeof CONTROLLER_TYPES)[number]

export interface Settings {
	unitsPerMeter: number
	gravity: number[]
	groundEnabled: boolean
}

/** Loose constraint record: fields beyond the common set are type-specific (see core/constraints.js) */
export interface ConstraintData {
	id: string
	type: string
	bodyA: string
	bodyB: string
	space: string
	/** impulse threshold (N·s) at which the engine removes this constraint; null/absent/0/negative = never */
	breakImpulse?: number | null
	[key: string]: unknown
}

export interface StoreData {
	version: number
	elements: Record<string, ElementProps>
	bodies: Record<string, BodyProps>
	constraints: ConstraintData[]
	settings: Settings
	/** named runtime physics states (ragdoll groups etc.); absent in old files = none */
	states?: Record<string, PhysicsStateDef>
}

export interface StoreCounts {
	elements: number
	bodies: number
	constraints: number
}

export interface PhysicsStore {
	getElementProps(uuid: string): ElementProps
	setElementProps(uuid: string, patch: Partial<ElementProps>): void
	getBodyProps(uuid: string): BodyProps
	setBodyProps(uuid: string, patch: Partial<BodyProps>): void
	listConstraints(): ConstraintData[]
	getConstraint(id: string): ConstraintData | null
	upsertConstraint(constraint: ConstraintData): string
	removeConstraint(id: string): void
	getSettings(): Settings
	setSettings(patch: Partial<Settings>): void
	listStates(): PhysicsStateDef[]
	getState(name: string): PhysicsStateDef | null
	upsertState(state: PhysicsStateDef): void
	removeState(name: string): void
	counts(): StoreCounts
	serialize(): StoreData
	load(raw: unknown): void
	reset(): void
	validate(bodyUuids: string[], elementUuids: string[]): string[]
}

export const DEFAULT_ELEMENT_PROPS: ElementProps = Object.freeze({ shape: 'auto', density: 1000 })

export const DEFAULT_BODY_PROPS: BodyProps = Object.freeze({
	motionType: 'Dynamic',
	objectLayer: 1,
	friction: 0.2,
	restitution: 0,
	linearDamping: 0.05,
	angularDamping: 0.05,
	gravityFactor: 1,
	isSensor: false,
	allowSleeping: true,
	motionQuality: 'Discrete',
	overrideMassProperties: 'CalculateMassAndInertia',
	mass: 1,
	inertiaMultiplier: 1,
	animationDriven: false,
	controller: 'none',
	controllerParams: {},
	collisionGroup: 0,
	selfCollide: false
})

export const DEFAULT_SETTINGS: Settings = Object.freeze({
	unitsPerMeter: 16,
	gravity: [0, -9.81, 0],
	groundEnabled: true
})

const BODY_NUMBER_RANGES: Record<string, [number, number]> = {
	objectLayer: [0, 0xffff],
	friction: [0, 1],
	restitution: [0, 1],
	linearDamping: [0, 100],
	angularDamping: [0, 100],
	gravityFactor: [-100, 100],
	mass: [0.000001, 1e12],
	inertiaMultiplier: [0.000001, 1e6],
	collisionGroup: [0, 0xffff]
}

function coerceBoolean(value: unknown, fallback: boolean): boolean {
	return typeof value === 'boolean' ? value : fallback
}

function coerceNumber(value: unknown, fallback: number, range?: [number, number]): number {
	const n = Number(value)
	if (!Number.isFinite(n)) return fallback
	if (range) return Math.min(range[1], Math.max(range[0], n))
	return n
}

function coerceEnum<T extends string>(value: unknown, allowed: readonly T[], fallback: T): T {
	return (allowed as readonly string[]).includes(value as string) ? (value as T) : fallback
}

function coerceVec3(value: unknown, fallback: number[]): number[] {
	if (Array.isArray(value) && value.length === 3 && value.every(Number.isFinite)) return value.slice()
	return fallback.slice()
}

export function sanitizeElementProps(raw: unknown): ElementProps {
	const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
	return {
		shape: coerceEnum(r.shape, SHAPE_TYPES, DEFAULT_ELEMENT_PROPS.shape),
		density: coerceNumber(r.density, DEFAULT_ELEMENT_PROPS.density, [0.000001, 1e12])
	}
}

export function sanitizeBodyProps(raw: unknown): BodyProps {
	const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
	const out: Record<string, boolean | number | string> = {}
	out.isSensor = coerceBoolean(r.isSensor, DEFAULT_BODY_PROPS.isSensor)
	out.allowSleeping = coerceBoolean(r.allowSleeping, DEFAULT_BODY_PROPS.allowSleeping)
	out.animationDriven = coerceBoolean(r.animationDriven, DEFAULT_BODY_PROPS.animationDriven)
	out.controller = coerceEnum(r.controller, CONTROLLER_TYPES, DEFAULT_BODY_PROPS.controller)
	out.controllerParams =
		r.controllerParams && typeof r.controllerParams === 'object' && !Array.isArray(r.controllerParams)
			? JSON.parse(JSON.stringify(r.controllerParams))
			: {}
	for (const key of Object.keys(BODY_NUMBER_RANGES)) {
		out[key] = coerceNumber(
			r[key],
			(DEFAULT_BODY_PROPS as unknown as Record<string, number>)[key],
			BODY_NUMBER_RANGES[key]
		)
	}
	out.motionType = coerceEnum(r.motionType, MOTION_TYPES, DEFAULT_BODY_PROPS.motionType)
	out.motionQuality = coerceEnum(r.motionQuality, MOTION_QUALITIES, DEFAULT_BODY_PROPS.motionQuality)
	out.selfCollide = coerceBoolean(r.selfCollide, DEFAULT_BODY_PROPS.selfCollide)
	out.overrideMassProperties = coerceEnum(
		r.overrideMassProperties,
		OVERRIDE_MODES,
		DEFAULT_BODY_PROPS.overrideMassProperties
	)
	return out as unknown as BodyProps
}

/** State preset sanitize: non-empty name, per-body overrides validated key-by-key,
 * breakConstraints keeps string ids only. */
export function sanitizePhysicsState(raw: unknown): PhysicsStateDef | null {
	const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : null
	if (!r || typeof r.name !== 'string' || !r.name.trim()) return null
	const bodies: Record<string, Partial<BodyProps>> = {}
	if (r.bodies && typeof r.bodies === 'object' && !Array.isArray(r.bodies)) {
		for (const [uuid, patchRaw] of Object.entries(r.bodies as Record<string, unknown>)) {
			if (!uuid || patchRaw === null || typeof patchRaw !== 'object' || Array.isArray(patchRaw))
				continue
			// Validate each present key (clamped to its range) but carry only keys that actually
			// appear in the patch — unlisted keys must not shadow the base body's values.
			const sanitized = sanitizeBodyProps(patchRaw)
			const override: Partial<BodyProps> = {}
			for (const key of Object.keys(patchRaw)) {
				if (key in sanitized)
					(override as unknown as Record<string, unknown>)[key] = (
						sanitized as unknown as Record<string, unknown>
					)[key]
			}
			bodies[uuid] = override
		}
	}
	const breakConstraints = Array.isArray(r.breakConstraints)
		? (r.breakConstraints as unknown[]).filter((v): v is string => typeof v === 'string')
		: []
	return { name: r.name.trim(), bodies, breakConstraints }
}

export function sanitizeSettings(raw: unknown): Settings {
	const r = (raw && typeof raw === 'object' ? raw : {}) as Record<string, unknown>
	return {
		unitsPerMeter: coerceNumber(r.unitsPerMeter, DEFAULT_SETTINGS.unitsPerMeter, [0.0001, 100000]),
		gravity: coerceVec3(r.gravity, DEFAULT_SETTINGS.gravity),
		groundEnabled: coerceBoolean(r.groundEnabled, DEFAULT_SETTINGS.groundEnabled)
	}
}

function makeId(): string {
	if (globalThis.crypto?.randomUUID) return globalThis.crypto.randomUUID()
	return 'jc_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export function createStore(): PhysicsStore {
	let data: StoreData = freshData()

	function freshData(): StoreData {
		return {
			version: FORMAT_VERSION,
			elements: {},
			bodies: {},
			constraints: [],
			settings: { ...DEFAULT_SETTINGS },
			states: {}
		}
	}

	const store: PhysicsStore = {
		getElementProps(uuid: string): ElementProps {
			return data.elements[uuid] ? { ...data.elements[uuid] } : { ...DEFAULT_ELEMENT_PROPS }
		},
		setElementProps(uuid: string, patch: Partial<ElementProps>) {
			data.elements[uuid] = sanitizeElementProps({ ...data.elements[uuid], ...patch })
		},
		getBodyProps(uuid: string): BodyProps {
			return data.bodies[uuid] ? { ...data.bodies[uuid] } : { ...DEFAULT_BODY_PROPS }
		},
		setBodyProps(uuid: string, patch: Partial<BodyProps>) {
			data.bodies[uuid] = sanitizeBodyProps({ ...data.bodies[uuid], ...patch })
		},
		listConstraints(): ConstraintData[] {
			return data.constraints.map(c => ({ ...c }))
		},
		getConstraint(id: string): ConstraintData | null {
			const c = data.constraints.find(c => c.id === id)
			return c ? { ...c } : null
		},
		upsertConstraint(constraint: ConstraintData): string {
			const clean: ConstraintData = { ...constraint, id: constraint.id || makeId() }
			const index = data.constraints.findIndex(c => c.id === clean.id)
			if (index >= 0) data.constraints[index] = clean
			else data.constraints.push(clean)
			return clean.id
		},
		removeConstraint(id: string) {
			const index = data.constraints.findIndex(c => c.id === id)
			if (index >= 0) data.constraints.splice(index, 1)
		},
		getSettings(): Settings {
			return { ...data.settings, gravity: data.settings.gravity.slice() }
		},
		setSettings(patch: Partial<Settings>) {
			data.settings = sanitizeSettings({ ...data.settings, ...patch })
		},
		listStates(): PhysicsStateDef[] {
			return Object.values(data.states ?? {}).map(s => ({
				name: s.name,
				bodies: JSON.parse(JSON.stringify(s.bodies)),
				breakConstraints: s.breakConstraints.slice()
			}))
		},
		getState(name: string): PhysicsStateDef | null {
			const s = data.states?.[name]
			return s
				? {
						name: s.name,
						bodies: JSON.parse(JSON.stringify(s.bodies)),
						breakConstraints: s.breakConstraints.slice()
					}
				: null
		},
		upsertState(state: PhysicsStateDef) {
			const clean = sanitizePhysicsState(state)
			if (clean && data.states) data.states[clean.name] = clean
		},
		removeState(name: string) {
			if (data.states) delete data.states[name]
		},
		counts(): StoreCounts {
			return {
				elements: Object.keys(data.elements).length,
				bodies: Object.keys(data.bodies).length,
				constraints: data.constraints.length
			}
		},
		serialize(): StoreData {
			return JSON.parse(JSON.stringify(data))
		},
		load(raw: unknown) {
			data = freshData()
			if (!raw || typeof raw !== 'object') return
			const r = raw as Record<string, unknown>
			if (r.elements && typeof r.elements === 'object') {
				for (const [uuid, props] of Object.entries(r.elements as Record<string, unknown>)) {
					data.elements[uuid] = sanitizeElementProps(props)
				}
			}
			if (r.bodies && typeof r.bodies === 'object') {
				for (const [uuid, props] of Object.entries(r.bodies as Record<string, unknown>)) {
					data.bodies[uuid] = sanitizeBodyProps(props)
				}
			}
			if (Array.isArray(r.constraints)) {
				data.constraints = (r.constraints as unknown[])
					.filter(
						(c): c is ConstraintData =>
							!!c && typeof c === 'object' && typeof (c as ConstraintData).type === 'string'
					)
					.map(c => ({ ...c }))
			}
			if (r.settings) data.settings = sanitizeSettings(r.settings)
			if (r.states && typeof r.states === 'object' && !Array.isArray(r.states)) {
				for (const [name, raw] of Object.entries(r.states as Record<string, unknown>)) {
					const clean = sanitizePhysicsState({
						...(raw as object),
						name: (raw as { name?: unknown })?.name ?? name
					})
					if (clean && data.states) data.states[clean.name] = clean
				}
			}
		},
		reset() {
			data = freshData()
		},
		validate(_bodyUuids: string[], _elementUuids: string[]): string[] {
			const errors: string[] = []
			const bodySet = new Set(_bodyUuids)
			for (const c of data.constraints) {
				if (!bodySet.has(c.bodyA) || !bodySet.has(c.bodyB)) {
					errors.push(`Constraint "${c.id}" references a missing body (${c.type})`)
				}
			}
			for (const uuid of Object.keys(data.bodies)) {
				if (!bodySet.has(uuid)) {
					errors.push(
						`Body properties set on node that is not a physics body (${uuid.slice(0, 8)}…)`
					)
				}
			}
			if (!Number.isFinite(data.settings.unitsPerMeter) || data.settings.unitsPerMeter <= 0) {
				errors.push('unitsPerMeter must be positive')
			}
			return errors
		}
	}
	return store
}
