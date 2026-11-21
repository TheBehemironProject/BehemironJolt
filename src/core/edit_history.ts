// Snapshot-based undo for physics data, riding Blockbench's history as aspect-free entries.
// Every edit flows through push(): it captures a store snapshot before/after, and (unless merged)
// wraps the write in Undo.initEdit({}) / finishEdit(label, {}) so Ctrl+Z / Ctrl+Y just work
// alongside native Blockbench edits. Edits sharing a mergeKey within MERGE_WINDOW collapse into
// one entry (Godot MERGE_ENDS semantics: continuous slider/typing = single undo step).

import type { PhysicsStore, StoreData, StoreOrigin } from './store.ts'

export interface EditHistoryBB {
	initEdit(aspects: Record<string, never>): void
	finishEdit(message: string, aspects: Record<string, never>): unknown
	addListener(name: 'undo' | 'redo', cb: (data: { entry: unknown }) => void): void
	removeListener(name: 'undo' | 'redo', cb: (data: { entry: unknown }) => void): void
	/**
	 * Current Blockbench undo-stack position (Undo.index). When present, merging is
	 * refused once the stack moved (a native edit landed, or an undo/redo happened) —
	 * extending a buried entry would put its undo out of order.
	 */
	position?(): number
}

export interface EditChannel {
	/** Run `write` as one undoable edit (or merge into the previous entry when mergeKey matches). */
	push(label: string, mergeKey: string | null, write: () => void): void
}

export interface EditHistory extends EditChannel {
	/** Raw store write without history (project load/reset, external reconciliation). */
	skip(write: () => void): void
	/** True while the history itself is applying a snapshot (undo/redo) — guards re-entrant pushes. */
	isApplying(): boolean
	dispose(): void
}

const MERGE_WINDOW = 800

interface EntrySnapshots {
	before: StoreData
	after: StoreData
}

export function createEditHistory(store: PhysicsStore, bb: EditHistoryBB): EditHistory {
	const snapshots = new WeakMap<object, EntrySnapshots>()
	let lastMergeKey: string | null = null
	let lastMergeTime = 0
	let lastEntry: unknown = null
	let lastEntryIndex = -1
	let applying = false

	function applySnapshot(snap: StoreData | undefined): void {
		if (!snap) return
		applying = true
		try {
			store.load(snap, HISTORY_ORIGIN)
		} finally {
			applying = false
		}
	}
	const undoCb = ({ entry }: { entry: unknown }) => {
		applySnapshot(entry && typeof entry === 'object' ? snapshots.get(entry as object)?.before : undefined)
	}
	const redoCb = ({ entry }: { entry: unknown }) => {
		applySnapshot(entry && typeof entry === 'object' ? snapshots.get(entry as object)?.after : undefined)
	}

	bb.addListener('undo', undoCb)
	bb.addListener('redo', redoCb)

	return {
		push(label: string, mergeKey: string | null, write: () => void): void {
			if (applying) {
				write()
				return
			}
			const now = Date.now()
			const stackUnmoved = !bb.position || bb.position() === lastEntryIndex
			if (
				mergeKey &&
				lastEntry &&
				stackUnmoved &&
				mergeKey === lastMergeKey &&
				now - lastMergeTime < MERGE_WINDOW
			) {
				// extend the open entry: same undo step, new after-state
				write()
				const snap = snapshots.get(lastEntry as object)
				if (snap) snap.after = store.serialize()
				lastMergeTime = now
				return
			}
			const before = store.serialize()
			bb.initEdit({})
			write()
			const entry = bb.finishEdit(label, {})
			snapshots.set(entry as object, { before, after: store.serialize() })
			lastEntry = entry
			lastMergeKey = mergeKey
			lastMergeTime = now
			lastEntryIndex = bb.position ? bb.position() : -1
		},
		skip(write: () => void): void {
			write()
		},
		isApplying(): boolean {
			return applying
		},
		dispose(): void {
			bb.removeListener('undo', undoCb)
			bb.removeListener('redo', redoCb)
		}
	}
}

/** Origin marker for history-applied snapshots (undo/redo) */
export const HISTORY_ORIGIN: StoreOrigin = 'edit_history'
