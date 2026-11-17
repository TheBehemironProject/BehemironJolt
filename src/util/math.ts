// Column-major 4x4 matrices (THREE.js layout), plain arrays. Zero dependencies.

export type Vec3 = number[]
export type Quat = number[] // [x, y, z, w]
export type Mat4 = number[] // 16 elements, column-major

export function mat4Identity(): Mat4 {
	return [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1]
}

export function mat4Copy(m: Mat4): Mat4 {
	return m.slice(0, 16)
}

export function mat4FromElements(elements: ArrayLike<number>): Mat4 {
	return Array.from(elements)
}

// out = a * b
export function mat4Multiply(a: Mat4, b: Mat4): Mat4 {
	const out = new Array<number>(16)
	for (let c = 0; c < 4; c++) {
		for (let r = 0; r < 4; r++) {
			let s = 0
			for (let k = 0; k < 4; k++) s += a[k * 4 + r] * b[c * 4 + k]
			out[c * 4 + r] = s
		}
	}
	return out
}

export function mat4Invert(m: Mat4): Mat4 {
	const inv = new Array<number>(16)
	inv[0] =
		m[5] * m[10] * m[15] -
		m[5] * m[11] * m[14] -
		m[9] * m[6] * m[15] +
		m[9] * m[7] * m[14] +
		m[13] * m[6] * m[11] -
		m[13] * m[7] * m[10]
	inv[4] =
		-m[4] * m[10] * m[15] +
		m[4] * m[11] * m[14] +
		m[8] * m[6] * m[15] -
		m[8] * m[7] * m[14] -
		m[12] * m[6] * m[11] +
		m[12] * m[7] * m[10]
	inv[8] =
		m[4] * m[9] * m[15] -
		m[4] * m[11] * m[13] -
		m[8] * m[5] * m[15] +
		m[8] * m[7] * m[13] +
		m[12] * m[5] * m[11] -
		m[12] * m[7] * m[9]
	inv[12] =
		-m[4] * m[9] * m[14] +
		m[4] * m[10] * m[13] +
		m[8] * m[5] * m[14] -
		m[8] * m[6] * m[13] -
		m[12] * m[5] * m[10] +
		m[12] * m[6] * m[9]
	inv[1] =
		-m[1] * m[10] * m[15] +
		m[1] * m[11] * m[14] +
		m[9] * m[2] * m[15] -
		m[9] * m[3] * m[14] -
		m[13] * m[2] * m[11] +
		m[13] * m[3] * m[10]
	inv[5] =
		m[0] * m[10] * m[15] -
		m[0] * m[11] * m[14] -
		m[8] * m[2] * m[15] +
		m[8] * m[3] * m[14] +
		m[12] * m[2] * m[11] -
		m[12] * m[3] * m[10]
	inv[9] =
		-m[0] * m[9] * m[15] +
		m[0] * m[11] * m[13] +
		m[8] * m[1] * m[15] -
		m[8] * m[3] * m[13] -
		m[12] * m[1] * m[11] +
		m[12] * m[3] * m[9]
	inv[13] =
		m[0] * m[9] * m[14] -
		m[0] * m[10] * m[13] -
		m[8] * m[1] * m[14] +
		m[8] * m[2] * m[13] +
		m[12] * m[1] * m[10] -
		m[12] * m[2] * m[9]
	inv[2] =
		m[1] * m[6] * m[15] -
		m[1] * m[7] * m[14] -
		m[5] * m[2] * m[15] +
		m[5] * m[3] * m[14] +
		m[13] * m[2] * m[7] -
		m[13] * m[3] * m[6]
	inv[6] =
		-m[0] * m[6] * m[15] +
		m[0] * m[7] * m[14] +
		m[4] * m[2] * m[15] -
		m[4] * m[3] * m[14] -
		m[12] * m[2] * m[7] +
		m[12] * m[3] * m[6]
	inv[10] =
		m[0] * m[5] * m[15] -
		m[0] * m[7] * m[13] -
		m[4] * m[1] * m[15] +
		m[4] * m[3] * m[13] +
		m[12] * m[1] * m[7] -
		m[12] * m[3] * m[5]
	inv[14] =
		-m[0] * m[5] * m[14] +
		m[0] * m[6] * m[13] +
		m[4] * m[1] * m[14] -
		m[4] * m[2] * m[13] -
		m[12] * m[1] * m[6] +
		m[12] * m[2] * m[5]
	inv[3] =
		-m[1] * m[6] * m[11] +
		m[1] * m[7] * m[10] +
		m[5] * m[2] * m[11] -
		m[5] * m[3] * m[10] -
		m[9] * m[2] * m[7] +
		m[9] * m[3] * m[6]
	inv[7] =
		m[0] * m[6] * m[11] -
		m[0] * m[7] * m[10] -
		m[4] * m[2] * m[11] +
		m[4] * m[3] * m[10] +
		m[8] * m[2] * m[7] -
		m[8] * m[3] * m[6]
	inv[11] =
		-m[0] * m[5] * m[11] +
		m[0] * m[7] * m[9] +
		m[4] * m[1] * m[11] -
		m[4] * m[3] * m[9] -
		m[8] * m[1] * m[7] +
		m[8] * m[3] * m[5]
	inv[15] =
		m[0] * m[5] * m[10] -
		m[0] * m[6] * m[9] -
		m[4] * m[1] * m[10] +
		m[4] * m[2] * m[9] +
		m[8] * m[1] * m[6] -
		m[8] * m[2] * m[5]
	const det = m[0] * inv[0] + m[1] * inv[4] + m[2] * inv[8] + m[3] * inv[12]
	if (!det) return mat4Identity()
	const id = 1 / det
	for (let i = 0; i < 16; i++) inv[i] *= id
	return inv
}

