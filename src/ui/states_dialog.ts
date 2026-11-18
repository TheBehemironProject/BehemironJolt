// Physics state presets manager: named groups of per-body motion overrides plus constraints
// to break on enter (ragdoll, prop-drop…). Data contract is engine-facing (see docs/FORMAT.md §5);
// this dialog is the authoring surface.

import type { ConstraintData, PhysicsStateDef } from '../core/store.ts'
import { describeConstraint } from '../core/constraints.ts'
import { t } from './i18n.ts'
import { injectDialogStyles } from './constraint_dialog.ts'

type AnyBB = any

function bbGlobal(name: string): AnyBB {
	return (globalThis as any)[name] || (globalThis as any).Blockbench?.[name]
}

export interface StatesDialogCtx {
	store: {
		listStates(): PhysicsStateDef[]
		getState(name: string): PhysicsStateDef | null
		upsertState(state: PhysicsStateDef): void
		removeState(name: string): void
		serialize(): { bodies: Record<string, unknown>; constraints: ConstraintData[] }
	}
	bodyDisplayName(uuid: string): string
	notifyChanged(): void
	showMessage(message: string): void
}

// List view: one button per state (opens the editor), plus "new state".
export function openStatesDialog(ctx: StatesDialogCtx): void {
	const Dialog = bbGlobal('Dialog')
	injectDialogStyles()
	const states = ctx.store.listStates()
	const form: Record<string, any> = {}
	if (!states.length) {
		form.header = { type: 'info', text: t('dialog.state_none'), full_width: true }
	}
	states.forEach((state, i) => {
		form[`state_${i}`] = {
			type: 'buttons',
			label: '',
			full_width: true,
			buttons: [
				`${state.name} (${Object.keys(state.bodies).length} bodies, ${state.breakConstraints.length} breaks)`
			],
			click() {
				openStateEditor(ctx, state.name)
			}
		}
	})
	form._new = {
		type: 'buttons',
		label: '',
		full_width: true,
		buttons: ['+'],
		click() {
			openStateEditor(ctx, null)
		}
	}
	new Dialog('behemiron_jolt_states', {
		title: t('dialog.states'),
		form,
		width: 480
	}).show()
}

// Editor: name + per-body "set Dynamic" checkboxes + per-constraint "break" checkboxes.
function openStateEditor(ctx: StatesDialogCtx, existingName: string | null): void {
	const Dialog = bbGlobal('Dialog')
	injectDialogStyles()
	const existing = existingName ? ctx.store.getState(existingName) : null
	const data = ctx.store.serialize()
	const bodyUuids = Object.keys(data.bodies)
	const constraints = data.constraints

	const form: Record<string, any> = {
		header: {
			type: 'info',
			text: existingName ? existingName : t('dialog.state_name'),
			full_width: true
		}
	}
	if (!existingName) {
		form.name = { type: 'text', label: t('dialog.state_name'), value: '', full_width: true }
	}
	if (bodyUuids.length) {
		form.__bodies_head = { type: 'info', text: t('dialog.state_bodies'), full_width: true }
		for (const uuid of bodyUuids) {
			form[`body_${uuid}`] = {
				type: 'checkbox',
				label: `${ctx.bodyDisplayName(uuid)} → Dynamic`,
				value: !!existing?.bodies[uuid]
			}
		}
	}
	if (constraints.length) {
		form.__break_head = { type: 'info', text: t('dialog.state_break'), full_width: true }
		for (const c of constraints) {
			form[`break_${c.id}`] = {
				type: 'checkbox',
				label: describeConstraint(c, ctx.bodyDisplayName),
				value: existing?.breakConstraints.includes(c.id) ?? false
			}
		}
	}
	if (existingName) {
		form._delete = { type: 'checkbox', label: t('dialog.delete'), value: false }
	}

	new Dialog('behemiron_jolt_state_edit', {
		title: t('dialog.states'),
		form,
		width: 520,
		onConfirm(result: Record<string, any>) {
			if (result._delete) {
				ctx.store.removeState(existingName as string)
				ctx.showMessage(t('msg.state_removed'))
				ctx.notifyChanged()
				return
			}
			const name = (existingName || String(result.name || '').trim()) as string
			if (!name) return
			const bodies: PhysicsStateDef['bodies'] = {}
			for (const uuid of bodyUuids) {
				if (result[`body_${uuid}`] === true || result[`body_${uuid}`] === 'true') {
					bodies[uuid] = { motionType: 'Dynamic' }
				}
			}
			const breakConstraints = constraints
				.filter(c => result[`break_${c.id}`] === true || result[`break_${c.id}`] === 'true')
				.map(c => c.id)
			ctx.store.upsertState({ name, bodies, breakConstraints })
			ctx.showMessage(t('msg.state_saved'))
			ctx.notifyChanged()
		}
	}).show()
}
