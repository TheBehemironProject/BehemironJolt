import { test } from 'node:test'
import assert from 'node:assert/strict'
import { t, __tables, initI18n, shapeLabel, typeLabel, fieldLabel } from '../src/ui/i18n.ts'

// node has no Blockbench globals: t() must fall back to the EN table
test('t() falls back to English without Blockbench globals', () => {
	assert.equal(t('panel.friction'), 'Friction')
	assert.equal(t('shape.box'), 'Box')
	assert.equal(t('type.Hinge'), 'Hinge')
})

test('t() substitutes positional variables', () => {
	assert.equal(t('panel.status', 3, 7), 'Bodies: 3 · Constraints: 7')
	assert.equal(t('panel.body', 'arm'), 'Body: arm')
})

test('missing key falls back to the key itself (and warns)', () => {
	assert.equal(t('does.not.exist'), 'does.not.exist')
})

test('ZH table covers every EN key (and vice versa)', () => {
	const enKeys = Object.keys(__tables.EN).sort()
	const zhKeys = Object.keys(__tables.ZH).sort()
	const missingZh = enKeys.filter(k => !__tables.ZH[k])
	const missingEn = zhKeys.filter(k => !__tables.EN[k])
	assert.deepEqual(missingZh, [], `EN keys missing in ZH: ${missingZh.join(', ')}`)
	assert.deepEqual(missingEn, [], `ZH keys missing in EN: ${missingEn.join(', ')}`)
})

test('initI18n is a no-op without Blockbench (no throw)', () => {
	assert.doesNotThrow(() => initI18n())
})

test('label helpers resolve known and unknown keys', () => {
	assert.equal(shapeLabel('convex_hull'), 'Convex Hull')
	assert.equal(typeLabel('RackAndPinion'), 'RackAndPinion')
	assert.equal(fieldLabel('hingeAxis1', 'Hinge axis 1'), 'Hinge axis 1')
	assert.equal(fieldLabel('totallyUnknown', 'Fallback Label'), 'Fallback Label')
})
