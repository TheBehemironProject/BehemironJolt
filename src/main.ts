// Behemiron Jolt Physics — Blockbench plugin entry point.
// Assembles store, persistence, panel, actions, gizmo viz and the simulation state machine.

import { createStore, type PhysicsStore, type ConstraintData, type Settings, GIZMO_ORIGIN } from './core/store.ts'
import { createEditHistory, type EditHistory } from './core/edit_history.ts'
import { buildPhysicsFromSnapshot } from './core/pipeline.ts'
import { sanitizeConstraint, constraintToExport, moveConstraintHandle } from './core/constraints.ts'
import { mat4Compose, mat4Invert, mat4Multiply, type Vec3, type Quat } from './util/math.ts'
import * as diag from './util/diag.ts'
import * as adapter from './bb/adapter.ts'
import { attachPersist } from './bb/persist.ts'
import { loadJolt, joltLoadState, type JoltNS } from './sim/jolt_loader.ts'
import { SimSession } from './sim/session.ts'
import { GhostView, type GhostBody } from './sim/ghost.ts'
import { createPanel } from './ui/panel.ts'
import { openConstraintWizard, openConstraintEditor, type EditorCtx } from './ui/constraint_dialog.ts'
import { createViz, type DebugVector } from './ui/viz.ts'
import { initI18n, t } from './ui/i18n.ts'
import { openBakeDialog } from './ui/bake_dialog.ts'
import { openControllerDialog } from './ui/controller_dialog.ts'
import { openBodyDialog } from './ui/body_dialog.ts'
import { openStatesDialog } from './ui/states_dialog.ts'
import { mat4Decompose, mat4FromElements } from './util/math.ts'

type AnyBB = any

function bbGlobal(name: string): AnyBB {
	return (globalThis as any)[name] || (globalThis as any).Blockbench?.[name]
}

let store: PhysicsStore | null = null
let history: EditHistory | null = null
let persistDetach: (() => void) | null = null
let panelApi: { rebuild(): void; refreshStatus(): void; dispose(): void } | null = null
let viz: {
	refresh(constraints?: ConstraintData[]): void
	updateDebug(): void
	dispose(): void
} | null = null
let actions: AnyBB[] = []
const debugVectors: DebugVector[] = []
const sensorDots: { pos: Vec3; active: boolean }[] = []
let sensorSummary = ''
let frameCounter = 0

// Kinematic bodies driven by the Blockbench animation
let animatedBodies: { uuid: string; group: AnyBB }[] = []
// WASD preview-driving state (active while simulating with vehicle/character bodies)
const driveKeys = new Set<string>()
let driveListeners: (() => void) | null = null

function driveForward(): number {
	return (driveKeys.has('KeyW') ? 1 : 0) - (driveKeys.has('KeyS') ? 1 : 0)
}
function driveRight(): number {
	return (driveKeys.has('KeyD') ? 1 : 0) - (driveKeys.has('KeyA') ? 1 : 0)
}

function attachDriveInput(_session: SimSession): void {
	const down = (e: KeyboardEvent) => {
		const target: any = e.target
		const tag = target?.tagName
		if (tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable) return
		if (['KeyW', 'KeyA', 'KeyS', 'KeyD', 'Space'].includes(e.code)) {
			driveKeys.add(e.code)
			e.preventDefault()
			e.stopPropagation()
		}
	}
	const up = (e: KeyboardEvent) => {
		driveKeys.delete(e.code)
	}
	window.addEventListener('keydown', down, true)
	window.addEventListener('keyup', up, true)
	driveListeners = () => {
		window.removeEventListener('keydown', down, true)
		window.removeEventListener('keyup', up, true)
		driveKeys.clear()
	}
}

function updateDriveInput(session: SimSession): void {
	const braking = driveKeys.has('Space') ? 1 : 0
	const forward = driveForward()
	const right = driveRight()
	// character bodies respond to WASD via velocity; vehicles via driver input
	session.driveInput.forward = forward
	session.driveInput.right = right
	session.driveInput.brake = braking
	session.driveInput.handbrake = 0
}

