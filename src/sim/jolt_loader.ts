// Loads the real Jolt engine (WASM, single-threaded wasm-compat build, WASM embedded as base64).
// CDN dynamic import with fallbacks; failure degrades gracefully (sim disabled, everything else works).

import type initJolt from 'jolt-physics'
import patchedJoltCode from 'virtual:patched-jolt'

export type JoltNS = Awaited<ReturnType<typeof initJolt>>

const JOLT_URL = 'https://cdn.jsdelivr.net/npm/jolt-physics@1.1.1/dist/jolt-physics.wasm-compat.min.js'

interface LoadState {
	status: 'unloaded' | 'loading' | 'ready' | 'error'
	error: string | null
}

let pending: Promise<JoltNS> | null = null
let state: LoadState = { status: 'unloaded', error: null }

export function joltLoadState(): LoadState {
	return { ...state }
}

// Patched build (vendored, single-file distribution): string → Blob → dynamic import.
async function loadPatched(): Promise<JoltNS> {
	const blob = new Blob([patchedJoltCode], { type: 'text/javascript' })
	const url = URL.createObjectURL(blob)
	try {
		const mod: any = await import(url)
		const factory: (opts?: object) => Promise<JoltNS> = mod.default || mod
		return await factory()
	} finally {
		URL.revokeObjectURL(url)
	}
}

export async function loadJolt(): Promise<JoltNS> {
	if (state.status === 'ready' && pending) return pending
	if (pending) return pending
	state = { status: 'loading', error: null }
	pending = (async (): Promise<JoltNS> => {
		if (patchedJoltCode.length > 1000) {
			try {
				const Jolt = await loadPatched()
				state = { status: 'ready', error: null, source: 'patched' } as LoadState
				return Jolt
			} catch (err) {
				console.warn('behemiron_jolt: patched build failed, falling back to CDN', err)
			}
		}
		let mod: any
		try {
			mod = await import(JOLT_URL)
		} catch {
			// Fallback: indirect eval (works inside BlockBench's `new Function` plugin scope)
			const importer = (0, eval)('(url) => import(url)') as (url: string) => Promise<any>
			mod = await importer(JOLT_URL)
		}
		const factory: (opts?: object) => Promise<JoltNS> = mod.default || mod
		const Jolt = await factory()
		state = { status: 'ready', error: null }
		return Jolt
	})()
	try {
		return await pending
	} catch (err: any) {
		state = { status: 'error', error: String(err?.message || err) }
		pending = null
		throw new Error(state.error ?? 'unknown')
	}
}