export function transformPoint(m: Mat4, v: Vec3): Vec3 {
	const [x, y, z] = v
	const w = m[3] * x + m[7] * y + m[11] * z + m[15]
	const iw = w ? 1 / w : 1
	return [
		(m[0] * x + m[4] * y + m[8] * z + m[12]) * iw,
		(m[1] * x + m[5] * y + m[9] * z + m[13]) * iw,
		(m[2] * x + m[6] * y + m[10] * z + m[14]) * iw
	]
}

export interface Decomposed {
	position: Vec3
	quaternion: Quat
	scale: Vec3
}

export function mat4Compose(position: Vec3, quaternion: Quat, scale: Vec3 = [1, 1, 1]): Mat4 {
	const [qx, qy, qz, qw] = quaternion
	const [sx, sy, sz] = scale
	const x2 = qx + qx,
		y2 = qy + qy,
		z2 = qz + qz
	const xx = qx * x2,
		xy = qx * y2,
		xz = qx * z2
	const yy = qy * y2,
		yz = qy * z2,
		zz = qz * z2
	const wx = qw * x2,
		wy = qw * y2,
		wz = qw * z2
	return [
		(1 - (yy + zz)) * sx,
		(xy + wz) * sx,
		(xz - wy) * sx,
		0,
		(xy - wz) * sy,
		(1 - (xx + zz)) * sy,
		(yz + wx) * sy,
		0,
		(xz + wy) * sz,
		(yz - wx) * sz,
		(1 - (xx + yy)) * sz,
		0,
		position[0],
		position[1],
		position[2],
		1
	]
}

export function mat4Decompose(m: Mat4): Decomposed {
	const position: Vec3 = [m[12], m[13], m[14]]
	let sx = Math.hypot(m[0], m[1], m[2])
	const sy = Math.hypot(m[4], m[5], m[6])
	const sz = Math.hypot(m[8], m[9], m[10])
	if (mat4Determinant(m) < 0) sx = -sx
	const rm = [
		m[0] / sx,
		m[1] / sx,
		m[2] / sx,
		m[4] / sy,
		m[5] / sy,
		m[6] / sy,
		m[8] / sz,
		m[9] / sz,
		m[10] / sz
	]
	return { position, quaternion: quatFromBasis(rm), scale: [sx, sy, sz] }
}