function editorCtx(): EditorCtx {
	return {
		store: store as unknown as EditorCtx['store'],
		history: history as unknown as EditorCtx['history'],
		getSelection: adapter.getSelection,
		estimateGroupCom: adapter.estimateGroupCom,
		bodyDisplayName: adapter.bodyDisplayName,
		showMessage: adapter.showMessage,
		notifyChanged() {
			panelApi?.rebuild()
			adapter.dispatch('behemiron_jolt_refresh')
		}
	}
}

function openEditorById(id: string): void {
	const constraint = store?.getConstraint(id)
	if (constraint) openConstraintEditor(editorCtx(), constraint)
}

function onEditController(uuid: string, kind: 'character' | 'vehicle' | 'softbody' | 'hair'): void {
	if (!store) return
	openControllerDialog({
		store,
		history,
		uuid,
		kind,
		notifyChanged: () => adapter.dispatch('behemiron_jolt_refresh')
	})
}

function onEditBody(uuid: string): void {
	if (!store) return
	openBodyDialog({
		store,
		history,
		uuid,
		name: adapter.bodyDisplayName(uuid),
		notifyChanged: () => adapter.dispatch('behemiron_jolt_refresh')
	})
}

function onEditStates(): void {
	if (!store) return
	openStatesDialog({
		store,
		history,
		bodyDisplayName: (uuid: string) => adapter.bodyDisplayName(uuid),
		notifyChanged: () => adapter.dispatch('behemiron_jolt_refresh'),
		showMessage: (message: string) => {
			const Blockbench = (globalThis as any).Blockbench
			Blockbench?.showQuickMessage?.(message, 3000)
		}
	})
}

function refreshViz(): void {
	viz?.refresh(store?.listConstraints() || [])
}

function onMoveHandle(constraintId: string, field: string, worldBB: number[], index: number | null): void {
	if (!store || sim.isActive()) return
	const s = store
	const constraint = s.getConstraint(constraintId)
	if (!constraint) return
	const updated = moveConstraintHandle(constraint, field, worldBB, index)
	if (!updated) return
	const clean = sanitizeConstraint(updated)
	if (!clean) return
	// mergeKey folds the whole drag into ONE undo step (MERGE_WINDOW covers inter-move gaps)
	history?.push(t('panel.constraints'), `gizmo:${constraintId}:${field}:${index ?? 'all'}`, () =>
		s.upsertConstraint(clean, GIZMO_ORIGIN)
	)
	refreshViz()
}

interface SimState {
	mode: 'idle' | 'running' | 'paused'
	starting: boolean
	session: SimSession | null
	ghost: GhostView | null
	rafId: number | null
	lastTime: number
	isActive(): boolean
	status(): { mode: string; steps: number; time: number }
	readBodyVelocity(uuid: string): number[] | null
	diagInfo(): string
	sensorInfo(): string
	breakInfo(): string
	loadingInfo(): string
	driveAnimated(): void
	toggle(): Promise<void>
	pause(): void
	resume(): void
	stepOnce(): void
	sync(): void
	start(): Promise<void>
	reset(): void
}

