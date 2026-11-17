// Character / vehicle parameter editor. Controller params are SI units (meters, degrees —
// unlike constraint anchors which are BlockBench units); documented in docs/FORMAT.md.

import {
	CHARACTER_PARAMS,
	VEHICLE_PARAMS,
	SOFTBODY_PARAMS,
	HAIR_PARAMS,
	sanitizeControllerParams,
	type ControllerParamDef
} from '../core/controllers.ts'
import type { PhysicsStore } from '../core/store.ts'
import { t } from './i18n.ts'

type AnyBB = any

function bbGlobal(name: string): AnyBB {
	return (globalThis as any)[name] || (globalThis as any).Blockbench?.[name]
}

export interface ControllerDialogCtx {
	store: PhysicsStore
	uuid: string
	kind: 'character' | 'vehicle' | 'softbody' | 'hair'
	notifyChanged?(): void
}

export function openControllerDialog(ctx: ControllerDialogCtx): void {
	const Dialog = bbGlobal('Dialog')
	const current = sanitizeControllerParams(ctx.kind, ctx.store.getBodyProps(ctx.uuid).controllerParams)
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
	let currentSection: string | null | undefined = undefined
	const addSectionHeader = (section: string | null | undefined) => {
		if (section === currentSection) return
		currentSection = section
		if (section) {
			form['__sep_' + section] = '_'
			form['__head_' + section] = { type: 'info', text: t('csection.' + section), full_width: true }
		}
	}
	for (const p of defs) {
		addSectionHeader(p.section)
		if (Array.isArray(p.def)) {
			form[p.key] = {
				type: 'vector',
				dimensions: 3,
				label: p.key,
				value: (current[p.key] as number[]).slice()
			}
		} else if (typeof p.def === 'boolean') {
			form[p.key] = { type: 'checkbox', label: p.key, value: current[p.key] === true }
		} else if (typeof p.def === 'string') {
			form[p.key] = {
				type: 'select',
				label: p.key,
				options: { None: 'None', Distance: 'Distance', Dihedral: 'Dihedral' },
				value: current[p.key] as string
			}
		} else {
			const unit = p.unit === 'm' ? ' (m)' : p.unit === 'deg' ? ' (°)' : ''
			form[p.key] = {
				type: 'number',
				label: p.key + unit,
				value: current[p.key] as number,
				min: p.min,
				max: p.max,
				step: Number.isInteger(p.def) ? 1 : 0.1
			}
		}
	}
	const dialog = new Dialog('behemiron_jolt_controller', {
		title: t('controller.dialog_title', t('controller.' + ctx.kind)),
		form,
		width: 520,
		onConfirm(result: Record<string, any>) {
			const merged = sanitizeControllerParams(ctx.kind, { ...current, ...result })
			ctx.store.setBodyProps(ctx.uuid, {
				controllerParams: merged as Record<string, number | number[] | boolean>
			})
			ctx.notifyChanged?.()
		}
	})
	dialog.show()
}