export function mat4Determinant(m: Mat4): number {
	return (
		m[12] * m[1] * m[10] * m[7] -
		m[12] * m[1] * m[6] * m[11] +
		m[12] * m[5] * m[2] * m[11] -
		m[12] * m[5] * m[10] * m[3] -
		m[12] * m[9] * m[2] * m[7] +
		m[12] * m[9] * m[6] * m[3] -
		m[4] * m[1] * m[10] * m[15] +
		m[4] * m[1] * m[14] * m[11] -
		m[4] * m[5] * m[2] * m[11] +
		m[4] * m[5] * m[10] * m[3] +
		m[4] * m[9] * m[2] * m[15] -
		m[4] * m[9] * m[14] * m[3] -
		m[8] * m[1] * m[6] * m[15] +
		m[8] * m[1] * m[14] * m[7] -
		m[8] * m[5] * m[2] * m[15] +
		m[8] * m[5] * m[14] * m[3] +
		m[8] * m[9] * m[2] * m[7] -
		m[8] * m[9] * m[6] * m[3] -
		m[12] * m[1] * m[6] * m[11] +
		m[12] * m[1] * m[10] * m[7] -
		m[12] * m[5] * m[2] * m[11] +
		m[12] * m[5] * m[6] * m[3] +
		m[12] * m[9] * m[2] * m[7] -
		m[12] * m[9] * m[6] * m[3] +
		m[0] * m[13] * m[6] * m[11] -
		m[0] * m[13] * m[10] * m[7] -
		m[0] * m[5] * m[14] * m[11] +
		m[0] * m[5] * m[10] * m[15] -
		m[0] * m[9] * m[14] * m[7] +
		m[0] * m[9] * m[6] * m[15] +
		m[0] * m[13] * m[2] * m[11] -
		m[0] * m[13] * m[10] * m[3] -
		m[0] * m[1] * m[14] * m[11] +
		m[0] * m[1] * m[10] * m[15] -
		m[0] * m[9] * m[2] * m[15] +
		m[0] * m[9] * m[14] * m[3] +
		m[0] * m[1] * m[6] * m[15] -
		m[0] * m[1] * m[14] * m[7] +
		m[0] * m[5] * m[14] * m[3] -
		m[0] * m[5] * m[2] * m[15] +
		m[0] * m[9] * m[2] * m[3] -
		m[0] * m[9] * m[6] * m[3]
	)
}

// rm: 9 numbers — column vectors concatenated: [c0, c1, c2]
export function quatFromBasis(rm: number[]): Quat {
	const m00 = rm[0],
		m10 = rm[1],
		m20 = rm[2]
	const m01 = rm[3],
		m11 = rm[4],
		m21 = rm[5]
	const m02 = rm[6],
		m12 = rm[7],
		m22 = rm[8]
	const trace = m00 + m11 + m22
	let x: number, y: number, z: number, w: number
	if (trace > 0) {
		const s = 0.5 / Math.sqrt(trace + 1)
		w = 0.25 / s
		x = (m21 - m12) * s
		y = (m02 - m20) * s
		z = (m10 - m01) * s
	} else if (m00 > m11 && m00 > m22) {
		const s = 2 * Math.sqrt(1 + m00 - m11 - m22)
		w = (m21 - m12) / s
		x = 0.25 * s
		y = (m01 + m10) / s
		z = (m02 + m20) / s
	} else if (m11 > m22) {
		const s = 2 * Math.sqrt(1 + m11 - m00 - m22)
		w = (m02 - m20) / s
		x = (m01 + m10) / s
		y = 0.25 * s
		z = (m12 + m21) / s
	} else {
		const s = 2 * Math.sqrt(1 + m22 - m00 - m11)
		w = (m10 - m01) / s
		x = (m02 + m20) / s
		y = (m12 + m21) / s
		z = 0.25 * s
	}
	const len = Math.hypot(x, y, z, w) || 1
	return [x / len, y / len, z / len, w / len]
}

export function quatAxisAngle(axis: Vec3, angle: number): Quat {
	const [ax, ay, az] = axis
	const half = angle / 2
	const s = Math.sin(half)
	const len = Math.hypot(ax, ay, az) || 1
	return [(ax / len) * s, (ay / len) * s, (az / len) * s, Math.cos(half)]
}

export const QUAT_IDENTITY: Quat = [0, 0, 0, 1]

// Quaternion that rotates unit axis `from` onto unit axis `to`
export function quatBetween(from: Vec3, to: Vec3): Quat {
	const [ax, ay, az] = from
	const [bx, by, bz] = to
	const dot = ax * bx + ay * by + az * bz
	if (dot > 0.999999) return QUAT_IDENTITY.slice()
	if (dot < -0.999999) {
		let px = 1,
			py = 0,
			pz = 0
		if (Math.abs(ax) > 0.9) {
			px = 0
			py = 1
		}
		return quatAxisAngle([ay * pz - az * py, az * px - ax * pz, ax * py - ay * px], Math.PI)
	}
	const cx = ay * bz - az * by
	const cy = az * bx - ax * bz
	const cz = ax * by - ay * bx
	const w = Math.sqrt((1 + dot) / 2)
	return [cx / (2 * w), cy / (2 * w), cz / (2 * w), w]
}

export function quatMul(a: Quat, b: Quat): Quat {
	const [ax, ay, az, aw] = a
	const [bx, by, bz, bw] = b
	return [
		aw * bx + ax * bw + ay * bz - az * by,
		aw * by - ax * bz + ay * bw + az * bx,
		aw * bz + ax * by - ay * bx + az * bw,
		aw * bw - ax * bx - ay * by - az * bz
	]
}

export function quatConjugate(q: Quat): Quat {
	return [-q[0], -q[1], -q[2], q[3]]
}

