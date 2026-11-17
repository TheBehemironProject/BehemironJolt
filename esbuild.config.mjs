import * as esbuild from 'esbuild'
import { readFileSync } from 'node:fs'

const minify = process.argv.includes('--minify')
const watch = process.argv.includes('--watch')

// Embed the patched JoltPhysics.js build (WASM+glue) as a string so the plugin ships as a single
// file with zero external dependencies. Falls back to empty when the artifact is absent (CDN path).
const patchedJolt = {
	name: 'patched-jolt',
	setup(build) {
		build.onResolve({ filter: /^virtual:patched-jolt$/ }, args => ({
			path: args.path,
			namespace: 'patched-jolt'
		}))
		build.onLoad({ filter: /.*/, namespace: 'patched-jolt' }, () => {
			let code = ''
			try {
				code = readFileSync('vendor/jolt-patched/jolt-physics.wasm-compat.js', 'utf-8')
			} catch {
				console.warn('[build] vendor/jolt-patched artifact not found — plugin will use CDN fallback')
			}
			return { contents: `export default ${JSON.stringify(code)}`, loader: 'js' }
		})
	}
}

const options = {
	entryPoints: ['src/main.ts'],
	bundle: true,
	format: 'iife',
	target: 'es2020',
	outfile: 'dist/behemiron_jolt.js',
	logLevel: 'info',
	minify,
	plugins: [patchedJolt],
	banner: {
		js: `/* Behemiron Jolt Physics v0.3.0 | BlockBench plugin | Jolt (c) Jorrit Rouwe, MIT (patched build vendored) | drag into BlockBench or load via Plugins menu */`
	}
}

if (watch) {
	const ctx = await esbuild.context(options)
	await ctx.watch()
	console.log('watching…')
} else {
	await esbuild.build(options)
	// freshness guard: this workspace has a known stale-read trap (tool-visible file lag between
	// write and a build in the same message) — fail loudly if any source is newer than the bundle
	const { statSync, readdirSync } = await import('node:fs')
	const { join } = await import('node:path')
	const newest = (dir) => {
		let max = 0
		for (const name of readdirSync(dir, { withFileTypes: true })) {
			const p = join(dir, name.name)
			if (name.isDirectory()) max = Math.max(max, newest(p))
			else max = Math.max(max, statSync(p).mtimeMs)
		}
		return max
	}
	const srcNewest = newest('src')
	const outTime = statSync(options.outfile).mtimeMs
	if (srcNewest > outTime + 1) {
		console.error('[build] WARNING: a source file is newer than the bundle — the build likely read stale content. Re-run `npm run build`.')
		process.exitCode = 1
	} else {
		console.log('[build] fresh ✓')
	}
}
