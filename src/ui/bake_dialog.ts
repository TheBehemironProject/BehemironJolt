// Physics → Blockbench animation baking. Performance contract:
// Baking runs a headless session: fixed 60Hz stepping, preallocated sample buffers (zero
// per-sample allocation), time-sliced loop (<40ms per slice) with a live progress bar.

import { planBake, createSampleBuffers, writeSample, extractChannels } from '../core/bake_animation.ts'
import { buildPhysicsFromSnapshot, type BodyDesc } from '../core/pipeline.ts'
import { sanitizeConstraint, constraintToExport } from '../core/constraints.ts'
import { SimSession } from '../sim/session.ts'
import { loadJolt } from '../sim/jolt_loader.ts'
import type { PhysicsStore } from '../core/store.ts'
import type { Snapshot } from '../core/pipeline.ts'
import { t } from './i18n.ts'

type AnyBB = any

export interface BakeCtx {
	store: PhysicsStore
	projectName(): string
	takeSnapshot(): Snapshot
	showMessage(message: string, timeout?: number): void
	selectedGroupUuids(): string[]
}

function bbGlobal(name: string): AnyBB {
	return (globalThis as any)[name] || (globalThis as any).Blockbench?.[name]
}

const nextSlice = () => new Promise<void>(resolve => setTimeout(resolve, 0))

export function openBakeDialog(ctx: BakeCtx): void {
	const Dialog = bbGlobal('Dialog')
	const dialog = new Dialog('behemiron_jolt_bake', {
		title: t('bake.title'),
		width: 480,
		form: {
			name: { type: 'text', label: t('bake.name'), value: ctx.projectName() + '_physics' },
			duration: { type: 'number', label: t('bake.duration'), value: 5, min: 0.1, max: 120, step: 0.5 },
			fps: { type: 'number', label: t('bake.fps'), value: 20, min: 1, max: 60, step: 1 },
			scope: {
				type: 'select',
				label: t('bake.scope'),
				value: 'dynamic',
				options: { dynamic: t('bake.scope_dynamic'), selected: t('bake.scope_selected') }
			},
			note: { type: 'info', text: t('bake.note') }
		},
		progress_bar: { progress: 0 },
		onConfirm(result: Record<string, any>) {
			runBake(ctx, dialog, result).catch(err => {
				console.error('behemiron_jolt: bake failed', err)
				ctx.showMessage(String(err?.message || err), 6000)
				dialog.close()
			})
			return false // keep the dialog open (progress bar lives here)
		},
		onCancel() {
			// Cancel button, X button and Esc all route through onCancel — refuse mid-bake closes
			if (baking) return false
		}
	})
	dialog.show()
}

let baking = false

function setButtonsEnabled(dialog: AnyBB, enabled: boolean): void {
	const buttons: NodeListOf<HTMLButtonElement> | undefined =
		dialog.object?.querySelectorAll?.('.button_bar button')
	buttons?.forEach(button => {
		button.disabled = !enabled
	})
}

async function runBake(ctx: BakeCtx, dialog: AnyBB, opts: Record<string, any>): Promise<void> {
	if (baking) return // re-entrancy guard: a second Confirm must not start a concurrent bake
	baking = true
	setButtonsEnabled(dialog, false)
	try {
		await runBakeInner(ctx, dialog, opts)
	} finally {
		baking = false
		setButtonsEnabled(dialog, true)
	}
}