const sim: SimState = {
	mode: 'idle',
	starting: false,
	session: null,
	ghost: null,
	rafId: null,
	lastTime: 0,

	isActive() {
		return this.mode !== 'idle'
	},
	status() {
		return { mode: this.mode, steps: this.session?.steps || 0, time: (this.session?.steps || 0) / 60 }
	},
	readBodyVelocity(uuid: string) {
		return this.session?.readLinearVelocity(uuid) || null
	},
	diagInfo() {
		const live = diag.totalLive()
		return live === 0 ? '' : ` · jolt objs ${live}`
	},
	sensorInfo() {
		return sensorSummary
	},
	breakInfo() {
		const broken = this.session?.brokenConstraints() || 0
		return broken === 0 ? '' : t('panel.sim_broken', broken)
	},
	loadingInfo() {
		return joltLoadState().status === 'loading' ? t('msg.loading') : ''
	},
	driveAnimated() {
		if (!animatedBodies.length || !this.session || !store) return
		const Timeline = bbGlobal('Timeline')
		const Animator = bbGlobal('Animator')
		const Canvas = bbGlobal('Canvas')
		const animations: AnyBB[] = (globalThis as any).Project?.animations || []
		const animLength = animations.length
			? Math.max(...animations.map((a: AnyBB) => a.length || 1), 0.001)
			: 0
		if (!animLength || !Timeline || !Animator?.preview) return
		Timeline.time = (this.session.steps / 60) % animLength
		Animator.preview()
		Canvas.scene.updateMatrixWorld(true)
		const upm = store.getSettings().unitsPerMeter
		for (const { uuid, group } of animatedBodies) {
			const mesh = group?.mesh
			if (!mesh) continue
			const d = mat4Decompose(mat4FromElements(mesh.matrixWorld.elements))
			this.session.setBodyTransform(
				uuid,
				[d.position[0] / upm, d.position[1] / upm, d.position[2] / upm],
				d.quaternion,
				true
			)
		}
	},

	async toggle() {
		if (this.mode === 'running') this.pause()
		else if (this.mode === 'paused') this.resume()
		else await this.start()
	},
	pause() {
		if (this.mode !== 'running') return
		if (this.rafId !== null) cancelAnimationFrame(this.rafId)
		this.rafId = null
		this.mode = 'paused'
		panelApi?.refreshStatus()
	},
	resume() {
		if (this.mode !== 'paused') return
		this.mode = 'running'
		this.lastTime = performance.now()
		const loop = (now: number) => {
			if (this.mode !== 'running') return
			const dt = Math.min((now - this.lastTime) / 1000, 0.25)
			this.lastTime = now
			this.session?.step(dt)
			this.sync()
			this.rafId = requestAnimationFrame(loop)
		}
		this.rafId = requestAnimationFrame(loop)
		panelApi?.refreshStatus()
	},
	stepOnce() {
		if (this.mode !== 'paused' && this.mode !== 'running') return
		if (this.mode === 'running') this.pause()
		this.session?.step(1 / 60)
		this.sync()
		panelApi?.refreshStatus()
	},
	sync() {
		const unitsPerMeter = store?.getSettings().unitsPerMeter || 16
		this.session?.readTransforms((_uuid: string, index: number, pos: Vec3, quat: Quat) => {
			const world = mat4Compose(
				[pos[0] * unitsPerMeter, pos[1] * unitsPerMeter, pos[2] * unitsPerMeter],
				quat,
				[1, 1, 1]
			)
			this.ghost?.updateBody(index, world)
		})
		this.session?.readCharacters((_uuid: string, bodyIndex: number, pos: Vec3, quat: Quat) => {
			this.ghost?.updateBody(
				bodyIndex,
				mat4Compose(
					[pos[0] * unitsPerMeter, pos[1] * unitsPerMeter, pos[2] * unitsPerMeter],
					quat,
					[1, 1, 1]
				)
			)
		})
		if (this.session) updateDriveInput(this.session)
		debugVectors.length = 0
		this.session?.readActiveVelocities((_uuid: string, pos: Vec3, vel: Vec3) => {
			debugVectors.push({
				from: [pos[0] * unitsPerMeter, pos[1] * unitsPerMeter, pos[2] * unitsPerMeter],
				to: [
					(pos[0] + vel[0] * 0.25) * unitsPerMeter,
					(pos[1] + vel[1] * 0.25) * unitsPerMeter,
					(pos[2] + vel[2] * 0.25) * unitsPerMeter
				]
			})
		})
		viz?.updateDebug()
		// sensor contact states at 4Hz (contact listener itself stays O(1) per callback)
		if (++frameCounter % 15 === 0 && this.session) {
			const states = this.session.getSensorStates()
			sensorDots.length = 0
			let activeCount = 0
			for (const state of states) {
				if (state.contacts > 0) activeCount++
			}
			sensorSummary = states.length ? ` · sensors ${activeCount}/${states.length}` : ''
			if (states.length) {
				this.session.readTransforms((uuid: string, _index: number, pos: Vec3) => {
					const state = states.find(s => s.uuid === uuid)
					if (state)
						sensorDots.push({
							pos: [pos[0] * unitsPerMeter, pos[1] * unitsPerMeter, pos[2] * unitsPerMeter],
							active: state.contacts > 0
						})
				})
				viz?.refresh()
			}
		}
		panelApi?.refreshStatus()
	},

	async start() {
		if (!store || this.mode !== 'idle' || this.starting) return
		// WASM load is async and mode stays 'idle' until it finishes — without this flag a second
		// Simulate click starts a second session: the first session leaks (never stopped) and both
		// rAF loops keep stepping the shared sim state forever
		this.starting = true
		try {
			const snapshot = adapter.takeSnapshot()
			const pipeline = buildPhysicsFromSnapshot(snapshot, store)
			const bodies = pipeline.bodyDescs.filter(b => b.shape)
			if (!bodies.length) {
				adapter.showMessage(t('msg.no_bodies'), 5000)
				return
			}
			if (pipeline.skipped.length) {
				adapter.showMessage(t('msg.skipped', pipeline.skipped.length), 4000)
			}
			const constraints = store
				.listConstraints()
				.map(c => sanitizeConstraint(c))
				.filter((c): c is ConstraintData => !!c)
				.map(c => constraintToExport(c, pipeline.scale))
			const settings: Settings = pipeline.settings

			adapter.showMessage(t('msg.loading'), 2000)
			panelApi?.refreshStatus()
			let Jolt: JoltNS
			try {
				Jolt = await loadJolt()
			} catch (err: any) {
				console.error(err)
				adapter.showMessage(t('msg.load_failed', String(err?.message || err)), 8000)
				panelApi?.refreshStatus()
				return
			}

			const session = new SimSession({
				Jolt,
				bodies,
				constraints,
				gravity: settings.gravity,
				ground: { enabled: settings.groundEnabled, y: pipeline.groundY - 0.02 },
				unitsPerMeter: settings.unitsPerMeter
			})
			try {
				session.start()
			} catch (err: any) {
				console.error('behemiron_jolt: simulation failed to start', err)
				adapter.showMessage(t('msg.sim_failed', err?.message || err), 6000)
				session.stop()
				return
			}

			// Ghost view: clone element meshes, drive with physics transforms
			const ghost = new GhostView(adapter.scene())
			const bodyVis: GhostBody[] = bodies.map((body, bodyIndex) => ({
				bodyIndex,
				bodyMatrix: body.frame,
				items: body.elementUuids
					.map(uuid => {
						const mesh = adapter.getElementMesh(uuid)
						if (!mesh) return null
						return { mesh, offset: mat4Multiply(mat4Invert(body.frame), adapter.matrixOfMesh(mesh)) }
					})
					.filter((item): item is { mesh: AnyBB; offset: number[] } => !!item)
			}))
			ghost.build(bodyVis)

			this.session = session
			this.ghost = ghost
			this.mode = 'running'
			this.lastTime = performance.now()
			attachDriveInput(session)
			// collect kinematic bodies driven by the Blockbench animation
			const Group = bbGlobal('Group')
			animatedBodies = bodies
				.filter(b => b.props.motionType === 'Kinematic' && b.props.animationDriven)
				.map(b => ({ uuid: b.uuid, group: (Group.all || []).find((g: AnyBB) => g.uuid === b.uuid) }))
				.filter((x: { uuid: string; group: AnyBB }) => !!x.group)
			panelApi?.rebuild()
			adapter.dispatch('behemiron_jolt_refresh')

			const loop = (now: number) => {
				if (this.mode !== 'running') return
				const dt = Math.min((now - this.lastTime) / 1000, 0.25)
				this.lastTime = now
				this.driveAnimated()
				this.session?.step(dt)
				this.sync()
				this.rafId = requestAnimationFrame(loop)
			}
			this.driveAnimated()
			this.rafId = requestAnimationFrame(loop)
		} finally {
			this.starting = false
		}
	},

	reset() {
		if (this.rafId !== null) cancelAnimationFrame(this.rafId)
		this.rafId = null
		try {
			this.session?.stop()
		} catch (e) {
			console.warn('session stop', e)
		}
		try {
			this.ghost?.restore()
		} catch (e) {
			console.warn('ghost restore', e)
		}
		const leftover = diag.totalLive()
		if (leftover !== 0)
			console.warn(`behemiron_jolt: ${leftover} Jolt wrapper objects not freed —`, diag.report())
		this.session = null
		this.ghost = null
		this.mode = 'idle'
		driveListeners?.()
		driveListeners = null
		animatedBodies = []
		debugVectors.length = 0
		sensorDots.length = 0
		sensorSummary = ''
		frameCounter = 0
		viz?.updateDebug()
		panelApi?.rebuild()
		adapter.dispatch('behemiron_jolt_refresh')
	}
}

