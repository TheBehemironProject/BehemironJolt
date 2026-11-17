// Body property dialog: everything that does not need to be visible at a glance lives here
// (panel keeps only motionType/friction/restitution/controller). Godot-style progressive disclosure:
// Inspector shows the essentials, double-click/dialog opens the rest.

import { MOTION_QUALITIES, sanitizeBodyProps, type BodyProps } from '../core/store.ts'
import { t, qualityLabel } from './i18n.ts'
import { injectDialogStyles } from './constraint_dialog.ts'

type AnyBB = any

function bbGlobal(name: string): AnyBB {
	return (globalThis as any)[name] || (globalThis as any).Blockbench?.[name]
}

export interface BodyDialogCtx {
	store: { getBodyProps(uuid: string): BodyProps; setBodyProps(uuid: string, patch: Partial<BodyProps>): void }
	uuid: string
	name?: string
	notifyChanged?(): void
}

export function openBodyDialog(ctx: BodyDialogCtx): void {
	const Dialog = bbGlobal('Dialog')
	injectDialogStyles()
	const props = ctx.store.getBodyProps(ctx.uuid)
	const form: Record<string, any> = {
		header: { type: 'info', text: t('panel.body', ctx.name || ctx.uuid.slice(0, 8)), full_width: true }
	}
	const num = (key: keyof BodyProps & string, label: string, min: number, max: number, step: number) => {
		form[key] = { type: 'number', label, value: props[key] as number, min, max, step }
	}
	num('objectLayer', t('panel.object_layer'), 0, 0xffff, 1)
	num('linearDamping', t('panel.linear_damping'), 0, 10, 0.01)
	num('angularDamping', t('panel.angular_damping'), 0, 10, 0.01)
	num('gravityFactor', t('panel.gravity_factor'), -10, 10, 0.1)
	form.motionQuality = {
		type: 'select',
		label: t('panel.motion_quality'),
		value: props.motionQuality,
		options: Object.fromEntries(MOTION_QUALITIES.map(k => [k, qualityLabel(k)]))
	}
	form.isSensor = { type: 'checkbox', label: t('panel.isSensor'), value: props.isSensor }
	form.allowSleeping = { type: 'checkbox', label: t('panel.allowSleeping'), value: props.allowSleeping }
	form.overrideMassProperties = {
		type: 'select',
		label: t('panel.mass_props'),
		value: props.overrideMassProperties,
		options: {
			CalculateMassAndInertia: t('override.CalculateMassAndInertia'),
			CalculateInertia: t('override.CalculateInertia'),
			MassAndInertiaProvided: t('override.MassAndInertiaProvided')
		}
	}
	form.mass = { type: 'number', label: t('panel.mass'), value: props.mass, min: 0.000001, max: 1e9, step: 0.1 }

	const dialog = new Dialog('behemiron_jolt_body_props', {
		title: t('dialog.body_props'),
		form,
		width: 520,
		onConfirm(result: Record<string, any>) {
			const patch = sanitizeBodyProps({
				objectLayer: Math.round(Number(result.objectLayer) || 0),
				linearDamping: Number(result.linearDamping),
				angularDamping: Number(result.angularDamping),
				gravityFactor: Number(result.gravityFactor),
				motionQuality: result.motionQuality,
				isSensor: result.isSensor === true || result.isSensor === 'true',
				allowSleeping: result.allowSleeping === true || result.allowSleeping === 'true',
				overrideMassProperties: result.overrideMassProperties,
				mass: Number(result.mass)
			})
			ctx.store.setBodyProps(ctx.uuid, patch)
			ctx.notifyChanged?.()
		}
	})
	dialog.show()
}