export function vec3Add(a: Vec3, b: Vec3): Vec3 {
	return [a[0] + b[0], a[1] + b[1], a[2] + b[2]]
}
export function vec3Sub(a: Vec3, b: Vec3): Vec3 {
	return [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
export function vec3Scale(a: Vec3, s: number): Vec3 {
	return [a[0] * s, a[1] * s, a[2] * s]
}
export function vec3Length(a: Vec3): number {
	return Math.hypot(a[0], a[1], a[2])
}
export function vec3Distance(a: Vec3, b: Vec3): number {
	return vec3Length(vec3Sub(a, b))
}
export function vec3Normalize(a: Vec3): Vec3 {
	const l = vec3Length(a) || 1
	return [a[0] / l, a[1] / l, a[2] / l]
}
export function vec3Lerp(a: Vec3, b: Vec3, t: number): Vec3 {
	return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t, a[2] + (b[2] - a[2]) * t]
}

export interface BBox {
	min: Vec3
	max: Vec3
}

export function bboxOfPoints(points: Vec3[]): BBox {
	const min: Vec3 = [Infinity, Infinity, Infinity]
	const max: Vec3 = [-Infinity, -Infinity, -Infinity]
	for (const p of points) {
		for (let i = 0; i < 3; i++) {
			if (p[i] < min[i]) min[i] = p[i]
			if (p[i] > max[i]) max[i] = p[i]
		}
	}
	return { min, max }
}

export function isFiniteVec(v: ArrayLike<number>, dims = 3): boolean {
	for (let i = 0; i < dims; i++) if (!Number.isFinite(v[i])) return false
	return true
}

export function roundTo(v: number, digits: number): number {
	const f = 10 ** digits
	return Math.round(v * f) / f
}

// Quaternion → Euler XYZ (three.js convention), degrees, branch-continuous against `prev` (degrees).
// Continuity prevents 180° interpolation flips between baked samples. Every orientation has two
// XYZ euler families: (x,y,z) and (x+180°, 180°−y, z+180°); we wrap both by ±360° per axis and
// keep the candidate closest to the previous sample — so playback interpolation stays smooth
// through asin branch crossings (e.g. yaw past 90°). In gimbal lock (pitch ≈ ±90°) the absolute
// extraction is ill-conditioned; the small delta from the previous sample is integrated instead.
export function quatToEulerDegContinuous(q: Quat, prev?: Vec3, prevQuat?: Quat): Vec3 {
	const RAD2DEG = 180 / Math.PI
	const m = mat4Compose([0, 0, 0], q, [1, 1, 1])
	const m11 = m[0],
		m12 = m[4],
		m13 = m[8]
	const m21 = m[1],
		m22 = m[5],
		m23 = m[9]
	const m33 = m[10]
	const clamped = Math.min(1, Math.max(-1, m13))
	let candidates: Vec3[]
	if (Math.abs(m13) >= 0.9999999) {
		if (prev && prevQuat) {
			const dq = quatMul(quatConjugate(prevQuat), q)
			return [
				prev[0] + 2 * dq[0] * RAD2DEG,
				prev[1] + 2 * dq[1] * RAD2DEG,
				prev[2] + 2 * dq[2] * RAD2DEG
			]
		}
		candidates = [[Math.atan2(m21, m22) * RAD2DEG, Math.asin(clamped) * RAD2DEG, 0]]
	} else {
		const x = Math.atan2(-m23, m33)
		const y = Math.asin(clamped)
		const z = Math.atan2(-m12, m11)
		candidates = [
			[x * RAD2DEG, y * RAD2DEG, z * RAD2DEG],
			[(x + Math.PI) * RAD2DEG, (Math.PI - y) * RAD2DEG, (z + Math.PI) * RAD2DEG]
		]
	}
	if (!prev) return candidates[0]
	let best = candidates[0]
	let bestScore = Infinity
	for (const cand of candidates) {
		let score = 0
		for (let axis = 0; axis < 3; axis++) {
			let v = cand[axis]
			let dist = Math.abs(v - prev[axis])
			for (let k = -1; k <= 1; k++) {
				const d = Math.abs(v + k * 360 - prev[axis])
				if (d < dist) {
					dist = d
					v = v + k * 360
				}
			}
			score += dist
			if (score >= bestScore) break
		}
		if (score < bestScore) {
			bestScore = score
			best = cand.map((v, axis) => {
				let out = v
				let dist = Math.abs(out - prev[axis])
				for (let k = -1; k <= 1; k++) {
					const d = Math.abs(out + k * 360 - prev[axis])
					if (d < dist) {
						dist = d
						out = out + k * 360
					}
				}
				return out
			})
		}
	}
	return best
}