function registerActions(): void {
	const Action = bbGlobal('Action')
	const Keybind = bbGlobal('Keybind')
	const MenuBar = (globalThis as any).MenuBar

	// F5–F8 are unbound in Blockbench defaults (only F11 is taken, main_tools.ts:273)
	const simulateAction = new Action('behemiron_jolt_simulate', {
		name: t('action.simulate.name'),
		description: t('action.simulate.description'),
		icon: 'play_arrow',
		keybind: new Keybind({ key: 116 }),
		click() {
			sim.toggle()
		}
	})
	const stepAction = new Action('behemiron_jolt_step', {
		name: t('action.step.name'),
		description: t('action.step.description'),
		icon: 'skip_next',
		keybind: new Keybind({ key: 117 }),
		click() {
			sim.stepOnce()
		}
	})
	const resetAction = new Action('behemiron_jolt_reset', {
		name: t('action.reset.name'),
		description: t('action.reset.description'),
		icon: 'replay',
		keybind: new Keybind({ key: 118 }),
		click() {
			sim.reset()
		}
	})
	const constraintAction = new Action('behemiron_jolt_new_constraint', {
		name: t('action.constraint.name'),
		description: t('action.constraint.description'),
		icon: 'add',
		click() {
			openConstraintWizard(editorCtx())
		}
	})
	const bakeAction = new Action('behemiron_jolt_bake', {
		name: t('action.bake.name'),
		description: t('action.bake.description'),
		icon: 'movie',
		keybind: new Keybind({ key: 119 }),
		click() {
			if (!store || sim.isActive()) {
				adapter.showMessage(t('bake.sim_active'), 4000)
				return
			}
			openBakeDialog({
				store,
				projectName: adapter.projectName,
				takeSnapshot: adapter.takeSnapshot,
				showMessage: adapter.showMessage,
				selectedGroupUuids: () => adapter.getSelection().groups.map((g: AnyBB) => g.uuid)
			})
		}
	})
	const checkpointSaveAction = new Action('behemiron_jolt_checkpoint_save', {
		name: t('action.checkpoint_save.name'),
		description: t('action.checkpoint_save.description'),
		icon: 'save',
		click() {
			const ok = sim.session?.saveCheckpoint()
			adapter.showMessage(ok ? t('msg.checkpoint_saved') : t('msg.checkpoint_failed'), 3000)
		}
	})
	const checkpointRestoreAction = new Action('behemiron_jolt_checkpoint_restore', {
		name: t('action.checkpoint_restore.name'),
		description: t('action.checkpoint_restore.description'),
		icon: 'settings_backup_restore',
		click() {
			const ok = sim.session?.restoreCheckpoint()
			if (ok) sim.sync()
			adapter.showMessage(ok ? t('msg.checkpoint_restored') : t('msg.checkpoint_failed'), 3000)
		}
	})
	actions = [
		simulateAction,
		stepAction,
		resetAction,
		constraintAction,
		bakeAction,
		checkpointSaveAction,
		checkpointRestoreAction
	]
	for (const action of actions) {
		MenuBar.menus.tools.addAction(action)
	}
}

