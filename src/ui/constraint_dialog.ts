// Constraint creation wizard + editor dialog.
// Anchors auto-fill with the two bodies' centers; angles are degrees in the UI (radians in store).

import {
	CONSTRAINT_TYPES,
	CONSTRAINT_TYPE_NAMES,
	makeConstraint,
	sanitizeConstraint,
	describeConstraint,
	type ConstraintTypeMeta
} from '../core/constraints.ts'
import type { ConstraintData } from '../core/store.ts'
import type { EditChannel } from '../core/edit_history.ts'
import { t, typeLabel, fieldLabel, tip } from './i18n.ts'
import type { SelectionResult } from '../bb/adapter.ts'
import type { Vec3 } from '../util/math.ts'

type AnyBB = any

export interface EditorCtx {
	store: {
		listConstraints(): ConstraintData[]
		getConstraint(id: string): ConstraintData | null
		upsertConstraint(c: ConstraintData, origin?: unknown): string
		removeConstraint(id: string, origin?: unknown): void
	}
	history?: EditChannel | null
	getSelection(): SelectionResult
	estimateGroupCom(group: AnyBB): Vec3
	bodyDisplayName(uuid: string): string
	showMessage(message: string, timeout?: number): void
	notifyChanged(): void
}

function bbGlobal(name: string): AnyBB {
	return (globalThis as any)[name] || (globalThis as any).Blockbench?.[name]
}

let dialogStylesInjected = false
// Godot-inspector style grouping inside our dialogs: section titles get an accent bar, the summary
// header line gets the accent tint. Scoped to this plugin's <dialog id="behemiron_jolt_*"> nodes.
export function injectDialogStyles(): void {
	if (dialogStylesInjected) return
	dialogStylesInjected = true
	// hot reload re-evaluates the module (flag resets) — replace by id instead of stacking <style> tags
	document.getElementById('behemiron_jolt_dialog_styles')?.remove()
	const css = `
		dialog[id^='behemiron_jolt_'] .form_bar_header .small_text { color: var(--color-accent); font-weight: 600; }
		dialog[id^='behemiron_jolt_'] [class*='form_bar___head_'] .small_text {
			display: block; margin-top: 10px; padding: 4px 0 4px 9px;
			border-left: 3px solid var(--color-accent);
			font-weight: 600; letter-spacing: 0.05em; opacity: 0.9;
		}
		dialog[id^='behemiron_jolt_'] .bj-section-head { cursor: pointer; user-select: none; position: relative; }
		dialog[id^='behemiron_jolt_'] .bj-section-head .small_text::before { content: '▾ '; opacity: 0.55; }
		dialog[id^='behemiron_jolt_'] .bj-section-head.collapsed .small_text::before { content: '▸ '; }
		dialog[id^='behemiron_jolt_'] .bj-section-reset {
			position: absolute; right: 4px; top: 2px;
			border: none; background: none; padding: 0 2px; font-size: 11px; opacity: 0.45; cursor: pointer; line-height: 1;
		}
		dialog[id^='behemiron_jolt_'] .bj-section-reset:hover { opacity: 1; color: var(--color-accent); }
		dialog[id^='behemiron_jolt_'] .bj-revert {
			border: none; background: none; padding: 0 2px; font-size: 10px; opacity: 0.45; cursor: pointer; line-height: 1;
		}
		dialog[id^='behemiron_jolt_'] .bj-revert:hover { opacity: 1; color: var(--color-accent); }
		dialog[id^='behemiron_jolt_'] .form_bar label { display: inline-flex; align-items: center; gap: 2px; }
	`
	const style = document.createElement('style')
	style.id = 'behemiron_jolt_dialog_styles'
	style.textContent = css
	document.head.appendChild(style)
}

