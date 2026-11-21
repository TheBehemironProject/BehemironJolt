import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createStore } from '../src/core/store.ts'
import { createEditHistory, HISTORY_ORIGIN } from '../src/core/edit_history.ts'

test('store.subscribe emits per-kind events with origin', () => {
	const store = createStore()
	const events = []
	const off = store.subscribe(change => events.push(change))
	const origin = Symbol('test')
	store.setBodyProps('b1', { friction: 0.5 }, origin)
	store.setSettings({ unitsPerMeter: 32 })
	store.upsertConstraint({ id: 'c1', type: 'Point', bodyA: 'a', bodyB: 'b', space: 'WorldSpace' }, origin)
	store.reset()
	assert.equal(events.length, 4)
	assert.equal(events[0].kind, 'bodies')
	assert.equal(events[0].origin, origin)
	assert.deepEqual(events[0].uuids, ['b1'])
	assert.equal(events[1].kind, 'settings')
	assert.equal(events[1].origin, undefined)
	assert.equal(events[2].kind, 'constraints')
	assert.equal(events[3].kind, 'load')
	off()
	store.setBodyProps('b2', { friction: 0.1 })
	assert.equal(events.length, 4)
})

// minimal Blockbench Undo stand-in: history array + undo/redo events like BB's (undo.js:226/247)
function makeFakeBB() {
	const listeners = { undo: [], redo: [] }
	const bb = {
		history: [],
		index: 0,
		initEdit() {},
		finishEdit(message) {
			const entry = { action: message }
			bb.history.push(entry)
			bb.index = bb.history.length
			return entry
		},
		addListener(name, cb) {
			listeners[name].push(cb)
		},
		removeListener(name, cb) {
			listeners[name] = listeners[name].filter(f => f !== cb)
		},
		undo() {
			if (bb.index < 1) return
			bb.index--
			for (const cb of listeners.undo) cb({ entry: bb.history[bb.index] })
		},
		redo() {
			if (bb.index >= bb.history.length) return
			const entry = bb.history[bb.index]
			bb.index++
			for (const cb of listeners.redo) cb({ entry })
		}
	}
	return bb
}

test('edit history: push creates one undo entry, undo/redo restore snapshots', () => {
	const store = createStore()
	const bb = makeFakeBB()
	const history = createEditHistory(store, bb)
	store.setBodyProps('g1', { friction: 0.2 })

	history.push('edit friction', null, () => store.setBodyProps('g1', { friction: 0.9 }, 'ui'))
	assert.equal(store.getBodyProps('g1').friction, 0.9)
	assert.equal(bb.history.length, 1)

	history.push('edit friction again', null, () => store.setBodyProps('g1', { friction: 0.7 }, 'ui'))
	assert.equal(bb.history.length, 2)

	bb.undo()
	assert.equal(store.getBodyProps('g1').friction, 0.9, 'first undo restores the middle state')
	bb.undo()
	assert.equal(store.getBodyProps('g1').friction, 0.2, 'second undo restores the initial state')
	bb.redo()
	assert.equal(store.getBodyProps('g1').friction, 0.9)
	bb.redo()
	assert.equal(store.getBodyProps('g1').friction, 0.7)
	history.dispose()
})

test('edit history: same mergeKey within the window collapses into one entry', () => {
	const store = createStore()
	const bb = makeFakeBB()
	const history = createEditHistory(store, bb)
	const write = v => () => store.setBodyProps('g1', { friction: v }, 'ui')
	history.push('friction', 'g1:friction', write(0.3))
	history.push('friction', 'g1:friction', write(0.4))
	history.push('friction', 'g1:friction', write(0.5))
	assert.equal(bb.history.length, 1, 'three merged writes = one undo entry')
	assert.equal(store.getBodyProps('g1').friction, 0.5)
	bb.undo()
	assert.equal(store.getBodyProps('g1').friction, 0.2, 'undo jumps back over the whole merged run')
	history.dispose()
})

test('edit history: different mergeKeys do not merge', () => {
	const store = createStore()
	const bb = makeFakeBB()
	const history = createEditHistory(store, bb)
	history.push('friction', 'g1:friction', () => store.setBodyProps('g1', { friction: 0.3 }, 'ui'))
	history.push('restitution', 'g1:restitution', () => store.setBodyProps('g1', { restitution: 0.5 }, 'ui'))
	assert.equal(bb.history.length, 2)
	history.dispose()
})

test('edit history: HISTORY_ORIGIN marks snapshot application', () => {
	const store = createStore()
	const bb = makeFakeBB()
	const history = createEditHistory(store, bb)
	const origins = []
	store.subscribe(change => origins.push(change.origin))
	history.push('friction', null, () => store.setBodyProps('g1', { friction: 0.3 }, 'ui'))
	bb.undo()
	assert.ok(origins.includes(HISTORY_ORIGIN))
	assert.ok(origins.includes('ui'))
	history.dispose()
})
