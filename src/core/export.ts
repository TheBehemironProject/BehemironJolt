// Assemble the Jolt asset JSON. Pure logic.
// Field names follow jolt-jni setter names so the Java loader is a mechanical mapping.

import { FORMAT_VERSION, type Settings, type BodyProps, type ConstraintData } from './store.ts'
import { constraintToExport, type ExportedConstraint } from './constraints.ts'
import type { BodyDesc } from './pipeline.ts'
import type { ShapeNode } from './shapes.ts'

export interface AssetBodyEntry {
	name: string
	node: string
	shape: ShapeNode
	position: number[]
	rotation: number[]
	motionType: string
	objectLayer: number
	friction: number
	restitution: number
	linearDamping: number
	angularDamping: number
	gravityFactor: number
	isSensor: boolean
	allowSleeping: boolean
	motionQuality: string
	overrideMassProperties: string
	massPropertiesOverride?: { mass: number }
}

export interface PhysicsAsset {
	format: 'behemiron-jolt-asset'
	formatVersion: number
	name: string
	unitsPerMeter: number
	gravity: number[]
	bodies: AssetBodyEntry[]
	constraints: ExportedConstraint[]
}

export interface ExportResult {
	asset: PhysicsAsset
	errors: string[]
	warnings: string[]
}

export function exportAsset({
	name,
	settings,
	bodies,
	constraints
}: {
	name: string
	settings: Settings
	bodies: BodyDesc[]
	constraints: ConstraintData[]
}): ExportResult {
	const errors: string[] = []
	const warnings: string[] = []
	const scale = 1 / settings.unitsPerMeter

	const asset: PhysicsAsset = {
		format: 'behemiron-jolt-asset',
		formatVersion: FORMAT_VERSION,
		name: name || 'unnamed',
		unitsPerMeter: settings.unitsPerMeter,
		gravity: settings.gravity.slice(),
		bodies: [],
		constraints: []
	}

	const bodyIndex = new Map<string, number>()
	bodies.forEach((body, index) => {
		bodyIndex.set(body.uuid, index)
	})

	for (const body of bodies) {
		if (!body.shape) {
			errors.push(
				`Body "${body.name}" has no physical shapes (all elements set to 'none' or degenerate)`
			)
			continue
		}
		const props: BodyProps = body.props
		const entry: AssetBodyEntry = {
			name: body.name,
			node: body.uuid,
			shape: body.shape,
			position: body.position,
			rotation: body.rotation,
			motionType: props.motionType,
			objectLayer: props.objectLayer,
			friction: props.friction,
			restitution: props.restitution,
			linearDamping: props.linearDamping,
			angularDamping: props.angularDamping,
			gravityFactor: props.gravityFactor,
			isSensor: props.isSensor,
			allowSleeping: props.allowSleeping,
			motionQuality: props.motionQuality,
			overrideMassProperties:
				props.overrideMassProperties === 'MassAndInertiaProvided'
					? 'CalculateInertia'
					: props.overrideMassProperties
		}
		if (props.overrideMassProperties === 'MassAndInertiaProvided') {
			warnings.push(
				`Body "${body.name}": full inertia override not supported yet, exported as CalculateInertia with mass`
			)
		}
		if (entry.overrideMassProperties !== 'CalculateMassAndInertia') {
			entry.massPropertiesOverride = { mass: props.mass }
		}
		asset.bodies.push(entry)
	}

	for (const constraint of constraints) {
		const exported = constraintToExport(constraint, scale)
		const missing = [exported.bodyA, exported.bodyB].filter(ref => !bodyIndex.has(String(ref)))
		if (missing.length) {
			errors.push(
				`Constraint ${constraint.id.slice(0, 8)}… (${constraint.type}) references missing body: ${missing.join(', ')}`
			)
			continue
		}
		exported.bodyA = bodyIndex.get(String(exported.bodyA)) as number
		exported.bodyB = bodyIndex.get(String(exported.bodyB)) as number
		asset.constraints.push(exported)
	}

	return { asset, errors, warnings }
}