function parseVec6(text: unknown, fallback: (number | null)[]): (number | null)[] {
	if (typeof text !== 'string' || !text.trim()) return fallback.slice()
	const parts = text.split(',').map(s => s.trim())
	if (parts.length !== 6) return fallback.slice()
	return parts.map(s => (s === '' || s === 'null' || Number.isNaN(Number(s)) ? null : Number(s)))
}

function parsePathPoints(text: unknown): Vec3[] {
	if (typeof text !== 'string' || !text.trim()) return []
	return text
		.split('\n')
		.map(line => line.split(',').map(s => Number(s.trim())))
		.filter(p => p.length === 3 && p.every(Number.isFinite))
}

function formatVec6(values: (number | null)[]): string {
	return values.map(v => (v === null || v === undefined ? '' : v)).join(',')
}

// Post-build DOM enhancement shared by the constraint and controller dialogs:
// section headers become collapsible and get a per-section Reset; non-default fields get a
// revert arrow in their label. `sectionOf` maps form keys → section name (null = not in any).
export function enhanceDialogDom(
	dialog: AnyBB,
	orderedKeys: string[],
	sectionOf: Map<string, string | null>,
	revertSpecs: { key: string; isDefault: boolean; revert: () => void }[]
): void {
	const formNode: HTMLElement | null | undefined = dialog.form?.node
	if (!formNode) return
	const children = Array.from(formNode.children)
	const barOf = (key: string): HTMLElement | undefined =>
		children.find(el => (el as HTMLElement).classList?.contains('form_bar_' + key)) as
			| HTMLElement
			| undefined
	// collapse + reset, one block per section in first-appearance order
	const sections: { name: string; head: HTMLElement; rows: HTMLElement[] }[] = []
	for (const key of orderedKeys) {
		const section = sectionOf.get(key)
		if (!section) continue
		const bar = barOf(key)
		let block = sections.find(s => s.name === section)
		if (!block) {
			const head = barOf('__head_' + section)
			if (!head) continue
			head.classList.add('bj-section-head')
			const newBlock: { name: string; head: HTMLElement; rows: HTMLElement[] } = {
				name: section,
				head,
				rows: []
			}
			block = newBlock
			sections.push(newBlock)
			let collapsed = false
			head.addEventListener('click', event => {
				if ((event.target as HTMLElement).closest('.bj-section-reset')) return
				collapsed = !collapsed
				head.classList.toggle('collapsed', collapsed)
				for (const row of newBlock.rows) row.style.display = collapsed ? 'none' : ''
			})
			const reset = document.createElement('button')
			reset.type = 'button'
			reset.className = 'bj-section-reset'
			reset.title = t('panel.section_reset')
			reset.textContent = '↺'
			reset.addEventListener('click', event => {
				event.stopPropagation()
				for (const spec of revertSpecs) {
					if (sectionOf.get(spec.key) === section && !spec.isDefault) spec.revert()
				}
			})
			head.append(reset)
		}
		if (bar && bar !== block.head) block.rows.push(bar)
	}
	for (const spec of revertSpecs) {
		if (spec.isDefault) continue
		const bar = barOf(spec.key)
		const label = bar?.querySelector('label')
		if (!label) continue
		const btn = document.createElement('button')
		btn.type = 'button'
		btn.className = 'bj-revert'
		btn.title = t('panel.revert_default')
		btn.textContent = '↺'
		btn.addEventListener('click', event => {
			event.preventDefault()
			spec.revert()
		})
		label.append(btn)
	}
}

