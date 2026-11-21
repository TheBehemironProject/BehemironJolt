// Physics state presets manager: named groups of per-body motion overrides plus constraints
// to break on enter (ragdoll, prop-drop…). Data contract is engine-facing (see docs/FORMAT.md §5);
// this dialog is the authoring surface.
//
// Single-dialog design: the list and the editor are two form layouts of the SAME dialog —
// no stacked modals. Edit/rename inline, delete via a confirm message box, refresh on
// behemiron_jolt_refresh keeps the list in sync with the store behind it.

import type { ConstraintData, PhysicsStateDef } from '../core/store.ts'
import type { EditChannel } from '../core/edit_history.ts'
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
		upsertState(state: PhysicsStateDef, origin?: unknown): void
		removeState(name: string, origin?: unknown): void
		serialize(): { bodies: Record<string, unknown>; constraints: ConstraintData[] }
	}
	history?: EditChannel | null
	bodyDisplayName(uuid: string): string
	notifyChanged(): void
	showMessage(message: string): void
}

const BTN_EDIT = '✎'
const BTN_DELETE = '✕'

export function openStatesDialog(ctx: StatesDialogCtx): void {
	const Dialog = bbGlobal('Dialog')
	const InputForm = bbGlobal('InputForm')
	const Blockbench = bbGlobal('Blockbench')
	injectDialogStyles()

	// false = list view, null = editor for a new state, string = editor for that state
	let mode: string | null | false = false

	const listForm = (): Record<string, any> => {
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
					`${state.name} (${t('dialog.state_summary', Object.keys(state.bodies).length, state.breakConstraints.length)})`,
					BTN_EDIT,
					BTN_DELETE
				],
				click(btn: number) {
					if (btn === 0 || btn === 1) {
						mode = state.name
					} else {
						confirmDelete(state.name)
						return
					}
					render()
				}
			}
		})
		form._new = {
			type: 'buttons',
			label: '',
			full_width: true,
			buttons: [t('dialog.state_new')],
			click() {
				mode = null
				render()
			}
		}
		return form
	}

	const editorForm = (existingName: string | null): Record<string, any> => {
		const existing = existingName ? ctx.store.getState(existingName) : null
		const data = ctx.store.serialize()
		const bodyUuids = Object.keys(data.bodies)
		const constraints = data.constraints
		const form: Record<string, any> = {
			header: {
				type: 'info',
				text: existingName ? t('dialog.state_edit', existingName) : t('dialog.state_name'),
				full_width: true
			},
			name: {
				type: 'text',
				label: t('dialog.state_name'),
				value: existingName || '',
				full_width: true
			}
		}
		if (bodyUuids.length) {
			form.__bodies_head = { type: 'info', text: t('dialog.state_bodies'), full_width: true }
			for (const uuid of bodyUuids) {
				form[`body_${uuid}`] = {
					type: 'checkbox',
					label: `${ctx.bodyDisplayName(uuid)} → ${t('motion.Dynamic')}`,
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
		form._actions = {
			type: 'buttons',
			label: '',
			full_width: true,
			buttons: [t('dialog.state_save'), t('dialog.state_cancel')],
			click(btn: number) {
				if (btn === 0) save(existingName)
				else {
					mode = false
					render()
				}
			}
		}
		return form
	}

	const save = (existingName: string | null) => {
		const data = ctx.store.serialize()
		const bodyUuids = Object.keys(data.bodies)
		const constraints = data.constraints
		const res = dialog.form.getResult()
		const name = String(res.name || '').trim()
		if (!name) return
		const bodies: PhysicsStateDef['bodies'] = {}
		for (const uuid of bodyUuids) {
			if (res[`body_${uuid}`] === true || res[`body_${uuid}`] === 'true') {
				bodies[uuid] = { motionType: 'Dynamic' }
			}
		}
		const breakConstraints = constraints
			.filter(c => res[`break_${c.id}`] === true || res[`break_${c.id}`] === 'true')
			.map(c => c.id)
		const write = () => {
			ctx.store.upsertState({ name, bodies, breakConstraints })
			if (existingName && existingName !== name) ctx.store.removeState(existingName)
		}
		if (ctx.history) ctx.history.push(t('dialog.states'), null, write)
		else write()
		ctx.showMessage(t('msg.state_saved'))
		ctx.notifyChanged()
		mode = false
		render()
	}

	const confirmDelete = (name: string) => {
		Blockbench?.showMessageBox?.(
			{
				title: t('dialog.states'),
				message: t('msg.state_delete_confirm', name),
				icon: 'warning',
				buttons: ['behemiron_jolt.dialog.state_delete', 'dialog.cancel'],
				confirmIndex: 0,
				cancelIndex: 1
			},
			(button: number | string) => {
				if (button !== 0 && button !== 'behemiron_jolt.dialog.state_delete') return
				const write = () => ctx.store.removeState(name)
				if (ctx.history) ctx.history.push(t('dialog.states'), null, write)
				else write()
				ctx.showMessage(t('msg.state_removed'))
				ctx.notifyChanged()
				render()
			}
		)
	}

	const dialog = new Dialog('behemiron_jolt_states', {
		title: t('dialog.states'),
		form: listForm(),
		width: 480,
		onClose() {
			Blockbench?.removeListener?.('behemiron_jolt_refresh', render)
		}
	})

	// keyboard access for the list view: ↑/↓ move focus across rows, Enter opens the editor,
	// Delete asks for the row's state to be deleted (each row is open/edit/delete buttons)
	dialog.object?.addEventListener?.('keydown', (event: KeyboardEvent) => {
		if (mode !== false) return
		const active = document.activeElement as HTMLElement | null
		const row = active?.closest?.('.dialog_form_buttons')
		if (!row || !dialog.object.contains(row)) return
		const rows = Array.from(
			dialog.object.querySelectorAll('.dialog_form_buttons')
		) as HTMLElement[]
		const rowIndex = rows.indexOf(row as HTMLElement)
		if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
			event.preventDefault()
			const delta = event.key === 'ArrowDown' ? 1 : -1
			const next = rows[(rowIndex + delta + rows.length) % rows.length]
			;(next?.querySelector('button') as HTMLElement | null)?.focus()
		} else if (event.key === 'Enter') {
			event.preventDefault()
			;(row.querySelector('button') as HTMLElement | null)?.click()
		} else if (event.key === 'Delete') {
			event.preventDefault()
			const del = Array.from(row.querySelectorAll('button')).find(
				b => b.textContent === BTN_DELETE
			)
			;(del as HTMLElement | undefined)?.click()
		}
	})

	function render(): void {
		const content: HTMLElement | null | undefined = dialog.object?.querySelector?.('.dialog_content')
		if (!content) return
		const form = mode === false ? listForm() : editorForm(mode)
		dialog.form?.delete?.()
		dialog.form = new InputForm(form)
		content.append(dialog.form.node)
	}

	Blockbench?.addListener?.('behemiron_jolt_refresh', render)
	dialog.show()
}