const pluginRef: {
	offProjectChange?: () => void
	offLoad?: () => void
	offUndo?: () => void
	offRedo?: () => void
	offEdit?: () => void
	offVizRefresh?: () => void
	offStoreViz?: () => void
} = {}

// blockbench-types declares Plugin as a class; the register static is added by the loader at runtime
const PluginRegister = Plugin as unknown as { register(id: string, meta: Record<string, any>): void }

PluginRegister.register('behemiron_jolt', {
	title: 'Behemiron Jolt Physics',
	author: 'Behemiron',
	description: t('plugin.description'),
	icon: 'fas.fa-atom',
	version: '0.3.0',
	variant: 'both',
	min_version: '5.0.0',
	tags: ['Minecraft'],

	onload() {
		initI18n()
		store = createStore()
		persistDetach = attachPersist(store)
		history = createEditHistory(store, {
			initEdit: aspects => bbGlobal('Undo').initEdit(aspects),
			finishEdit: (message, aspects) => bbGlobal('Undo').finishEdit(message, aspects),
			addListener: (name, cb) => adapter.onEvent(name, cb),
			removeListener: (name, cb) => Blockbench.removeListener(name, cb)
		})
		panelApi = createPanel({
			store,
			sim,
			history,
			getSelection: adapter.getSelection,
			bodyDisplayName: adapter.bodyDisplayName,
			onEditConstraint: openEditorById,
			onEditController,
			onEditBody,
			onEditStates
		})
		viz = createViz({
			projectPoint: adapter.projectPoint,
			screenToWorld: adapter.screenToWorld,
			comByUuid: adapter.comByUuid,
			getSelectionUuids: () => adapter.getSelection().groups.map((g: AnyBB) => g.uuid),
			onPickConstraint: openEditorById,
			onMoveHandle,
			isSimActive: () => sim.isActive(),
			getDebugVectors: () => debugVectors,
			getSensorDots: () => sensorDots
		})
		registerActions()

		// history changes mutate names/geometry/selection outside our store — rebuild the panel and
		// re-project gizmos or BB undo/redo leaves stale values on screen (undo.js dispatches both)
		const onHistoryChange = () => {
			panelApi?.rebuild()
			refreshViz()
		}
		pluginRef.offProjectChange = adapter.onEvent('new_project', () => {
			if (sim.isActive()) sim.reset()
			// persist resets the store on this event; without a rebuild the panel keeps showing the
			// previous project's body form and the viz keeps the previous project's gizmos
			panelApi?.rebuild()
			refreshViz()
		})
		pluginRef.offLoad = adapter.onEvent('load_project', () => {
			if (sim.isActive()) sim.reset()
			panelApi?.rebuild()
			refreshViz()
		})
		pluginRef.offUndo = adapter.onEvent('undo', onHistoryChange)
		pluginRef.offRedo = adapter.onEvent('redo', onHistoryChange)
		// gizmos that track body centers (gear/rack crosses, hinge ref arcs) follow viewport drags:
		// BB fires 'finished_edit' at drag end, not a selection change
		pluginRef.offEdit = adapter.onEvent('finished_edit', refreshViz)
		pluginRef.offVizRefresh = adapter.onEvent('behemiron_jolt_refresh', refreshViz)
		// store-driven echo: constraint changes from anywhere (dialogs, gizmo, history) re-project
		pluginRef.offStoreViz = store.subscribe(change => {
			if (change.kind === 'constraints' || change.kind === 'load') refreshViz()
		})
		refreshViz()
		console.log('Behemiron Jolt Physics loaded (Jolt WASM: ' + joltLoadState().status + ')')
	},

	onunload() {
		sim.reset()
		pluginRef.offProjectChange?.()
		pluginRef.offLoad?.()
		pluginRef.offUndo?.()
		pluginRef.offRedo?.()
		pluginRef.offEdit?.()
		pluginRef.offVizRefresh?.()
		pluginRef.offStoreViz?.()
		history?.dispose()
		history = null
		viz?.dispose()
		viz = null
		panelApi?.dispose()
		persistDetach?.()
		for (const action of actions) action.delete?.()
		actions = []
		panelApi = null
		persistDetach = null
		store = null
	}
})