// ctx: editor dependencies
export function openConstraintWizard(ctx: EditorCtx): void {
	const Dialog = bbGlobal('Dialog')
	injectDialogStyles()
	const groups = ctx.getSelection().groups
	if (groups.length !== 2) {
		ctx.showMessage(t('msg.select_two_groups'))
		return
	}
	const [gA, gB] = groups
	const comA = ctx.estimateGroupCom(gA)
	const comB = ctx.estimateGroupCom(gB)

	const typeDialog = new Dialog('behemiron_jolt_constraint_type', {
		title: t('dialog.new_constraint'),
		form: {
			info: { type: 'info', text: `${gA.name} ↔ ${gB.name}` },
			type: {
				type: 'select',
				label: t('dialog.constraint_type'),
				options: Object.fromEntries(CONSTRAINT_TYPE_NAMES.map(name => [name, typeLabel(name)]))
			},
			anchor_info: { type: 'info', text: t('dialog.anchor_info') }
		},
		onConfirm(result: Record<string, string>) {
			const constraint = makeConstraint(result.type, gA.uuid, gB.uuid, { comA, comB })
			openConstraintEditor(ctx, constraint)
		}
	})
	typeDialog.show()
}

// editor: if constraint.id already in store → prefill and update on confirm; else insert.
export function openConstraintEditor(ctx: EditorCtx, constraint: ConstraintData): void {
	const Dialog = bbGlobal('Dialog')
	injectDialogStyles()
	const meta: ConstraintTypeMeta = CONSTRAINT_TYPES[constraint.type]
	const existing = !!ctx.store.getConstraint(constraint.id)

	const form: Record<string, any> = {
		header: { type: 'info', text: describeConstraint(constraint, ctx.bodyDisplayName), full_width: true }
	}
	const orderedKeys: string[] = ['header']
	const sectionOf = new Map<string, string | null>()
	let currentSection: string | null | undefined = undefined
	const addSectionHeader = (section: string | null | undefined): void => {
		if (section === currentSection) return
		currentSection = section
		if (section) {
			form['__sep_' + section] = '_'
			form['__head_' + section] = { type: 'info', text: t('section.' + section), full_width: true }
			orderedKeys.push('__sep_' + section, '__head_' + section)
			sectionOf.set('__sep_' + section, section)
			sectionOf.set('__head_' + section, section)
		}
	}
	for (const field of meta.fields) {
		addSectionHeader(field.section ?? (field.kind === 'point3' ? 'anchors' : null))
		const value: unknown = constraint[field.key]
		const label = fieldLabel(field.labelKey || field.key, field.label)
		const tipText = tip(field.key)
		sectionOf.set(field.key, currentSection ?? null)
		orderedKeys.push(field.key)
		if (field.kind === 'point3' || field.kind === 'pos3' || field.kind === 'vec3') {
			const isPoint = field.kind !== 'vec3'
			form[field.key] = {
				type: 'vector',
				label: label + (isPoint ? t('field.model_units') : ''),
				dimensions: 3,
				value: Array.isArray(value) ? (value as number[]).slice() : (field.def as number[]).slice()
			}
		} else if (field.kind === 'quat') {
			form[field.key] = {
				type: 'vector',
				label,
				dimensions: 4,
				value: Array.isArray(value) ? (value as number[]).slice() : (field.def as number[]).slice()
			}
		} else if (field.kind === 'pathPoints') {
			form[field.key] = {
				type: 'textarea',
				label: t('dialog.path_label', label),
				description: tipText,
				value: (Array.isArray(value) ? (value as Vec3[]) : []).map(p => p.join(',')).join('\n'),
				height: 80
			}
		} else if (field.kind === 'vec6') {
			form[field.key] = {
				type: 'textarea',
				label: t('dialog.vec6_label', label),
				value: formatVec6(
					Array.isArray(value) ? (value as (number | null)[]) : (field.def as (number | null)[])
				),
				height: 40
			}
		} else if (field.kind === 'floatOrNull') {
			// text input: BB number inputs coerce '' → 0 (NumericInput), which would silently turn
			// "no limit" into limit 0 on an untouched confirm; text preserves the empty state
			form[field.key] = {
				type: 'text',
				label: label + t('field.no_limit'),
				description: tipText,
				value: value === null || value === undefined ? '' : String(value)
			}
		} else if (field.kind === 'float') {
			form[field.key] = {
				type: 'number',
				label,
				description: tipText,
				value,
				min: field.min,
				max: field.max,
				step: field.step || 0.1
			}
		} else if (field.kind === 'bool') {
			form[field.key] = { type: 'checkbox', label, value }
		} else if (field.kind === 'enum') {
			form[field.key] = {
				type: 'select',
				label,
				description: tipText,
				options: Object.fromEntries((field.options || []).map(o => [o, t('enum.' + o)])),
				value
			}
		}
	}
	// Common optional field (all types): break threshold, floatOrNull semantics like limits
	form.breakImpulse = {
		type: 'text',
		label: t('panel.break_impulse') + t('field.no_limit'),
		description: tip('breakImpulse'),
		value:
			constraint.breakImpulse === null || constraint.breakImpulse === undefined
				? ''
				: String(constraint.breakImpulse)
	}
	orderedKeys.push('breakImpulse')
	sectionOf.set('breakImpulse', currentSection ?? null)
	if (existing) {
		form._delete = { type: 'checkbox', label: t('dialog.delete'), value: false }
		orderedKeys.push('_delete')
	}

	const revertSpecs = meta.fields
		.filter(f => f.kind !== 'vec6' && f.kind !== 'pathPoints')
		.map(f => ({
			key: f.key,
			isDefault:
				JSON.stringify(constraint[f.key] ?? null) === JSON.stringify(f.def ?? null),
			revert: () => {
				const v = f.def
				dialog.setFormValues({ [f.key]: Array.isArray(v) ? (v as number[]).slice() : v })
			}
		}))

	const commit = (write: () => void) => {
		if (ctx.history) ctx.history.push(t('dialog.constraint', typeLabel(constraint.type)), null, write)
		else write()
	}

	const dialog = new Dialog('behemiron_jolt_constraint_edit', {
		title: t('dialog.constraint', typeLabel(constraint.type)),
		form,
		width: 520,
		onOpen() {
			enhanceDialogDom(dialog, orderedKeys, sectionOf, revertSpecs)
		},
		onConfirm(result: Record<string, any>) {
			if (result._delete) {
				commit(() => ctx.store.removeConstraint(constraint.id))
				ctx.showMessage(t('msg.constraint_deleted'))
				ctx.notifyChanged()
				return
			}
			const updated: ConstraintData = {
				id: constraint.id,
				type: constraint.type,
				bodyA: constraint.bodyA,
				bodyB: constraint.bodyB,
				space: constraint.space
			}
			{
				const raw = result.breakImpulse
				updated.breakImpulse =
					raw === '' || raw === null || raw === undefined || Number.isNaN(Number(raw))
						? null
						: Number(raw)
			}
			for (const field of meta.fields) {
				let value: unknown = result[field.key]
				if (field.kind === 'point3' || field.kind === 'pos3' || field.kind === 'vec3') {
					value = Array.isArray(value) ? (value as number[]).map(Number) : constraint[field.key]
				} else if (field.kind === 'quat') {
					value =
						Array.isArray(value) && value.length === 4
							? (value as number[]).map(Number)
							: constraint[field.key]
				} else if (field.kind === 'pathPoints') {
					value = parsePathPoints(value)
				} else if (field.kind === 'vec6') {
					value = parseVec6(value, constraint[field.key] as (number | null)[])
				} else if (field.kind === 'floatOrNull') {
					value =
						value === '' || value === null || value === undefined || Number.isNaN(Number(value))
							? null
							: Number(value)
				} else if (field.kind === 'float') {
					value = Number(value)
				} else if (field.kind === 'bool') {
					value = !!value
				}
				updated[field.key] = value
			}
			const clean = sanitizeConstraint(updated)
			if (!clean) {
				ctx.showMessage(t('msg.invalid_constraint'))
				return
			}
			commit(() => ctx.store.upsertConstraint(clean))
			ctx.showMessage(existing ? t('msg.constraint_updated') : t('msg.constraint_created'))
			ctx.notifyChanged()
		}
	})
	dialog.show()
}
