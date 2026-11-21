// Character / vehicle parameter editor. Controller params are SI units (meters, degrees —
// unlike constraint anchors which are BlockBench units); documented in docs/FORMAT.md.

import {
	CHARACTER_PARAMS,
	VEHICLE_PARAMS,
	SOFTBODY_PARAMS,
	HAIR_PARAMS,
	sanitizeControllerParams,
	controllerDefaults,
	type ControllerParamDef
} from '../core/controllers.ts'
import type { PhysicsStore } from '../core/store.ts'
import type { EditChannel } from '../core/edit_history.ts'
import { t } from './i18n.ts'
import { injectDialogStyles, enhanceDialogDom } from './constraint_dialog.ts'

type AnyBB = any

function bbGlobal(name: string): AnyBB {
	return (globalThis as any)[name] || (globalThis as any).Blockbench?.[name]
}

// Godot-inspector convention: camelCase property identifiers read as spaced words ("maxSlopeAngle" → "Max Slope Angle")
function humanize(key: string): string {
	return key.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replace(/^./, c => c.toUpperCase())
}

export interface ControllerDialogCtx {
	store: PhysicsStore
	history?: EditChannel | null
	uuid: string
	kind: 'character' | 'vehicle' | 'softbody' | 'hair'
	notifyChanged?(): void
}

export function openControllerDialog(ctx: ControllerDialogCtx): void {
	const Dialog = bbGlobal('Dialog')
	injectDialogStyles()
	const current = sanitizeControllerParams(ctx.kind, ctx.store.getBodyProps(ctx.uuid).controllerParams)
	const defaults = controllerDefaults(ctx.kind)
	const defs: ControllerParamDef[] =
		ctx.kind === 'character'
			? CHARACTER_PARAMS
			: ctx.kind === 'vehicle'
				? VEHICLE_PARAMS
				: ctx.kind === 'softbody'
					? SOFTBODY_PARAMS
					: HAIR_PARAMS
	const form: Record<string, any> = {
		header: { type: 'info', text: t('controller.header_' + ctx.kind), full_width: true }
	}
	const orderedKeys: string[] = ['header']
	const sectionOf = new Map<string, string | null>()
	let currentSection: string | null | undefined = undefined
	const addSectionHeader = (section: string | null | undefined) => {
		if (section === currentSection) return
		currentSection = section
		if (section) {
			form['__sep_' + section] = '_'
			form['__head_' + section] = { type: 'info', text: t('csection.' + section), full_width: true }
			orderedKeys.push('__sep_' + section, '__head_' + section)
			sectionOf.set('__sep_' + section, section)
			sectionOf.set('__head_' + section, section)
		}
	}
	for (const p of defs) {
		addSectionHeader(p.section)
		const labelKey = 'param.' + p.key
		const translated = t(labelKey)
		const label = translated === labelKey ? humanize(p.key) : translated
		sectionOf.set(p.key, currentSection ?? null)
		orderedKeys.push(p.key)
		if (Array.isArray(p.def)) {
			form[p.key] = {
				type: 'vector',
				dimensions: 3,
				label,
				value: (current[p.key] as number[]).slice()
			}
		} else if (typeof p.def === 'boolean') {
			form[p.key] = { type: 'checkbox', label, value: current[p.key] === true }
		} else if (typeof p.def === 'string') {
			form[p.key] = {
				type: 'select',
				label,
				options: Object.fromEntries(['None', 'Distance', 'Dihedral'].map(v => [v, t('bend.' + v)])),
				value: current[p.key] as string
			}
		} else {
			const unit = p.unit === 'm' ? ' (m)' : p.unit === 'deg' ? ' (°)' : ''
			form[p.key] = {
				type: 'number',
				label: label + unit,
				value: current[p.key] as number,
				min: p.min,
				max: p.max,
				step: Number.isInteger(p.def) ? 1 : 0.1
			}
		}
	}
	const revertSpecs = defs.map(p => ({
		key: p.key,
		isDefault:
			JSON.stringify(current[p.key] ?? null) === JSON.stringify(defaults[p.key] ?? null),
		revert: () => {
			const v = defaults[p.key]
			dialog.setFormValues({ [p.key]: Array.isArray(v) ? (v as number[]).slice() : v })
		}
	}))
	const dialog = new Dialog('behemiron_jolt_controller', {
		title: t('controller.dialog_title', t('controller.' + ctx.kind)),
		form,
		width: 520,
		onOpen() {
			enhanceDialogDom(dialog, orderedKeys, sectionOf, revertSpecs)
		},
		onConfirm(result: Record<string, any>) {
			const merged = sanitizeControllerParams(ctx.kind, { ...current, ...result })
			const write = () =>
				ctx.store.setBodyProps(ctx.uuid, {
					controllerParams: merged as Record<string, number | number[] | boolean>
				})
			if (ctx.history) ctx.history.push(t('controller.dialog_title', t('controller.' + ctx.kind)), null, write)
			else write()
			ctx.notifyChanged?.()
		}
	})
	dialog.show()
}
