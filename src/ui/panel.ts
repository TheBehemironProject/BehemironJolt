// Sidebar panel (right bar): selection-aware physics property editing + status footer.

import {
	SHAPE_TYPES,
	MOTION_TYPES,
	type PhysicsStore,
	type ElementProps,
	type BodyProps,
	type ConstraintData
} from '../core/store.ts'
import { describeConstraint } from '../core/constraints.ts'
import { onEvent, type SelectionResult } from '../bb/adapter.ts'
import { t, shapeLabel, motionLabel } from './i18n.ts'

type AnyBB = any

export interface SimLike {
	isActive(): boolean
	status(): { mode: string; steps: number; time: number }
	readBodyVelocity(uuid: string): number[] | null
	diagInfo(): string
	sensorInfo?(): string
}

export interface PanelCtx {
	store: PhysicsStore
	sim: SimLike
	getSelection(): SelectionResult
	bodyDisplayName(uuid: string): string
	onEditConstraint?(id: string): void
	onEditController?(uuid: string, kind: 'character' | 'vehicle' | 'softbody' | 'hair'): void
	onEditBody?(uuid: string): void
}

interface PanelApi {
	rebuild(): void
	refreshStatus(): void
	dispose(): void
}

function bbGlobal(name: string): AnyBB {
	return (globalThis as any)[name] || (globalThis as any).Blockbench?.[name]
}

function shapeOptions(): Record<string, string> {
	const out: Record<string, string> = {}
	for (const key of SHAPE_TYPES) out[key] = shapeLabel(key)
	return out
}
function enumOptions(keys: readonly string[], label: (k: string) => string): Record<string, string> {
	const out: Record<string, string> = {}
	for (const key of keys) out[key] = label(key)
	return out
}

type FormConfig = Record<string, any>

