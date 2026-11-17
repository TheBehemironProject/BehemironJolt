// Emscripten wrapper-object leak diagnostics. Session increments on alloc, decrements on destroy.

const counts = new Map<string, number>()

export function trackAlloc(label: string): void {
	counts.set(label, (counts.get(label) || 0) + 1)
}

export function trackFree(label: string): void {
	counts.set(label, (counts.get(label) || 0) - 1)
}

export function liveCount(label: string): number {
	return counts.get(label) || 0
}

export function totalLive(): number {
	let sum = 0
	for (const n of counts.values()) sum += n
	return sum
}

export function report(): string {
	const lines: string[] = []
	for (const [label, n] of counts) {
		if (n !== 0) lines.push(`${label}: ${n}`)
	}
	return lines.length ? lines.join(', ') : 'clean'
}

export function reset(): void {
	counts.clear()
}