async function runBakeInner(ctx: BakeCtx, dialog: AnyBB, opts: Record<string, any>): Promise<void> {
	const snapshot = ctx.takeSnapshot()
	const pipeline = buildPhysicsFromSnapshot(snapshot, ctx.store)
	const selected = new Set(opts.scope === 'selected' ? ctx.selectedGroupUuids() : [])
	// bake bodies that can move; bone (group) bodies only — root elements have no bone animator
	const bodies: BodyDesc[] = pipeline.bodyDescs.filter(b => {
		if (!b.shape) return false
		if (selected.size && !selected.has(b.uuid)) return false
		return b.props.motionType !== 'Static' && b.elementUuids.length > 0 && b.uuid !== b.elementUuids[0]
	})
	if (!bodies.length) {
		ctx.showMessage(t('bake.no_bodies'), 5000)
		dialog.hide() // programmatic close bypasses the onCancel mid-bake guard
		return
	}
	const constraints = ctx.store
		.listConstraints()
		.map(c => sanitizeConstraint(c))
		.filter((c): c is NonNullable<typeof c> => !!c)
		.map(c => constraintToExport(c, pipeline.scale))

	let Jolt
	try {
		Jolt = await loadJolt()
	} catch (err: any) {
		ctx.showMessage(t('msg.load_failed', String(err?.message || err)), 8000)
		dialog.hide() // programmatic close bypasses the onCancel mid-bake guard
		return
	}

	const setup = planBake(Number(opts.duration) || 5, Number(opts.fps) || 20)
	const session = new SimSession({
		Jolt,
		bodies,
		constraints,
		gravity: pipeline.settings.gravity,
		ground: { enabled: pipeline.settings.groundEnabled, y: pipeline.groundY - 0.02 }
	})
	session.start()

	const buffers = createSampleBuffers(bodies.length, setup.numSamples)
	const upm = pipeline.settings.unitsPerMeter
	const readAll = (sampleIndex: number) => {
		session.readTransforms((_uuid: string, index: number, pos: number[], quat: number[]) => {
			writeSample(buffers, index, sampleIndex, setup.numSamples, pos, quat)
		})
	}

	readAll(0)
	const SLICE_MS = 40
	let sliceStart = performance.now()
	for (let s = 1; s < setup.numSamples; s++) {
		for (let k = 0; k < setup.sampleSteps[s]; k++) {
			session.step(1 / 60)
		}
		readAll(s)
		if (performance.now() - sliceStart > SLICE_MS) {
			dialog.progress_bar?.setProgress?.(s / setup.numSamples)
			await nextSlice()
			sliceStart = performance.now()
		}
	}
	session.stop()
	dialog.progress_bar?.setProgress?.(1)

	// write the Blockbench animation (single undo entry)
	const Animation = bbGlobal('Animation')
	const BoneAnimator = bbGlobal('BoneAnimator')
	const Keyframe = bbGlobal('Keyframe')
	const Undo = bbGlobal('Undo')
	const animation = new Animation({ name: String(opts.name || 'physics_bake'), length: setup.duration })
	Undo.initEdit({ animations: [] })
	for (let i = 0; i < bodies.length; i++) {
		const body = bodies[i]
		const animator = (animation.animators[body.uuid] = new BoneAnimator(body.uuid, animation))
		const channels = extractChannels(buffers, i, setup.numSamples, setup.fps, upm, setup.sampleTimes)
		for (let s = 0; s < channels.times.length; s++) {
			const time = channels.times[s]
			const p = channels.positions[s]
			const r = channels.rotationsDeg[s]
			// `keyframes` is a read-only aggregate getter — insert into the per-channel arrays
			// (canonical: timeline_animators.js:86,114)
			animator.position.push(
				new Keyframe(
					{ channel: 'position', time, data_points: [{ x: p[0], y: p[1], z: p[2] }] },
					body.uuid,
					animator
				)
			)
			animator.rotation.push(
				new Keyframe(
					{ channel: 'rotation', time, data_points: [{ x: r[0], y: r[1], z: r[2] }] },
					body.uuid,
					animator
				)
			)
		}
	}
	// register with the project (canonical: animation.js add → Animator.animations)
	animation.add?.(false)
	Undo.finishEdit(t('bake.undo'), { animations: [animation] })
	animation.select?.()

	dialog.hide() // programmatic close bypasses the onCancel mid-bake guard
	ctx.showMessage(t('bake.done', bodies.length, setup.duration), 5000)
	;(globalThis as any).Blockbench?.dispatchEvent?.('behemiron_jolt_refresh')
}
