// Sidebar panel (right bar): selection-aware physics property editing + status footer.
// Data flow: every edit goes through the store (origin-tagged) and the shared edit history;
// the panel subscribes to the store and echoes external changes in place (focus-guarded),
// falling back to a full rebuild when structure changes (constraints/states/undo/load).

import {
	SHAPE_TYPES,
	MOTION_TYPES,
	DEFAULT_ELEMENT_PROPS,
	DEFAULT_BODY_PROPS,
	DEFAULT_SETTINGS,
	type PhysicsStore,
	type ElementProps,
	type BodyProps,
	type ConstraintData,
	type StoreChange
} from '../core/store.ts'
import type { EditChannel } from '../core/edit_history.ts'
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
	breakInfo?(): string
	/** non-empty while the Jolt WASM is still loading (first simulate click) */
	loadingInfo?(): string
	toggle(): void | Promise<void>
	stepOnce(): void
	reset(): void
}

export interface PanelCtx {
	store: PhysicsStore
	sim: SimLike
	history: EditChannel
	getSelection(): SelectionResult
	bodyDisplayName(uuid: string): string
	onEditConstraint?(id: string): void
	onEditController?(uuid: string, kind: 'character' | 'vehicle' | 'softbody' | 'hair'): void
	onEditBody?(uuid: string): void
	onEditStates?(): void
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

// identifies panel-originated store writes so the echo skips its own widgets (anti-flicker)
const PANEL_ORIGIN = Symbol('behemiron_jolt_panel')

// ctx: {store, sim, history, getSelection, bodyDisplayName}
export function createPanel(ctx: PanelCtx): PanelApi {
	const Panel = bbGlobal('Panel')
	const InputForm = bbGlobal('InputForm')
	const Interface = bbGlobal('Interface')
	const Blockbench = bbGlobal('Blockbench')

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
		// dual-view keys carry a 'g1.'/'g2.' prefix → BB's class token is 'form_bar_g1.header' (literal
		// dot), so match the header bars by attribute instead of a class selector
		#panel_behemiron_jolt [class*='form_bar_'][class*='header'] .small_text { color: var(--color-accent); font-weight: 600; }
		#panel_behemiron_jolt .behemiron_jolt_status { padding: 4px 8px; font-size: 11px; opacity: 0.8; border-top: 1px solid var(--color-border); min-height: 20px; }
		#panel_behemiron_jolt .behemiron_jolt_status .bj-status-mode.is-running { color: var(--color-accent); font-weight: 600; }
		#panel_behemiron_jolt .behemiron_jolt_runbar { display: flex; gap: 2px; padding: 4px 6px; border-bottom: 1px solid var(--color-border); }
		#panel_behemiron_jolt .behemiron_jolt_runbar button { flex: 1 1 0; min-width: 0; padding: 2px 0; line-height: 1; background: transparent; border: 1px solid var(--color-border); border-radius: 3px; color: var(--color-text); cursor: pointer; }
		#panel_behemiron_jolt .behemiron_jolt_runbar button:hover { border-color: var(--color-accent); color: var(--color-accent); }
		#panel_behemiron_jolt .behemiron_jolt_runbar button:disabled { opacity: 0.4; cursor: default; }
		#panel_behemiron_jolt .bj-revert { border: none; background: none; padding: 0 2px; font-size: 10px; opacity: 0.45; cursor: pointer; line-height: 1; }
		#panel_behemiron_jolt .bj-revert:hover { opacity: 1; color: var(--color-accent); }
		#panel_behemiron_jolt .form_bar { line-height: 1.4; }
		#panel_behemiron_jolt .form_bar label { display: inline-flex; align-items: center; gap: 2px; line-height: 1.3; }
	`
	document.head.appendChild(guard)

	// run bar: simulate toggle / step / reset — stays clickable while the form below is read-only
	const runBar: HTMLElement = Interface.createElement('div', { class: 'behemiron_jolt_runbar' })
	panel.node.prepend(runBar)
	const runButtons: { el: HTMLButtonElement; icon: string; title: string; click: () => void; dyn?: boolean }[] = []
	const makeRunButton = (icon: string, titleKey: string, click: () => void, dyn = false) => {
		const el = document.createElement('button')
		el.type = 'button'
		el.addEventListener('click', click)
		runBar.append(el)
		runButtons.push({ el, icon, title: titleKey, click, dyn })
	}
	makeRunButton('play_arrow', 'action.simulate.description', () => void ctx.sim.toggle(), true)
	makeRunButton('skip_next', 'action.step.description', () => ctx.sim.stepOnce())
	makeRunButton('replay', 'action.reset.description', () => ctx.sim.reset())

	const statusEl: HTMLElement = Interface.createElement('div', { class: 'behemiron_jolt_status' })
	panel.node.append(statusEl)
	let bridgeTimer: ReturnType<typeof setTimeout> | null = null

	function result(): Record<string, any> {
		return panel.form.getResult()
	}

	function applyToElements(uuids: string[], key: string, value: unknown): void {
		ctx.history.push(t('panel.' + key), null, () => {
			for (const uuid of uuids)
				ctx.store.setElementProps(uuid, { [key]: value } as Partial<ElementProps>, PANEL_ORIGIN)
		})
	}

	function bodyNum(
		uuid: string,
		keyPrefix: string,
		key: keyof BodyProps & string,
		step: number
	): FormConfig[string] {
		const props: BodyProps = ctx.store.getBodyProps(uuid)
		return {
			// no min/max in the sidebar: bounded numbers render BB's < > stepper arrows, which
			// overflow the narrow panel — ranges live in the body dialog instead
			type: 'number',
			label: t('panel.' + key),
			value: props[key] as number,
			step,
			onChange() {
				ctx.history.push(t('panel.' + key), 'panel:' + uuid + ':' + key, () => {
					ctx.store.setBodyProps(
						uuid,
						{ [key]: Number(result()[keyPrefix + key]) } as Partial<BodyProps>,
						PANEL_ORIGIN
					)
				})
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
					// fallback reads the store, not the build-time snapshot: clearing the field must
					// restore the current value (the snapshot may be stale after other edits)
					applyToElements(
						uuids,
						'density',
						Number(result().density) || ctx.store.getElementProps(uuids[0]).density
					)
				}
			},
			note: { type: 'info', text: t('panel.auto_note') }
		}
	}

	function bodyConfig(uuid: string, name: string, keyPrefix = '', withNote = true): FormConfig {
		const props: BodyProps = ctx.store.getBodyProps(uuid)
		const set = (key: string, value: unknown) =>
			ctx.history.push(t('panel.' + key), 'panel:' + uuid + ':' + key, () => {
				ctx.store.setBodyProps(uuid, { [key]: value } as Partial<BodyProps>, PANEL_ORIGIN)
			})
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
				buttons: [t('panel.edit_controller'), t('panel.body_props'), t('panel.states')],
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
							Blockbench?.showQuickMessage?.(t('msg.select_controller_first'), 3000)
						}
					} else if (i === 1) {
						ctx.onEditBody?.(uuid)
					} else {
						ctx.onEditStates?.()
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
					ctx.history.push(t('panel.units_per_meter'), 'panel:settings:upm', () => {
						ctx.store.setSettings(
							{ unitsPerMeter: Number(result().unitsPerMeter) || ctx.store.getSettings().unitsPerMeter },
							PANEL_ORIGIN
						)
					})
				}
			},
			gravity: {
				type: 'vector',
				label: t('panel.gravity'),
				dimensions: 3,
				value: settings.gravity,
				onChange() {
					ctx.history.push(t('panel.gravity'), 'panel:settings:gravity', () => {
						ctx.store.setSettings({ gravity: (result().gravity as string[]).map(Number) }, PANEL_ORIGIN)
					})
				}
			},
			groundEnabled: {
				type: 'checkbox',
				label: t('panel.ground'),
				value: settings.groundEnabled,
				onChange() {
					ctx.history.push(t('panel.ground'), 'panel:settings:ground', () => {
						ctx.store.setSettings({ groundEnabled: !!result().groundEnabled }, PANEL_ORIGIN)
					})
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
		} else if (ctx.store.counts().bodies === 0) {
			// empty project: tell the user where physics data comes from instead of a blank panel
			config.guidance = { type: 'info', text: t('panel.empty_guidance'), full_width: true }
		}
		return config
	}

	function flattenConfig(config: FormConfig, prefix: string): FormConfig {
		const out: FormConfig = {}
		for (const [key, value] of Object.entries(config)) out[prefix + key] = value
		return out
	}

	// which form fields are currently being edited (hold focus) — never clobber those on echo
	function focusedKeys(): Set<string> {
		const active = document.activeElement as HTMLElement | null
		if (!active || !panel.form.node.contains(active)) return new Set()
		const bar = active.closest('.dialog_bar')
		if (!bar) return new Set()
		const cls = Array.from(bar.classList).find(c => c.startsWith('form_bar_'))
		return new Set(cls ? [cls.slice('form_bar_'.length)] : [])
	}

	// live echo: push fresh store values into the visible fields without a rebuild. Skips fields
	// that hold focus (typing must not be interrupted) and no-ops when the widget already matches.
	function echoValues(change: StoreChange): void {
		const form: AnyBB = panel.form
		const selection = ctx.getSelection()
		const focused = focusedKeys()
		const values: Record<string, unknown> = {}
		const pushValue = (key: string, value: unknown) => {
			if (focused.has(key)) return
			const current = form.getResult()[key]
			if (JSON.stringify(current) !== JSON.stringify(value)) values[key] = value
		}
		if (selection.elements.length && !selection.groups.length) {
			const first = ctx.store.getElementProps(selection.elements[0].uuid)
			if (change.kind === 'elements' || change.kind === 'bodies') {
				pushValue('shape', first.shape)
				pushValue('density', first.density)
			}
		} else if (selection.groups.length && !selection.elements.length) {
			const groups = selection.groups.length === 2 ? selection.groups : [selection.groups[0]]
			const prefixes = selection.groups.length === 2 ? ['g1.', 'g2.'] : ['']
			for (let i = 0; i < groups.length; i++) {
				const props = ctx.store.getBodyProps(groups[i].uuid)
				const prefix = prefixes[i]
				if (change.kind === 'bodies') {
					pushValue(prefix + 'motionType', props.motionType)
					pushValue(prefix + 'friction', props.friction)
					pushValue(prefix + 'restitution', props.restitution)
					const controllerNow = form.getResult()[prefix + 'controller']
					if (controllerNow !== props.controller) {
						// controller swap changes available notes/buttons — structural, rebuild
						rebuild()
						return
					}
				}
			}
		} else if (!selection.groups.length && !selection.elements.length) {
			if (change.kind === 'settings') {
				const settings = ctx.store.getSettings()
				pushValue('unitsPerMeter', settings.unitsPerMeter)
				pushValue('gravity', settings.gravity)
				pushValue('groundEnabled', settings.groundEnabled)
			}
		}
		if (Object.keys(values).length) form.setValues(values)
		syncRevertArrows()
	}

	// read-only while simulating: keep the form visible (context stays) but freeze every control
	function applyReadOnly(): void {
		const form: AnyBB = panel.form
		for (const el of form.node.querySelectorAll('input, select, textarea, button, .bb-select')) {
			el.disabled = true
		}
	}

	// per-field revert arrows (only on non-default values). Live-synced: in-place echoes flip
	// defaultness without a rebuild, so the arrow state is re-evaluated on every store echo.
	interface RevertSpec {
		key: string
		def: unknown
		current(): unknown
		revert(): void
	}
	let liveRevertSpecs: RevertSpec[] = []

	function revertButton(spec: RevertSpec): HTMLButtonElement {
		const btn = document.createElement('button')
		btn.type = 'button'
		btn.className = 'bj-revert'
		btn.title = t('panel.revert_default')
		btn.textContent = '↺'
		btn.addEventListener('click', event => {
			event.preventDefault()
			spec.revert()
		})
		return btn
	}

	function applyRevertArrows(specs: RevertSpec[]): void {
		liveRevertSpecs = specs
		syncRevertArrows()
	}

	function syncRevertArrows(): void {
		const form: AnyBB = panel.form
		const labels = new Map<string, HTMLElement>()
		for (const bar of form.node.querySelectorAll('.dialog_bar')) {
			const el = bar as HTMLElement
			const cls = Array.from(el.classList as DOMTokenList).find(c => c.startsWith('form_bar_'))
			if (!cls) continue
			const label = el.querySelector('label') as HTMLElement | null
			if (label) labels.set(cls.slice('form_bar_'.length), label)
		}
		for (const spec of liveRevertSpecs) {
			const label = labels.get(spec.key)
			if (!label) continue
			const isDefault = JSON.stringify(spec.current()) === JSON.stringify(spec.def)
			const existing = label.querySelector('.bj-revert')
			if (isDefault) existing?.remove()
			else if (!existing) label.append(revertButton(spec))
		}
	}

	function rebuild(): void {
		const form: AnyBB = panel.form
		for (const key in form.form_config) delete form.form_config[key]
		let config: FormConfig
		let revertSpecs: RevertSpec[] = []
		if (ctx.sim.isActive()) {
			// full form, frozen — the user sees what is paused and can still read values
			const selection = ctx.getSelection()
			if (selection.elements.length && !selection.groups.length) {
				config = elementConfig(selection.elements.map((e: AnyBB) => e.uuid))
			} else if (selection.groups.length === 1 && !selection.elements.length) {
				config = bodyConfig(selection.groups[0].uuid, selection.groups[0].name)
			} else if (selection.groups.length === 2) {
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
			config = { simNotice: { type: 'info', text: t('panel.sim_active'), full_width: true }, ...config }
		} else {
			const selection = ctx.getSelection()
			if (selection.elements.length && !selection.groups.length) {
				const uuids = selection.elements.map((e: AnyBB) => e.uuid)
				config = elementConfig(uuids)
				revertSpecs = [
					{
						key: 'shape',
						def: DEFAULT_ELEMENT_PROPS.shape,
						current: () => ctx.store.getElementProps(uuids[0]).shape,
						revert: () => applyToElements(uuids, 'shape', DEFAULT_ELEMENT_PROPS.shape)
					},
					{
						key: 'density',
						def: DEFAULT_ELEMENT_PROPS.density,
						current: () => ctx.store.getElementProps(uuids[0]).density,
						revert: () => applyToElements(uuids, 'density', DEFAULT_ELEMENT_PROPS.density)
					}
				]
			} else if (selection.groups.length === 1 && !selection.elements.length) {
				config = bodyConfig(selection.groups[0].uuid, selection.groups[0].name)
				revertSpecs = bodyRevertSpecs(selection.groups[0].uuid, '')
			} else if (selection.groups.length === 2) {
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
				revertSpecs = [
					...bodyRevertSpecs(selection.groups[0].uuid, 'g1.'),
					...bodyRevertSpecs(selection.groups[1].uuid, 'g2.')
				]
			} else {
				config = settingsConfig()
				revertSpecs = [
					{
						key: 'unitsPerMeter',
						def: DEFAULT_SETTINGS.unitsPerMeter,
						current: () => ctx.store.getSettings().unitsPerMeter,
						revert: () =>
							ctx.history.push(t('panel.units_per_meter'), null, () =>
								ctx.store.setSettings(
									{ unitsPerMeter: DEFAULT_SETTINGS.unitsPerMeter },
									PANEL_ORIGIN
								)
							)
					},
					{
						key: 'gravity',
						def: DEFAULT_SETTINGS.gravity,
						current: () => ctx.store.getSettings().gravity,
						revert: () =>
							ctx.history.push(t('panel.gravity'), null, () =>
								ctx.store.setSettings({ gravity: DEFAULT_SETTINGS.gravity.slice() }, PANEL_ORIGIN)
							)
					},
					{
						key: 'groundEnabled',
						def: DEFAULT_SETTINGS.groundEnabled,
						current: () => ctx.store.getSettings().groundEnabled,
						revert: () =>
							ctx.history.push(t('panel.ground'), null, () =>
								ctx.store.setSettings(
									{ groundEnabled: DEFAULT_SETTINGS.groundEnabled },
									PANEL_ORIGIN
								)
							)
					}
				]
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
		if (ctx.sim.isActive()) applyReadOnly()
		applyRevertArrows(revertSpecs)
		applyTips()
		refreshStatus()
	}

	// hover tooltips as bar title attributes: zero layout impact (the native BB description icon
	// would widen the label column and overflow the narrow sidebar)
	const TIP_KEYS = new Set([
		'motionType',
		'friction',
		'restitution',
		'controller',
		'shape',
		'density',
		'unitsPerMeter',
		'gravity',
		'groundEnabled'
	])
	function applyTips(): void {
		const form: AnyBB = panel.form
		for (const bar of form.node.querySelectorAll('.dialog_bar')) {
			const el = bar as HTMLElement
			const cls = Array.from(el.classList as DOMTokenList).find(c => c.startsWith('form_bar_'))
			if (!cls) continue
			const bare = cls.slice('form_bar_'.length).replace(/^(g1\.|g2\.)/, '')
			if (TIP_KEYS.has(bare)) el.setAttribute('title', t('tip.' + bare))
		}
	}

	function bodyRevertSpecs(uuid: string, prefix: string): RevertSpec[] {
		const defaults = DEFAULT_BODY_PROPS as unknown as Record<string, unknown>
		const mk = (key: string): RevertSpec => ({
			key: prefix + key,
			def: defaults[key],
			current: () =>
				(ctx.store.getBodyProps(uuid) as unknown as Record<string, unknown>)[key],
			revert: () =>
				ctx.history.push(t('panel.' + key), null, () =>
					ctx.store.setBodyProps(uuid, { [key]: defaults[key] } as Partial<BodyProps>, PANEL_ORIGIN)
				)
		})
		return [mk('motionType'), mk('friction'), mk('restitution'), mk('controller')]
	}

	function refreshRunBar(): void {
		const mode = ctx.sim.status().mode
		for (const btn of runButtons) {
			const icon = btn.dyn ? (mode === 'running' ? 'pause' : 'play_arrow') : btn.icon
			btn.el.textContent = ''
			btn.el.append(Blockbench.getIconNode(icon))
			btn.el.title = t(btn.title)
			btn.el.disabled = mode === 'idle' && !btn.dyn && btn.icon === 'skip_next'
		}
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
				`${status.time.toFixed(1)}s · #${status.steps}${ctx.sim.diagInfo?.() || ''}${ctx.sim.sensorInfo?.() || ''}${ctx.sim.breakInfo?.() || ''}`
			)
			const selection = ctx.getSelection()
			if (selection.groups.length === 1) {
				const velocity = ctx.sim.readBodyVelocity(selection.groups[0].uuid)
				if (velocity) append(t('panel.speed', Math.hypot(...velocity).toFixed(2)))
			}
		}
		append(t('panel.status', counts.bodies, counts.constraints))
		const loading = ctx.sim.loadingInfo?.()
		if (loading) append(loading)
		refreshRunBar()
	}

	const offSelection = onEvent('update_selection', rebuild)
	const offRefresh = onEvent('behemiron_jolt_refresh', () => refreshStatus())
	const offStore = ctx.store.subscribe(change => {
		if (change.origin === PANEL_ORIGIN) {
			// own write: widgets already hold the value — only derived text/arrows can change
			refreshStatus()
			syncRevertArrows()
			return
		}
		if (change.kind === 'constraints' || change.kind === 'states' || change.kind === 'load') {
			// structure changed: button lists / notes / whole view — full rebuild
			rebuild()
			return
		}
		if (ctx.sim.isActive()) {
			refreshStatus()
			return
		}
		echoValues(change)
	})

	rebuild()

	return {
		rebuild,
		refreshStatus,
		dispose() {
			offSelection()
			offRefresh()
			offStore()
			if (bridgeTimer) clearTimeout(bridgeTimer)
			statusEl.remove()
			runBar.remove()
			guard.remove()
			try {
				panel.delete?.()
			} catch {
				/* already removed */
			}
		}
	}
}
