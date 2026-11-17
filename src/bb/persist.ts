// Persist physics annotations into the .bbmodel project file via Blockbench's project events.

import type { PhysicsStore } from '../core/store.ts'

export function attachPersist(store: PhysicsStore): () => void {
	const onSave = ({ model }: { model: any }) => {
		model.jolt_physics = store.serialize()
	}
	const onLoad = ({ model }: { model: any }) => {
		store.load(model?.jolt_physics)
	}
	const onNew = () => {
		store.reset()
	}
	Blockbench.addListener('save_project', onSave)
	Blockbench.addListener('load_project', onLoad)
	Blockbench.addListener('new_project', onNew)
	return () => {
		Blockbench.removeListener('save_project', onSave)
		Blockbench.removeListener('load_project', onLoad)
		Blockbench.removeListener('new_project', onNew)
	}
}