// ctx: {store, sim, getSelection, bodyDisplayName}
export function createPanel(ctx: PanelCtx): PanelApi {
	const Panel = bbGlobal('Panel')
	const InputForm = bbGlobal('InputForm')
	const Interface = bbGlobal('Interface')

	const panel = new Panel('behemiron_jolt', {
		icon: 'fas.fa-atom',
		name: t('panel.title'),
		condition: { modes: ['edit'] },
		default_position: { slot: 'right_bar', attached_to: 'outliner', attached_index: 1, height: 280 },
		form: new InputForm({})
	})
	panel.node.classList.add('behemiron_jolt_panel')
	// narrow-sidebar overflow guards (CJK labels wrap per-character without this) + vertical scroll
	const guard = document.createElement('style')
	guard.textContent = `
		#panel_behemiron_jolt { overflow-y: auto; }
		#panel_behemiron_jolt .numeric_input_slider { display: none; }
		#panel_behemiron_jolt .dialog_form_buttons { display: flex; flex-wrap: wrap; gap: 4px; }
		#panel_behemiron_jolt .dialog_form_buttons button { white-space: nowrap; flex: 1 1 auto; min-width: 0; overflow: hidden; text-overflow: ellipsis; }
		#panel_behemiron_jolt .form_bar_header .small_text { color: var(--color-accent); font-weight: 600; }
		#panel_behemiron_jolt .behemiron_jolt_status { padding: 4px 8px; font-size: 11px; opacity: 0.8; border-top: 1px solid var(--color-border); min-height: 20px; }
		#panel_behemiron_jolt .behemiron_jolt_status .bj-status-mode.is-running { color: var(--color-accent); font-weight: 600; }
	`
	document.head.appendChild(guard)

	const statusEl: HTMLElement = Interface.createElement('div', { class: 'behemiron_jolt_status' })
	panel.node.append(statusEl)
	let bridgeTimer: ReturnType<typeof setTimeout> | null = null

	function result(): Record<string, any> {
		return panel.form.getResult()
	}

	function applyToElements(uuids: string[], key: string, value: unknown): void {
		for (const uuid of uuids) ctx.store.setElementProps(uuid, { [key]: value } as Partial<ElementProps>)
	}

	function bodyNum(uuid: string, keyPrefix: string, key: keyof BodyProps & string, step: number): FormConfig[string] {
		const props: BodyProps = ctx.store.getBodyProps(uuid)
		return {
			// no min/max in the sidebar: bounded numbers render BB's < > stepper arrows, which
			// overflow the narrow panel — ranges live in the body dialog instead
			type: 'number',
			label: t('panel.' + key),
			value: props[key] as number,
			step,
			onChange() {
				ctx.store.setBodyProps(uuid, { [key]: Number(result()[keyPrefix + key]) } as Partial<BodyProps>)
			}
		}
	}

	function elementConfig(uuids: string[]): FormConfig {
		const first: ElementProps = ctx.store.getElementProps(uuids[0])
		return {
			header: { type: 'info', text: t('panel.elements_selected', uuids.length), full_width: true },
			shape: {
				type: 'select',
				label: t('panel.collision_shape'),
				value: first.shape,
				options: shapeOptions(),
				onChange() {
					applyToElements(uuids, 'shape', result().shape)
				}
			},
			density: {
				type: 'number',
				label: t('panel.density'),
				value: first.density,
				onChange() {
					applyToElements(uuids, 'density', Number(result().density) || first.density)
				}
			},
			note: { type: 'info', text: t('panel.auto_note') }
		}
	}

	function bodyConfig(uuid: string, name: string, keyPrefix = '', withNote = true): FormConfig {
		const props: BodyProps = ctx.store.getBodyProps(uuid)
		const set = (key: string, value: unknown) =>
			ctx.store.setBodyProps(uuid, { [key]: value } as Partial<BodyProps>)
		const rd = (key: string) => result()[keyPrefix + key]
		// Essentials only — everything else lives in the body-properties dialog (overflow-free by design)
		const config: FormConfig = {
			header: { type: 'info', text: t('panel.body', name), full_width: true },
			motionType: {
				type: 'select',
				label: t('panel.motion_type'),
				value: props.motionType,
				options: enumOptions(MOTION_TYPES, motionLabel),
				onChange() {
					set('motionType', rd('motionType'))
				}
			},
			friction: bodyNum(uuid, keyPrefix, 'friction', 0.05),
			restitution: bodyNum(uuid, keyPrefix, 'restitution', 0.05),
			controller: {
				type: 'select',
				label: t('panel.controller'),
				value: props.controller,
				options: {
					none: t('controller.none'),
					character: t('controller.character'),
					vehicle: t('controller.vehicle'),
					softbody: t('controller.softbody'),
					hair: t('controller.hair')
				},
				onChange() {
					set('controller', rd('controller'))
					// note text depends on the selection — rebuild so the hint swaps immediately
					rebuild()
				}
			},
			actionButtons: {
				type: 'buttons',
				label: '',
				full_width: true,
				buttons: [t('panel.edit_controller'), t('panel.body_props')],
				click(i: number) {
					// read fresh: `props` is a build-time snapshot and the select above does not rebuild fields
					const controller = ctx.store.getBodyProps(uuid).controller
					if (i === 0) {
						if (controller !== 'none') {
							ctx.onEditController?.(
								uuid,
								controller as 'character' | 'vehicle' | 'softbody' | 'hair'
							)
						} else {
							const Blockbench: AnyBB = (globalThis as any).Blockbench
							Blockbench?.showQuickMessage?.(t('msg.select_controller_first'), 3000)
						}
					} else {
						ctx.onEditBody?.(uuid)
					}
				}
			}
		}
		// contextual controller hint (Godot: help only where it applies) instead of one generic note
		const NOTE_KEY: Record<string, string> = {
			character: 'panel.note_character',
			vehicle: 'panel.note_vehicle',
			softbody: 'panel.note_softbody',
			hair: 'panel.note_hair'
		}
		const noteKey = NOTE_KEY[props.controller]
		if (withNote && noteKey) config.controllerNote = { type: 'info', text: t(noteKey) }
		const related: ConstraintData[] = ctx.store
			.listConstraints()
			.filter(c => c.bodyA === uuid || c.bodyB === uuid)
		if (related.length) {
			config.constraintLabel = { type: 'info', text: t('panel.constraints'), full_width: true }
			config.constraintButtons = {
				type: 'buttons',
				label: '',
				full_width: true,
				buttons: related.map(c => describeConstraint(c, ctx.bodyDisplayName)),
				click(i: number) {
					ctx.onEditConstraint?.(related[i].id)
				}
			}
		}
		return config
	}

	function settingsConfig(): FormConfig {
		const settings = ctx.store.getSettings()
		const all: ConstraintData[] = ctx.store.listConstraints()
		const config: FormConfig = {
			header: { type: 'info', text: t('panel.settings'), full_width: true },
			unitsPerMeter: {
				type: 'number',
				label: t('panel.units_per_meter'),
				value: settings.unitsPerMeter,
				step: 1,
				onChange() {
					ctx.store.setSettings({
						unitsPerMeter: Number(result().unitsPerMeter) || settings.unitsPerMeter
					})
				}
			},
			gravity: {
				type: 'vector',
				label: t('panel.gravity'),
				dimensions: 3,
				value: settings.gravity,
				onChange() {
					ctx.store.setSettings({ gravity: (result().gravity as string[]).map(Number) })
				}
			},
			groundEnabled: {
				type: 'checkbox',
				label: t('panel.ground'),
				value: settings.groundEnabled,
				onChange() {
					ctx.store.setSettings({ groundEnabled: !!result().groundEnabled })
				}
			}
		}
		if (all.length) {
			config.sep = '_'
			config.constraintLabel = { type: 'info', text: t('panel.constraints'), full_width: true }
			config.constraintButtons = {
				type: 'buttons',
				label: '',
				full_width: true,
				buttons: all.map(c => describeConstraint(c, ctx.bodyDisplayName)),
				click(i: number) {
					ctx.onEditConstraint?.(all[i].id)
				}
			}
		}
		return config
	}

	function simActiveConfig(): FormConfig {
		return {
			header: { type: 'info', text: t('panel.sim_active'), full_width: true }
		}
	}

	function flattenConfig(config: FormConfig, prefix: string): FormConfig {
		const out: FormConfig = {}
		for (const [key, value] of Object.entries(config)) out[prefix + key] = value
		return out
	}

	function rebuild(): void {
		const form: AnyBB = panel.form
		for (const key in form.form_config) delete form.form_config[key]
		let config: FormConfig
		if (ctx.sim.isActive()) {
			config = simActiveConfig()
		} else {
			const selection = ctx.getSelection()
			if (selection.elements.length && !selection.groups.length) {
				config = elementConfig(selection.elements.map((e: AnyBB) => e.uuid))
			} else if (selection.groups.length === 1 && !selection.elements.length) {
				config = bodyConfig(selection.groups[0].uuid, selection.groups[0].name)
			} else if (selection.groups.length === 2) {
				// Blockbench InputForm has no nested forms — flatten both body configs with prefixes
				config = {
					header: { type: 'info', text: t('panel.two_bodies'), full_width: true },
					hint: { type: 'info', text: t('panel.constraint_hint') },
					...flattenConfig(
						bodyConfig(selection.groups[0].uuid, selection.groups[0].name, 'g1.', false),
						'g1.'
					),
					sep: '_',
					...flattenConfig(
						bodyConfig(selection.groups[1].uuid, selection.groups[1].name, 'g2.', false),
						'g2.'
					)
				}
			} else {
				config = settingsConfig()
			}
		}
		Object.assign(form.form_config, config)
		form.buildForm()
		form.updateValues({ cause: 'setup' })
		// BB 5.2.2 forms never call config-level onChange — bridge from the form-level 'input' event
		// (canonical pattern: js/outliner/element_panel.ts:77-111). Debounced: stepper/key events fire
		// in bursts; batching keeps rapid edits responsive.
		form.events?.input?.empty?.()
		if (bridgeTimer) clearTimeout(bridgeTimer)
		form.on('input', ({ changed_keys }: any) => {
			if (bridgeTimer) clearTimeout(bridgeTimer)
			bridgeTimer = setTimeout(() => {
				for (const key of changed_keys || []) {
					const field = config[key]
					if (field && typeof field.onChange === 'function') field.onChange()
				}
			}, 90)
		})
		refreshStatus()
	}

	function refreshStatus(): void {
		const counts = ctx.store.counts()
		const status = ctx.sim.status()
		statusEl.textContent = ''
		const append = (text: string, cls?: string) => {
			if (statusEl.childNodes.length) statusEl.append(document.createTextNode(' · '))
			if (cls) {
				const span = document.createElement('span')
				span.className = cls
				span.textContent = text
				statusEl.append(span)
			} else {
				statusEl.append(document.createTextNode(text))
			}
		}
		if (status.mode !== 'idle') {
			append(
				status.mode === 'running' ? t('panel.sim_running') : t('panel.sim_paused'),
				'bj-status-mode is-' + status.mode
			)
			append(
				`${status.time.toFixed(1)}s · #${status.steps}${ctx.sim.diagInfo?.() || ''}${ctx.sim.sensorInfo?.() || ''}`
			)
			const selection = ctx.getSelection()
			if (selection.groups.length === 1) {
				const velocity = ctx.sim.readBodyVelocity(selection.groups[0].uuid)
				if (velocity) append(t('panel.speed', Math.hypot(...velocity).toFixed(2)))
			}
		}
		append(t('panel.status', counts.bodies, counts.constraints))
	}

	const offSelection = onEvent('update_selection', rebuild)
	const offRefresh = onEvent('behemiron_jolt_refresh', () => refreshStatus())

	rebuild()

	return {
		rebuild,
		refreshStatus,
		dispose() {
			offSelection()
			offRefresh()
			statusEl.remove()
			guard.remove()
			try {
				panel.delete?.()
			} catch {
				/* already removed */
			}
		}
	}
}
