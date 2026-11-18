// Model-instance collision pair rule, mirrored by the engine (docs/FORMAT.md §3):
// - two bodies whose collisionGroup is equal and non-zero NEVER collide (group wins over everything)
// - otherwise two bodies of the same model instance collide iff either one opts in via selfCollide
// The editor realizes this with one Jolt CollisionGroup/GroupFilterTable per session
// (SubGroupID = body index + 1); the engine uses the same construction via jolt-jni.

export interface CollideProps {
	collisionGroup: number
	selfCollide: boolean
}

export function collidePairProps(a: CollideProps, b: CollideProps): boolean {
	if (a.collisionGroup > 0 && a.collisionGroup === b.collisionGroup) return false
	return a.selfCollide || b.selfCollide
}

/** Full symmetric matrix for a body list; pure reference for engine parity. */
export function collisionPairs(bodies: CollideProps[]): boolean[][] {
	const n = bodies.length
	const matrix: boolean[][] = Array.from({ length: n }, () => new Array(n).fill(false))
	for (let i = 0; i < n; i++) {
		for (let j = i + 1; j < n; j++) {
			const v = collidePairProps(bodies[i], bodies[j])
			matrix[i][j] = v
			matrix[j][i] = v
		}
	}
	return matrix
}
