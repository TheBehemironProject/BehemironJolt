// Constraint creation wizard + editor dialog.
// Anchors auto-fill with the two bodies' centers; angles are degrees in the UI (radians in store/export).

import {
	CONSTRAINT_TYPES,
	CONSTRAINT_TYPE_NAMES,
	makeConstraint,
	sanitizeConstraint,
	describeConstraint,
	type ConstraintTypeMeta
} from '../core/constraints.ts'
import type { ConstraintData } from '../core/store.ts'
import { t, typeLabel, fieldLabel } from './i18n.ts'
import type { SelectionResult } from '../bb/adapter.ts'
import type { Vec3 } from '../util/math.ts'

type AnyBB = any

export interface EditorCtx {
	store: {
		listConstraints(): ConstraintData[]
		getConstraint(id: string): ConstraintData | null
		upsertConstraint(c: ConstraintData): string
		removeConstraint(id: string): void
	}
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
	let currentSection: string | null | undefined = undefined
	const addSectionHeader = (section: string | null | undefined): void => {
		if (section === currentSection) return
		currentSection = section
		if (section) {
			form['__sep_' + section] = '_'
			form['__head_' + section] = { type: 'info', text: t('section.' + section), full_width: true }
		}
	}
	for (const field of meta.fields) {
		addSectionHeader(field.section ?? (field.kind === 'point3' ? 'anchors' : null))
		const value: unknown = constraint[field.key]
		const label = fieldLabel(field.labelKey || field.key, field.label)
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
				value: value === null || value === undefined ? '' : String(value)
			}
		} else if (field.kind === 'float') {
			form[field.key] = {
				type: 'number',
				label,
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
				options: Object.fromEntries((field.options || []).map(o => [o, t('enum.' + o)])),
				value
			}
		}
	}
	// Common optional field (all types): break threshold, floatOrNull semantics like limits
	form.breakImpulse = {
		type: 'text',
		label: t('panel.break_impulse') + t('field.no_limit'),
		value:
			constraint.breakImpulse === null || constraint.breakImpulse === undefined
				? ''
				: String(constraint.breakImpulse)
	}
	if (existing) {
		form._delete = { type: 'checkbox', label: t('dialog.delete'), value: false }
	}

	const dialog = new Dialog('behemiron_jolt_constraint_edit', {
		title: t('dialog.constraint', typeLabel(constraint.type)),
		form,
		width: 520,
		onConfirm(result: Record<string, any>) {
			if (result._delete) {
				ctx.store.removeConstraint(constraint.id)
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
			ctx.store.upsertConstraint(clean)
			ctx.showMessage(existing ? t('msg.constraint_updated') : t('msg.constraint_created'))
			ctx.notifyChanged()
		}
	})
	dialog.show()
}
