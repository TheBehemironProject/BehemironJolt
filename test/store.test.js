import { test } from 'node:test'
import assert from 'node:assert/strict'
import {
	createStore,
	DEFAULT_BODY_PROPS,
	DEFAULT_ELEMENT_PROPS,
	sanitizeBodyProps
} from '../src/core/store.ts'

test('store defaults for unknown uuids', () => {
	const store = createStore()
	assert.deepEqual(store.getElementProps('nope'), { ...DEFAULT_ELEMENT_PROPS })
	assert.deepEqual(store.getBodyProps('nope'), { ...DEFAULT_BODY_PROPS })
})

test('setElementProps merges and sanitizes', () => {
	const store = createStore()
	store.setElementProps('u1', { shape: 'sphere', density: -5 })
	assert.equal(store.getElementProps('u1').shape, 'sphere')
	assert.ok(store.getElementProps('u1').density > 0)
	store.setElementProps('u1', { shape: 'bogus' })
	assert.equal(store.getElementProps('u1').shape, 'auto')
})

test('body props clamp to ranges', () => {
	const props = sanitizeBodyProps({ friction: 5, restitution: -1, motionType: 'Weird', objectLayer: 3.7 })
	assert.equal(props.friction, 1)
	assert.equal(props.restitution, 0)
	assert.equal(props.motionType, 'Dynamic')
	assert.equal(props.objectLayer, 3.7)
})

test('constraint upsert/remove/list', () => {
	const store = createStore()
	const id = store.upsertConstraint({
		id: 'c1',
		type: 'Hinge',
		bodyA: 'a',
		bodyB: 'b',
		space: 'WorldSpace',
		point1: [0, 0, 0],
		point2: [1, 0, 0]
	})
	assert.equal(id, 'c1')
	assert.equal(store.listConstraints().length, 1)
	store.upsertConstraint({
		id: 'c1',
		type: 'Hinge',
		bodyA: 'a',
		bodyB: 'b',
		space: 'WorldSpace',
		point1: [5, 0, 0],
		point2: [1, 0, 0]
	})
	assert.equal(store.listConstraints().length, 1)
	assert.deepEqual(store.getConstraint('c1').point1, [5, 0, 0])
	store.removeConstraint('c1')
	assert.equal(store.listConstraints().length, 0)
})

test('serialize/load roundtrip', () => {
	const store = createStore()
	store.setBodyProps('g1', { motionType: 'Static', friction: 0.9 })
	store.setElementProps('e1', { shape: 'convex_hull' })
	store.upsertConstraint({
		id: 'c1',
		type: 'Point',
		bodyA: 'g1',
		bodyB: 'g2',
		space: 'WorldSpace',
		point1: [1, 2, 3],
		point2: [4, 5, 6]
	})
	store.setSettings({ unitsPerMeter: 32 })
	const raw = store.serialize()
	const store2 = createStore()
	store2.load(JSON.parse(JSON.stringify(raw)))
	assert.equal(store2.getBodyProps('g1').motionType, 'Static')
	assert.equal(store2.getElementProps('e1').shape, 'convex_hull')
	assert.equal(store2.listConstraints()[0].type, 'Point')
	assert.equal(store2.getSettings().unitsPerMeter, 32)
})

test('load tolerates garbage', () => {
	const store = createStore()
	store.load(null)
	store.load({
		elements: { e: { shape: 42, density: 'x' } },
		bodies: { b: { friction: 'NaNy' } },
		constraints: 'nope',
		settings: { unitsPerMeter: -1 }
	})
	assert.equal(store.getElementProps('e').shape, 'auto')
	assert.equal(store.getBodyProps('b').friction, DEFAULT_BODY_PROPS.friction)
	assert.equal(store.listConstraints().length, 0)
	assert.equal(store.getSettings().unitsPerMeter, 0.0001)
})

test('validate catches dangling constraint refs', () => {
	const store = createStore()
	store.upsertConstraint({
		id: 'c1',
		type: 'Point',
		bodyA: 'missing',
		bodyB: 'also-missing',
		space: 'WorldSpace',
		point1: [0, 0, 0],
		point2: [0, 0, 0]
	})
	const errors = store.validate(['body1'], [])
	assert.equal(errors.length, 1)
	assert.ok(errors[0].includes('missing'))
})

test('body collisionGroup clamps and selfCollide defaults', () => {
	const store = createStore()
	store.setBodyProps('b', { collisionGroup: 999999, selfCollide: true })
	assert.equal(store.getBodyProps('b').collisionGroup, 0xffff)
	assert.equal(store.getBodyProps('b').selfCollide, true)
	assert.equal(store.getBodyProps('other').collisionGroup, 0)
	assert.equal(store.getBodyProps('other').selfCollide, false)
})

test('physics states round-trip through serialize/load', () => {
	const store = createStore()
	store.setBodyProps('torso', { motionType: 'Kinematic' })
	store.upsertState({
		name: 'ragdoll',
		bodies: { torso: { motionType: 'Dynamic' } },
		breakConstraints: ['c_prop']
	})
	const serialized = store.serialize()
	assert.ok(serialized.states)
	assert.equal(serialized.states.ragdoll.bodies.torso.motionType, 'Dynamic')
	assert.equal(serialized.states.ragdoll.bodies.torso.friction, undefined, 'unlisted keys stay unlisted')

	const reloaded = createStore()
	reloaded.load(JSON.parse(JSON.stringify(serialized)))
	const state = reloaded.getState('ragdoll')
	assert.ok(state)
	assert.equal(state.bodies.torso.motionType, 'Dynamic')
	assert.deepEqual(state.breakConstraints, ['c_prop'])
	assert.equal(reloaded.listStates().length, 1)
})

test('physics state sanitize: garbage bodies dropped, unnamed rejected', () => {
	const store = createStore()
	store.upsertState({
		name: '  ',
		bodies: { x: { motionType: 'Dynamic' } },
		breakConstraints: ['c']
	})
	assert.equal(store.listStates().length, 0)

	store.upsertState({
		name: 'ok',
		bodies: { x: { motionType: 'Bogus', friction: 42 }, bad: null },
		breakConstraints: ['c', 7, 'd']
	})
	const state = store.getState('ok')
	assert.ok(state)
	assert.equal(state.bodies.x.motionType, 'Dynamic', 'bogus enum falls back')
	assert.equal(state.bodies.x.friction, 1, 'clamped to [0,1]')
	assert.equal(state.bodies.bad, undefined)
	assert.deepEqual(state.breakConstraints, ['c', 'd'])
})
