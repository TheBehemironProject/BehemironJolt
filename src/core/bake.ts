// Bake engine-ready physics data (meters, radians, jolt-jni-shaped) — reference implementation
// of the docs/FORMAT.md contract for the Java/jolt-jni deserializer.

import { buildPhysicsFromSnapshot, type Snapshot } from './pipeline.ts'
import { exportAsset, type PhysicsAsset } from './export.ts'
import { sanitizeConstraint } from './constraints.ts'
import type { PhysicsStore } from './store.ts'

export interface BakeResult {
	asset: PhysicsAsset | null
	errors: string[]
	warnings: string[]
	skipped: string[]
}

export function bakePhysicsAsset(snapshot: Snapshot, store: PhysicsStore, name: string): BakeResult {
	const pipeline = buildPhysicsFromSnapshot(snapshot, store)
	const bodies = pipeline.bodyDescs.filter(b => b.shape)
	const constraints = store
		.listConstraints()
		.map(c => sanitizeConstraint(c))
		.filter((c): c is NonNullable<typeof c> => !!c)
	const validationErrors = store.validate(
		pipeline.bodyDescs.map(b => b.uuid),
		snapshot.elements.map(e => e.uuid)
	)
	const { asset, errors, warnings } = exportAsset({
		name,
		settings: pipeline.settings,
		bodies,
		constraints
	})
	return {
		asset: errors.length ? null : asset,
		errors: [...validationErrors, ...errors],
		warnings,
		skipped: pipeline.skipped
	}
}
