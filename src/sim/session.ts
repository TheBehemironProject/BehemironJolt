// Simulation session: builds a Jolt world from body descriptions, steps at a fixed rate,
// reads back transforms. Memory management follows JoltPhysics.js "proper cleanup" patterns;
// every wrapper object is tracked and destroyed on stop.

import * as diag from '../util/diag.ts'
import { CONSTRAINT_TYPES } from '../core/constraints.ts'
import type { ExportedConstraint } from '../core/constraints.ts'
import type { BodyDesc } from '../core/pipeline.ts'
import type { ShapeNode } from '../core/shapes.ts'
import type { Vec3, Quat } from '../util/math.ts'
import type { JoltNS } from './jolt_loader.ts'
import { sanitizeControllerParams } from '../core/controllers.ts'
import { buildSoftBodyMesh } from '../core/softbody.ts'
import { buildSkinWeights } from '../core/skin.ts'
import { generateHairStrands } from '../core/hair.ts'

const LAYER_NON_MOVING = 0
const LAYER_MOVING = 1
const FLT_MAX = 3.4028234663852886e38
const STEP = 1 / 60
const MAX_STEPS_PER_FRAME = 4

const SETTINGS_CLASS: Record<string, string> = {
	Fixed: 'FixedConstraintSettings',
	Distance: 'DistanceConstraintSettings',
	Hinge: 'HingeConstraintSettings',
	Slider: 'SliderConstraintSettings',
	Point: 'PointConstraintSettings',
	Cone: 'ConeConstraintSettings',
	SwingTwist: 'SwingTwistConstraintSettings',
	SixDOF: 'SixDOFConstraintSettings',
	Pulley: 'PulleyConstraintSettings',
	Gear: 'GearConstraintSettings',
	RackAndPinion: 'RackAndPinionConstraintSettings',
	Path: 'PathConstraintSettings'
}

export interface GroundConfig {
	enabled: boolean
	/** ground plane top, meters */
	y: number
}

// dynamic binding surfaces (WebIDL runtime lookups the static types can't model)
type Dyn = any

export class SimSession {
	private Jolt: JoltNS
	private bodies: BodyDesc[]
	private constraints: ExportedConstraint[]
	private gravity: Vec3
	private ground: GroundConfig
	private unitsPerMeter: number

	private jolt: any = null
	private physicsSystem: any = null
	private bodyInterface: any = null
	private bodyIds: { uuid: string; name: string; id: any; ptr: any; index: number; synced: boolean }[] = []
	private constraintPtrs: any[] = []
	private vehicles: { constraint: any; controller: any; bodyIndex: number }[] = []
	private characters: {
		virtual: any
		bodyIndex: number
		uuid: string
		updateArgs: 'short' | 'long' | null
	}[] = []
	/** set by the UI each frame while driving (WASD preview) */
	driveInput = { forward: 0, right: 0, brake: 0, handbrake: 0 }
	private groundBodyId: any = undefined
	private accumulator = 0
	steps = 0

	constructor({
		Jolt,
		bodies,
		constraints,
		gravity,
		ground,
		unitsPerMeter
	}: {
		Jolt: JoltNS
		bodies: BodyDesc[]
		constraints: ExportedConstraint[]
		gravity: Vec3
		ground: GroundConfig
		unitsPerMeter?: number
	}) {
		this.Jolt = Jolt
		this.bodies = bodies
		this.constraints = constraints
		this.gravity = gravity
		this.ground = ground
		this.unitsPerMeter = unitsPerMeter || 16
	}

	private _new<T>(label: string, factory: () => T): T {
		const obj = factory()
		diag.trackAlloc(label)
		return obj
	}

	private _destroy(obj: unknown, label: string): void {
		if (!obj) return
		try {
			;(this.Jolt as Dyn).destroy(obj)
		} catch {
			/* already released */
		}
		diag.trackFree(label)
	}

	private _vec3(a: Vec3, label = 'Vec3'): any {
		return this._new(label, () => new (this.Jolt as Dyn).Vec3(a[0], a[1], a[2]))
	}
	private _rvec3(a: Vec3, label = 'RVec3'): any {
		return this._new(label, () => new (this.Jolt as Dyn).RVec3(a[0], a[1], a[2]))
	}
	private _quat(q: Quat, label = 'Quat'): any {
		return this._new(label, () => new (this.Jolt as Dyn).Quat(q[0], q[1], q[2], q[3]))
	}

	start(): void {
		const J = this.Jolt as Dyn
		// The three filter tables are owned by JoltInterface after settings construction
		// (proper_cleanup pattern) — intentionally NOT tracked in diag.
		const objectFilter = new J.ObjectLayerPairFilterTable(2)
		objectFilter.EnableCollision(LAYER_MOVING, LAYER_MOVING)
		objectFilter.EnableCollision(LAYER_NON_MOVING, LAYER_MOVING)
		const bpLayer = this._new('BroadPhaseLayer', () => new J.BroadPhaseLayer(0))
		const bpInterface = new J.BroadPhaseLayerInterfaceTable(2, 1)
		bpInterface.MapObjectToBroadPhaseLayer(LAYER_NON_MOVING, bpLayer)
		bpInterface.MapObjectToBroadPhaseLayer(LAYER_MOVING, bpLayer)
		this._destroy(bpLayer, 'BroadPhaseLayer')
		const bpFilter = new J.ObjectVsBroadPhaseLayerFilterTable(bpInterface, 1, objectFilter, 2)

		const settings = this._new('JoltSettings', () => new J.JoltSettings())
		settings.mObjectLayerPairFilter = objectFilter
		settings.mBroadPhaseLayerInterface = bpInterface
		settings.mObjectVsBroadPhaseLayerFilter = bpFilter
		this.jolt = this._new('JoltInterface', () => new J.JoltInterface(settings))
		this._destroy(settings, 'JoltSettings')
		// filters are now owned by the interface

		this.physicsSystem = this.jolt.GetPhysicsSystem()
		const gravityVec = this._vec3(this.gravity)
		try {
			this.physicsSystem.SetGravity(gravityVec)
		} catch {
			/* default gravity */
		}
		this._destroy(gravityVec, 'Vec3')
		this.bodyInterface = this.physicsSystem.GetBodyInterface()

		this._createBodies()
		this._createConstraints()
		this._createGround()
		this._installContactListener()
	}

	private _cookShape(node: ShapeNode): any {
		const J = this.Jolt as Dyn
		let settings: any = null
		let label = `${node.type}ShapeSettings`
		switch (node.type) {
			case 'Box': {
				const he = this._vec3(node.halfExtents)
				settings = this._new(label, () => new J.BoxShapeSettings(he, node.convexRadius ?? 0.05))
				this._destroy(he, 'Vec3')
				break
			}
			case 'Sphere':
				settings = this._new(label, () => new J.SphereShapeSettings(node.radius))
				break
			case 'Capsule':
				settings = this._new(
					label,
					() => new J.CapsuleShapeSettings(node.halfHeightOfCylinder, node.radius)
				)
				break
			case 'Cylinder':
				settings = this._new(
					label,
					() => new J.CylinderShapeSettings(node.halfHeight, node.radius, node.convexRadius ?? 0.05)
				)
				break
			case 'TaperedCapsule':
				settings = this._new(
					label,
					() =>
						new J.TaperedCapsuleShapeSettings(
							node.halfHeightOfCylinder,
							node.topRadius,
							node.bottomRadius
						)
				)
				break
			case 'TaperedCylinder':
				settings = this._new(
					label,
					() =>
						new J.TaperedCylinderShapeSettings(
							node.halfHeight,
							node.topRadius,
							node.bottomRadius,
							node.convexRadius ?? 0.05
						)
				)
				break
			case 'ConvexHull': {
				settings = this._new(label, () => new J.ConvexHullShapeSettings())
				for (const p of node.points) {
					const v = this._vec3(p)
					settings.mPoints.push_back(v)
					this._destroy(v, 'Vec3')
				}
				break
			}
			case 'Mesh': {
				const vertexList = this._new('VertexList', () => new J.VertexList())
				for (const v of node.vertices) {
					const f = this._new('Float3', () => new J.Float3(v[0], v[1], v[2]))
					vertexList.push_back(f)
					this._destroy(f, 'Float3')
				}
				const triangleList = this._new('IndexedTriangleList', () => new J.IndexedTriangleList())
				for (const t of node.triangles) {
					const tri = this._new('IndexedTriangle', () => new J.IndexedTriangle(t[0], t[1], t[2], 0))
					triangleList.push_back(tri)
					this._destroy(tri, 'IndexedTriangle')
				}
				const materialList = this._new('PhysicsMaterialList', () => new J.PhysicsMaterialList())
				const defaultMaterial = this._new('PhysicsMaterial', () => new J.PhysicsMaterial())
				materialList.push_back(defaultMaterial)
				settings = this._new(
					label,
					() => new J.MeshShapeSettings(vertexList, triangleList, materialList)
				)
				// refcount discipline: `new` starts at 0; the list and the settings AddRef'd the
				// material (now 2). Destroying the list releases its ref (→1, owned by settings);
				// the material itself must NOT be destroyed here — the cooked shape keeps the last ref.
				this._destroy(vertexList, 'VertexList')
				this._destroy(triangleList, 'IndexedTriangleList')
				this._destroy(materialList, 'PhysicsMaterialList')
				diag.trackFree('PhysicsMaterial')
				break
			}
			case 'StaticCompound': {
				settings = this._new(label, () => new J.StaticCompoundShapeSettings())
				for (const child of node.children) {
					const pos = this._vec3(child.position)
					const rot = this._quat(child.rotation)
					const childSettings = this._cookShape(child as ShapeNode)
					settings.AddShape(pos, rot, childSettings)
					this._destroy(pos, 'Vec3')
					this._destroy(rot, 'Quat')
					// childSettings ownership transferred to the compound
				}
				break
			}
			case 'RotatedTranslated': {
				const pos = this._vec3(node.position)
				const rot = this._quat(node.rotation)
				const inner = this._cookShape(node.inner)
				settings = this._new(label, () => new J.RotatedTranslatedShapeSettings(pos, rot, inner))
				this._destroy(pos, 'Vec3')
				this._destroy(rot, 'Quat')
				break
			}
			default:
				throw new Error(`Unsupported shape type: ${(node as ShapeNode).type}`)
		}
		const density = (node as { density?: number }).density
		if (density !== undefined && settings.mDensity !== undefined) {
			try {
				settings.mDensity = density
			} catch {
				/* non-convex */
			}
		}
		const result = settings.Create()
		const shape = result.Get()
		shape.AddRef()
		try {
			result.Clear()
		} catch {
			/* optional */
		}
		this._destroy(settings, label)
		return shape
	}

	private _createBodies(): void {
		const J = this.Jolt as Dyn
		for (let i = 0; i < this.bodies.length; i++) {
			const desc = this.bodies[i]
			const shape = this._cookShape(desc.shape as ShapeNode)
			const pos = this._rvec3(desc.position)
			const rot = this._quat(desc.rotation)
			// controller bodies (character/softbody/hair) get a STATIC base body: it anchors the ghost
			// and provides collision presence while the actual simulation object lives outside the body
			const controller = (desc.props as { controller?: string }).controller
			const baseStatic =
				controller === 'character' || controller === 'softbody' || controller === 'hair'
			const effectiveMotion = baseStatic ? 'Static' : desc.props.motionType
			const motionType = J[`EMotionType_${effectiveMotion}`]
			const layer =
				effectiveMotion === 'Dynamic' || effectiveMotion === 'Kinematic'
					? LAYER_MOVING
					: LAYER_NON_MOVING
			const settings = this._new(
				'BodyCreationSettings',
				() => new J.BodyCreationSettings(shape, pos, rot, motionType, layer)
			)
			this._destroy(pos, 'RVec3')
			this._destroy(rot, 'Quat')
			shape.Release()
			const p = desc.props
			settings.mFriction = p.friction
			settings.mRestitution = p.restitution
			settings.mLinearDamping = p.linearDamping
			settings.mAngularDamping = p.angularDamping
			settings.mGravityFactor = p.gravityFactor
			settings.mIsSensor = p.isSensor
			settings.mAllowSleeping = p.allowSleeping
			settings.mMotionQuality = J[`EMotionQuality_${p.motionQuality}`]
			settings.mUserData = i
			if (p.overrideMassProperties !== 'CalculateMassAndInertia') {
				try {
					settings.mOverrideMassProperties = J.EOverrideMassProperties_CalculateInertia
					const mp = this._new('MassProperties', () => new J.MassProperties())
					mp.mMass = p.mass
					settings.mMassPropertiesOverride = mp
					this._destroy(mp, 'MassProperties')
				} catch (err) {
					console.warn('behemiron_jolt: mass override not applied', err)
				}
			}
			const body = this.bodyInterface.CreateBody(settings)
			this._destroy(settings, 'BodyCreationSettings')
			this.bodyInterface.AddBody(body.GetID(), J.EActivation_Activate)
			this.bodyIds.push({
				uuid: desc.uuid,
				name: desc.name,
				id: body.GetID(),
				ptr: body,
				index: i,
				synced: false
			})
		}
		this._createControllers()
	}

	private _bodyIdByUuid(uuid: string): any {
		const entry = this.bodyIds.find(b => b.uuid === uuid)
		return entry ? entry.id : null
	}

	// Character / vehicle controllers. All creation is guarded: if the WASM binding surface
	// differs, the controller is skipped with a console warning and the rest of the sim still works.
	private _createControllers(): void {
		for (let i = 0; i < this.bodies.length; i++) {
			const desc = this.bodies[i]
			const kind = (desc.props as { controller?: string }).controller
			if (kind === 'vehicle') this._createVehicle(i, desc)
			else if (kind === 'character') this._createCharacter(i, desc)
			else if (kind === 'softbody') this._createSoftbody(i, desc)
			else if (kind === 'hair') this._createHair(i, desc)
		}
	}

	private _createVehicle(bodyIndex: number, desc: BodyDesc): void {
		const J = this.Jolt as Dyn
		const entry = this.bodyIds[bodyIndex]
		const params = sanitizeControllerParams(
			'vehicle',
			(desc.props as { controllerParams?: unknown }).controllerParams
		)
		try {
			const settings = this._new('VehicleConstraintSettings', () => new J.VehicleConstraintSettings())
			const upVec = this._vec3([0, 1, 0])
			settings.mUp = upVec
			this._destroy(upVec, 'Vec3')
			const fwdVec = this._vec3([0, 0, -1])
			settings.mForward = fwdVec
			this._destroy(fwdVec, 'Vec3')
			const wheels =
				(desc as { wheelGroups?: { name: string; position: number[] }[] }).wheelGroups || []
			const wheelList = settings.mWheels
			const radius = (params.wheelRadius as number) || 0.35
			const width = (params.wheelWidth as number) || 0.25
			if (!wheels.length) {
				console.warn(
					`behemiron_jolt: vehicle "${desc.name}" has no wheel groups (child groups) — using a single default wheel`
				)
			}
			for (const wheel of wheels.length ? wheels : [{ name: 'wheel', position: [0, -0.5, 0] }]) {
				// WheelSettingsWV (wheeled vehicle) — TV is the tracked-vehicle class with a different field set
				const ws = this._new('WheelSettingsWV', () => new J.WheelSettingsWV())
				const wpos = this._vec3(wheel.position)
				ws.mPosition = wpos
				this._destroy(wpos, 'Vec3')
				ws.mRadius = radius
				ws.mWidth = width
				ws.mSuspensionMinLength = params.suspensionMinLength
				ws.mSuspensionMaxLength = params.suspensionMaxLength
				ws.mSuspensionSpring.mFrequency = params.suspensionSpringFrequency
				ws.mSuspensionSpring.mDamping = params.suspensionSpringDamping
				ws.mMaxSteerAngle = ((params.maxSteeringAngle as number) * Math.PI) / 180
				ws.mMaxBrakeTorque = params.brakeTorque
				ws.mMaxHandBrakeTorque = params.handBrakeTorque
				// note: Jolt 5.x has no per-wheel drive torque (differentials/transmission distribute it)
				// and no scalar per-wheel friction (friction lives in LinearCurves); wheelFriction/maxWheelTorque
				// remain authored data for the engine contract but are not applied here.
				wheelList.push_back(ws)
				this._destroy(ws, 'WheelSettingsWV')
			}
			const ctrl = this._new(
				'WheeledVehicleControllerSettings',
				() => new J.WheeledVehicleControllerSettings()
			)
			const engine = this._new('VehicleEngineSettings', () => new J.VehicleEngineSettings())
			engine.mMaxTorque = params.maxTorque
			engine.mMinRPM = params.minRPM
			engine.mMaxRPM = params.maxRPM
			engine.mInertia = params.inertia
			engine.mAngularDamping = params.angularDamping
			ctrl.mEngine = engine
			this._destroy(engine, 'VehicleEngineSettings')
			const transmission = this._new(
				'VehicleTransmissionSettings',
				() => new J.VehicleTransmissionSettings()
			)
			transmission.mSwitchTime = params.gearSwitchTime
			transmission.mClutchStrength = params.clutchStrength
			ctrl.mTransmission = transmission
			this._destroy(transmission, 'VehicleTransmissionSettings')
			settings.mController = ctrl
			const constraint = this._new(
				'VehicleConstraint',
				() => new J.VehicleConstraint(entry.ptr, settings)
			)
			this.physicsSystem.AddConstraint(constraint)
			this.constraintPtrs.push(constraint)
			this.vehicles.push({ constraint, controller: constraint.GetController(), bodyIndex })
			this._destroy(settings, 'VehicleConstraintSettings')
			this._destroy(ctrl, 'WheeledVehicleControllerSettings')
		} catch (err) {
			console.warn(
				`behemiron_jolt: vehicle controller for "${desc.name}" failed (WASM binding mismatch?)`,
				err
			)
		}
	}

	private _createCharacter(bodyIndex: number, desc: BodyDesc): void {
		const J = this.Jolt as Dyn
		const params = sanitizeControllerParams(
			'character',
			(desc.props as { controllerParams?: unknown }).controllerParams
		)
		try {
			const settings = this._new('CharacterVirtualSettings', () => new J.CharacterVirtualSettings())
			settings.mMass = params.mass
			settings.mMaxSlopeAngle = ((params.maxSlopeAngle as number) * Math.PI) / 180
			settings.mMaxStrength = params.maxStrength
			settings.mCharacterPadding = params.characterPadding
			settings.mMaxSeparationDistance = params.maxSeparationDistance
			const upVec = this._vec3((params.up as number[]) || [0, 1, 0])
			settings.mUp = upVec
			this._destroy(upVec, 'Vec3')
			// capsule dimensions (best-effort: attribute names vary across Jolt versions)
			try {
				if (settings.mRadius !== undefined) settings.mRadius = params.radius
			} catch {
				/* older binding */
			}
			try {
				if (settings.mHeight !== undefined) settings.mHeight = params.height
			} catch {
				/* older binding */
			}
			const pos = this._rvec3(desc.position)
			const rot = this._quat(desc.rotation)
			const virtual = this._new(
				'CharacterVirtual',
				() => new J.CharacterVirtual(settings, pos, rot, this.physicsSystem)
			)
			this._destroy(pos, 'RVec3')
			this._destroy(rot, 'Quat')
			this._destroy(settings, 'CharacterVirtualSettings')
			this.characters.push({ virtual, bodyIndex, uuid: desc.uuid, updateArgs: 'short' })
		} catch (err) {
			console.warn(
				`behemiron_jolt: character controller for "${desc.name}" failed (WASM binding mismatch?)`,
				err
			)
		}
	}

	private _createHair(bodyIndex: number, desc: BodyDesc): void {
		const J = this.Jolt as Dyn
		const params = sanitizeControllerParams(
			'hair',
			(desc.props as { controllerParams?: unknown }).controllerParams
		)
		try {
			const cpu = this._ensureHairCompute()
			if (!cpu) throw new Error('CPU compute unavailable')
			const hs = this._new('HairSettings', () => new J.HairSettings())
			const mat = this._new('HairMaterial', () => new J.HairMaterial())
			mat.mBendCompliance = params.bendCompliance as number
			mat.mFriction = params.friction as number
			mat.mLinearDamping = params.linearDamping as number
			mat.mAngularDamping = params.angularDamping as number
			mat.mEnableLRA = params.enableLRA === true
			mat.mEnableCollision = params.enableCollision === true
			const gradient = new J.Gradient(
				params.gravityFactorMin as number,
				params.gravityFactorMax as number,
				0,
				1
			)
			mat.mGravityFactor = gradient
			this._destroy(gradient, 'Gradient')
			hs.mMaterials.push_back(mat)
			this._destroy(mat, 'HairMaterial')
			// procedural strands (body-local meters, deterministic — see core/hair.ts)
			const gen = generateHairStrands({
				strandCount: params.strandCount as number,
				segmentsPerStrand: params.segmentsPerStrand as number,
				strandLength: params.strandLength as number,
				rootRadius: params.rootRadius as number,
				rootInvMass: params.rootInvMass as number
			})
			for (let i = 0; i < gen.vertices.length; i += 3) {
				const sv = this._new('SVertex', () => new J.SVertex())
				const f3 = new J.Float3(gen.vertices[i], gen.vertices[i + 1], gen.vertices[i + 2])
				sv.mPosition = f3
				this._destroy(f3, 'Float3')
				sv.mInvMass = gen.invMass[i / 3]
				hs.mSimVertices.push_back(sv)
				this._destroy(sv, 'SVertex')
			}
			for (const [start, end] of gen.strands) {
				const strand = this._new('SStrand', () => new J.SStrand())
				strand.mStartVtx = start
				strand.mEndVtx = end
				strand.mMaterialIndex = 0
				hs.mSimStrands.push_back(strand)
				this._destroy(strand, 'SStrand')
			}
			this._hairMirrorRenderArrays(J, hs, gen)
			this._hairDummyScalp(J, hs)
			hs.mNumIterationsPerSecond = params.iterationsPerSecond as number
			const pad = Math.max(0.1, (params.strandLength as number) * 0.5)
			const boundsMin = this._vec3([
				-pad - (params.rootRadius as number),
				-(params.strandLength as number) - pad,
				-pad - (params.rootRadius as number)
			])
			const boundsMax = this._vec3([
				pad + (params.rootRadius as number),
				pad,
				pad + (params.rootRadius as number)
			])
			hs.mSimulationBounds = new J.AABox(boundsMin, boundsMax)
			this._destroy(boundsMin, 'Vec3')
			this._destroy(boundsMax, 'Vec3')
			;(J.HairGlue.prototype as any).InitSettingsAndGetMaxDist(hs)
			hs.InitCompute(cpu.compute)
			const pos = this._rvec3(desc.position)
			const rot = this._quat(desc.rotation)
			const hair = this._new('Hair', () => new J.Hair(hs, pos, rot, LAYER_MOVING))
			this._destroy(pos, 'RVec3')
			this._destroy(rot, 'Quat')
			this._destroy(hs, 'HairSettings')
			this.hairs.push({ hair, bodyIndex, uuid: desc.uuid, failed: false })
		} catch (err) {
			console.warn(`behemiron_jolt: hair for "${desc.name}" failed to initialize`, err)
		}
	}

	/** Jolt requires non-empty render/scalp buffers even for simulation-only hair. */
	private _hairMirrorRenderArrays(
		J: any,
		hs: any,
		gen: { vertices: number[]; strands: [number, number][] }
	): void {
		for (let i = 0; i < gen.vertices.length; i += 3) {
			hs.mRenderVertices.push_back(
				new J.Float3(gen.vertices[i], gen.vertices[i + 1], gen.vertices[i + 2])
			)
		}
		for (const [start, end] of gen.strands) {
			const rs = new J.RStrand()
			rs.mStartVtx = start
			rs.mEndVtx = end
			hs.mRenderStrands.push_back(rs)
			J.destroy(rs)
		}
	}

	private _hairDummyScalp(J: any, hs: any): void {
		hs.mScalpVertices.push_back(new J.Float3(0, 0, 0))
		hs.mScalpVertices.push_back(new J.Float3(0.01, 0, 0))
		hs.mScalpVertices.push_back(new J.Float3(0, 0.01, 0))
		hs.mScalpTriangles.push_back(new J.IndexedTriangleNoMaterial(0, 1, 2))
	}

	/** One CPU compute system + shaders per session (created lazily on first hair). */
	private hairCompute: { compute: any; shaders: any } | null = null

	private _ensureHairCompute(): { compute: any; shaders: any } | null {
		if (this.hairCompute) return this.hairCompute
		const J = this.Jolt as Dyn
		try {
			const HG = J.HairGlue.prototype
			const compute = HG.CreateComputeSystemCPU()
			if (!compute) return null
			HG.RegisterHairShadersCPU(compute)
			const shaders = this._new('HairShaders', () => new J.HairShaders())
			shaders.Init(compute)
			this.hairCompute = { compute, shaders }
			return this.hairCompute
		} catch (err) {
			console.warn('behemiron_jolt: hair CPU compute unavailable', err)
			return null
		}
	}

	private hairs: { hair: any; bodyIndex: number; uuid: string; failed: boolean }[] = []

	private _createSoftbody(bodyIndex: number, desc: BodyDesc): void {
		const J = this.Jolt as Dyn
		const params = sanitizeControllerParams(
			'softbody',
			(desc.props as { controllerParams?: unknown }).controllerParams
		)
		try {
			const cubes = (desc as { softCubes?: { min: Vec3; max: Vec3 }[] }).softCubes || []
			if (!cubes.length) throw new Error('no voxels')
			// softCubes arrive in body-local meters (pipeline scales)
			const mesh = buildSoftBodyMesh(cubes)
			// skinning: BB weight-paint → pin fully-bound verts (mInvMass = 0)
			const sources = (
				desc as {
					skinSources?: { bones: any[]; skinMeshes: Record<string, Record<string, number[]>> }
				}
			).skinSources
			let pinned: number[] = []
			if (sources && sources.bones.length) {
				const skin = buildSkinWeights(
					mesh.vertices,
					Object.entries(sources.skinMeshes).map(([meshUuidPrefix, vertices]) => ({
						meshUuidPrefix,
						vertices
					})),
					sources.bones,
					this.unitsPerMeter
				)
				pinned = skin.pinned
				;(desc as { skin?: unknown }).skin = skin
			}
			const shared = this._new('SoftBodySharedSettings', () => new J.SoftBodySharedSettings())
			const invMass = 1 / ((params.vertexMass as number) || 0.1)
			for (let vi = 0; vi < mesh.vertices.length; vi++) {
				const v = mesh.vertices[vi]
				const sv = this._new(
					'SoftBodySharedSettingsVertex',
					() => new J.SoftBodySharedSettingsVertex()
				)
				const f3 = new J.Float3(v[0], v[1], v[2])
				sv.mPosition = f3
				this._destroy(f3, 'Float3')
				sv.mInvMass = pinned.includes(vi) ? 0 : invMass
				shared.mVertices.push_back(sv)
				this._destroy(sv, 'SoftBodySharedSettingsVertex')
			}
			for (const f of mesh.faces) {
				const face = this._new(
					'SoftBodySharedSettingsFace',
					() => new J.SoftBodySharedSettingsFace(f[0], f[1], f[2], 0)
				)
				shared.mFaces.push_back(face)
				this._destroy(face, 'SoftBodySharedSettingsFace')
			}
			for (const [a, b] of mesh.edges) {
				const edge = this._new(
					'SoftBodySharedSettingsEdge',
					() => new J.SoftBodySharedSettingsEdge(a, b, params.edgeCompliance as number)
				)
				shared.mEdgeConstraints.push_back(edge)
				this._destroy(edge, 'SoftBodySharedSettingsEdge')
			}
			const maxVol = Math.max(...mesh.tetVolumes, 0)
			if (params.useVolumeConstraints === true) {
				mesh.tetrahedra.forEach((tet, i) => {
					if (mesh.tetVolumes[i] < 0.05 * maxVol) return
					const volume = this._new(
						'SoftBodySharedSettingsVolume',
						() =>
							new J.SoftBodySharedSettingsVolume(
								tet[0],
								tet[1],
								tet[2],
								tet[3],
								params.volumeCompliance as number
							)
					)
					shared.mVolumeConstraints.push_back(volume)
					this._destroy(volume, 'SoftBodySharedSettingsVolume')
				})
			}
			if (params.bendType !== 'None' && shared.CreateConstraints) {
				shared.CreateConstraints(
					J[`SoftBodySharedSettings_EBendType_${params.bendType}`],
					params.bendCompliance as number
				)
			}
			shared.AddRef()
			const pos = this._rvec3(desc.position)
			const rot = this._quat(desc.rotation)
			const cs = this._new(
				'SoftBodyCreationSettings',
				() => new J.SoftBodyCreationSettings(shared, pos, rot, LAYER_MOVING)
			)
			const body = this.bodyInterface.CreateAndAddBody(cs, J.EActivation_Activate)
			this._destroy(cs, 'SoftBodyCreationSettings')
			this._destroy(pos, 'RVec3')
			this._destroy(rot, 'Quat')
			shared.Release()
			if (body) {
				this.bodyIds.push({
					uuid: desc.uuid,
					name: desc.name,
					id: body.GetID(),
					ptr: body,
					index: bodyIndex,
					synced: false
				})
			}
		} catch (err) {
			console.warn(
				`behemiron_jolt: soft body for "${desc.name}" failed (WASM binding mismatch or no voxels)`,
				err
			)
		}
	}

	private _stepControllers(h: number): void {
		if (this.hairs.length && this.hairCompute) {
			const J = this.Jolt as Dyn
			const HG = J.HairGlue.prototype
			const identity = J.Mat44.prototype.sIdentity()
			for (const entry of this.hairs) {
				if (entry.failed) continue
				try {
					// v1: hair simulated in its creation pose (root follow + strand readback land next)
					HG.Update(
						entry.hair,
						h,
						identity,
						this.physicsSystem,
						this.hairCompute.shaders,
						this.hairCompute.compute
					)
				} catch (err) {
					entry.failed = true
					console.warn('behemiron_jolt: hair update failed — hair frozen for this session', err)
				}
			}
		}
		for (const vehicle of this.vehicles) {
			try {
				vehicle.controller.SetDriverInput(
					this.driveInput.forward,
					this.driveInput.right,
					this.driveInput.brake,
					this.driveInput.handbrake
				)
			} catch {
				/* controller not ready */
			}
		}
		for (const character of this.characters) {
			if (!character.updateArgs) continue
			try {
				const gravityVec = this._vec3(this.gravity)
				if (character.updateArgs === 'short') {
					try {
						character.virtual.Update(h, gravityVec)
					} catch {
						character.updateArgs = 'long'
						character.virtual.Update(h, gravityVec, null, null, null, null)
					}
				} else {
					character.virtual.Update(h, gravityVec, null, null, null, null)
				}
				this._destroy(gravityVec, 'Vec3')
			} catch (err) {
				console.warn(
					'behemiron_jolt: CharacterVirtual.Update binding mismatch — character frozen',
					err
				)
				character.updateArgs = null
			}
		}
	}

	readCharacters(cb: (uuid: string, bodyIndex: number, position: Vec3, quat: Quat) => void): void {
		for (const character of this.characters) {
			const pos = character.virtual.GetPosition()
			const rot = character.virtual.GetRotation()
			cb(
				character.uuid,
				character.bodyIndex,
				[pos.GetX(), pos.GetY(), pos.GetZ()],
				[rot.GetX(), rot.GetY(), rot.GetZ(), rot.GetW()]
			)
			this._destroy(pos, 'RVec3')
			this._destroy(rot, 'Quat')
		}
	}

	setCharacterVelocity(uuid: string, velocity: Vec3): void {
		const character = this.characters.find(c => c.uuid === uuid)
		if (!character) return
		try {
			const v = this._vec3(velocity)
			character.virtual.SetLinearVelocity(v)
			this._destroy(v, 'Vec3')
		} catch {
			/* binding mismatch */
		}
	}

	private _createConstraints(): void {
		const J = this.Jolt as Dyn
		for (const constraint of this.constraints) {
			const idA = this._bodyIdByUuid(constraint.bodyA as string)
			const idB = this._bodyIdByUuid(constraint.bodyB as string)
			if (!idA || !idB) continue
			const meta = CONSTRAINT_TYPES[constraint.type]
			const className = SETTINGS_CLASS[constraint.type]
			if (!className || !J[className]) continue
			if (constraint.type === 'Path') {
				// jolt-physics.js exposes mPath as a read-only attribute; path constraints cannot be
				// created in the WASM build. They remain fully supported in the authored data / engine side.
				console.warn(
					'behemiron_jolt: Path constraints are not simulated in BlockBench (WASM limitation); the exported contract for the engine is unaffected.'
				)
				continue
			}
			const settings = this._new(className, () => new J[className]())
			try {
				if (meta.hasSpace !== false) settings.mSpace = J.EConstraintSpace_WorldSpace
				this._applyConstraintFields(settings, constraint)
				this._applyMotorSettings(settings, constraint)
				const ptr = this.bodyInterface.CreateConstraint(settings, idA, idB)
				this.physicsSystem.AddConstraint(ptr)
				this.constraintPtrs.push(ptr)
				this._startMotor(ptr, constraint)
			} catch (err) {
				console.warn(`behemiron_jolt: failed to create ${constraint.type} constraint`, err)
			}
			this._destroy(settings, className)
		}
	}

	private _applyConstraintFields(settings: any, constraint: ExportedConstraint): void {
		const temps: [unknown, string][] = []
		try {
			this._applyConstraintFieldsInner(settings, constraint, temps)
		} finally {
			for (const [vec, label] of temps) this._destroy(vec, label)
		}
	}

	private _applyConstraintFieldsInner(
		settings: any,
		constraint: ExportedConstraint,
		temps: [unknown, string][]
	): void {
		const J = this.Jolt as Dyn
		const meta = CONSTRAINT_TYPES[constraint.type]
		for (const field of meta.fields) {
			const value: unknown = constraint[field.key]
			if (value === undefined) continue
			const attr = 'm' + field.key[0].toUpperCase() + field.key.slice(1)
			switch (field.kind) {
				case 'point3': {
					const vec = this._rvec3(value as Vec3)
					temps.push([vec, 'RVec3'])
					settings[attr] = vec
					break
				}
				case 'pos3':
				case 'vec3': {
					const vec = this._vec3(value as Vec3)
					temps.push([vec, 'Vec3'])
					settings[attr] = vec
					break
				}
				case 'quat': {
					const quat = this._quat(value as Quat)
					temps.push([quat, 'Quat'])
					settings[attr] = quat
					break
				}
				case 'floatOrNull':
					settings[attr] = value === null ? (attr === 'mLimitsMin' ? -FLT_MAX : FLT_MAX) : value
					break
				case 'float':
					settings[attr] = value
					break
				case 'bool':
					settings[attr] = value
					break
				case 'enum':
					settings[attr] = J[`${field.enumName}_${value}`]
					break
				// vec6 / pathPoints are handled outside the generic loop
			}
		}
		if (constraint.type === 'SixDOF') {
			const limitMin = constraint.limitMin as (number | null)[] | undefined
			const limitMax = constraint.limitMax as (number | null)[] | undefined
			for (let axis = 0; axis < 6; axis++) {
				const min = limitMin?.[axis]
				const max = limitMax?.[axis]
				if (min === null || min === undefined || max === null || max === undefined) {
					settings.MakeFreeAxis(axis)
				} else {
					settings.SetLimitedAxis(axis, min, max)
				}
			}
		}
		for (const [vec, label] of temps) this._destroy(vec, label)
	}

	// MotorSettings limits on the settings object (contract values are already meters/radians)
	private _applyMotorSettings(settings: any, constraint: ExportedConstraint): void {
		const J = this.Jolt as Dyn
		const torque = (constraint.motorMaxTorque as number | undefined) ?? 0
		const force = (constraint.motorMaxForce as number | undefined) ?? 0
		if (!(torque > 0) && !(force > 0)) return
		try {
			const ms = this._new('MotorSettings', () => new J.MotorSettings())
			if (torque > 0) ms.mMaxTorqueLimit = torque
			if (force > 0) ms.mMaxForceLimit = force
			settings.mMotorSettings = ms
			this._destroy(ms, 'MotorSettings')
		} catch (err) {
			console.warn('behemiron_jolt: motor settings not applied', err)
		}
	}

	// Post-creation motor control (values already in radians / meters)
	private _startMotor(ptr: any, constraint: ExportedConstraint): void {
		const J = this.Jolt as Dyn
		const state = constraint.motorState as string | undefined
		if (!state || state === 'Off' || !ptr.SetMotorState) return
		try {
			ptr.SetMotorState(J[`EMotorState_${state}`])
			if (constraint.type === 'Hinge') {
				if (state === 'Velocity' && ptr.SetTargetAngularVelocity) {
					ptr.SetTargetAngularVelocity((constraint.motorTargetVelocity as number) || 0)
				}
				if (state === 'Position' && ptr.SetTargetAngle) {
					ptr.SetTargetAngle((constraint.motorTargetAngle as number) || 0)
				}
			} else if (constraint.type === 'Slider') {
				if (state === 'Velocity' && ptr.SetTargetVelocity) {
					ptr.SetTargetVelocity((constraint.motorTargetVelocity as number) || 0)
				}
				if (state === 'Position' && ptr.SetTargetPosition) {
					ptr.SetTargetPosition((constraint.motorTargetPosition as number) || 0)
				}
			}
		} catch (err) {
			console.warn('behemiron_jolt: motor start failed', err)
		}
	}

	private _createGround(): void {
		if (!this.ground?.enabled) return
		const J = this.Jolt as Dyn
		const he = this._vec3([200, 1, 200])
		const shapeSettings = this._new('BoxShapeSettings', () => new J.BoxShapeSettings(he, 0.05))
		this._destroy(he, 'Vec3')
		const result = shapeSettings.Create()
		const shape = result.Get()
		shape.AddRef()
		try {
			result.Clear()
		} catch {
			/* optional */
		}
		this._destroy(shapeSettings, 'BoxShapeSettings')
		const pos = this._rvec3([0, this.ground.y - 1, 0])
		const rot = this._quat([0, 0, 0, 1])
		const settings = this._new(
			'BodyCreationSettings',
			() => new J.BodyCreationSettings(shape, pos, rot, J.EMotionType_Static, LAYER_NON_MOVING)
		)
		this._destroy(pos, 'RVec3')
		this._destroy(rot, 'Quat')
		shape.Release()
		settings.mFriction = 0.6
		const body = this.bodyInterface.CreateBody(settings)
		this._destroy(settings, 'BodyCreationSettings')
		this.bodyInterface.AddBody(body.GetID(), J.EActivation_Activate)
		this.groundBodyId = body.GetID()
	}

	// returns number of physics steps taken
	step(dtReal: number): number {
		if (!this.jolt) return 0
		this.accumulator = Math.min(this.accumulator + dtReal, STEP * MAX_STEPS_PER_FRAME)
		let n = 0
		while (this.accumulator >= STEP && n < MAX_STEPS_PER_FRAME) {
			this._stepControllers(STEP)
			this.jolt.Step(STEP, 1)
			this.accumulator -= STEP
			n++
			this.steps++
		}
		return n
	}

	// cb(uuid, index, position[m3], quat[x,y,z,w])
	// Sleeping bodies are read once and then skipped (they cannot move until re-activated).
	readTransforms(cb: (uuid: string, index: number, position: Vec3, quat: Quat) => void): void {
		if (!this.bodyInterface) return
		for (const entry of this.bodyIds) {
			let active = true
			try {
				active = this.bodyInterface.IsActive(entry.id)
			} catch {
				/* always sync */
			}
			if (!active && entry.synced) continue
			const pos = this.bodyInterface.GetPosition(entry.id)
			const rot = this.bodyInterface.GetRotation(entry.id)
			cb(
				entry.uuid,
				entry.index,
				[pos.GetX(), pos.GetY(), pos.GetZ()],
				[rot.GetX(), rot.GetY(), rot.GetZ(), rot.GetW()]
			)
			this._destroy(pos, 'RVec3')
			this._destroy(rot, 'Quat')
			entry.synced = true
		}
	}

	readLinearVelocity(uuid: string): Vec3 | null {
		const entry = this.bodyIds.find(b => b.uuid === uuid)
		if (!entry) return null
		const v = this.bodyInterface.GetLinearVelocity(entry.id)
		const out: Vec3 = [v.GetX(), v.GetY(), v.GetZ()]
		this._destroy(v, 'Vec3')
		return out
	}

	// cb(uuid, position[m], velocity[m/s]) — active bodies only (sleeping bodies have no motion)
	readActiveVelocities(cb: (uuid: string, position: Vec3, velocity: Vec3) => void): void {
		if (!this.bodyInterface) return
		for (const entry of this.bodyIds) {
			let active = true
			try {
				active = this.bodyInterface.IsActive(entry.id)
			} catch {
				/* treat as active */
			}
			if (!active) continue
			const pos = this.bodyInterface.GetPosition(entry.id)
			const vel = this.bodyInterface.GetLinearVelocity(entry.id)
			cb(entry.uuid, [pos.GetX(), pos.GetY(), pos.GetZ()], [vel.GetX(), vel.GetY(), vel.GetZ()])
			this._destroy(pos, 'RVec3')
			this._destroy(vel, 'Vec3')
		}
	}

	// Kinematic animation drive: teleport a kinematic body (meters / quat)
	setBodyTransform(uuid: string, position: Vec3, quat: Quat, activate = true): void {
		const entry = this.bodyIds.find(b => b.uuid === uuid)
		if (!entry) return
		const J = this.Jolt as Dyn
		const pos = this._rvec3(position)
		const rot = this._quat(quat)
		try {
			this.bodyInterface.SetPositionAndRotation(
				entry.id,
				pos,
				rot,
				activate ? J.EActivation_Activate : J.EActivation_DontActivate
			)
		} finally {
			this._destroy(pos, 'RVec3')
			this._destroy(rot, 'Quat')
		}
		entry.synced = false
	}

	// ---- sensors & contact events -------------------------------------------
	// The JSImplementation listener fires per contact pair per step; keep the handler O(1):
	// maintain a set of touching body indices per sensor, read by the UI at 4Hz.
	private sensorContacts = new Map<string, Set<number>>()
	private contactListener: any = null

	private _installContactListener(): void {
		const J = this.Jolt as Dyn
		if (!this.physicsSystem?.SetContactListener) return
		try {
			const listener = this._new('ContactListenerJS', () => new J.ContactListenerJS())
			const onAdd = (body1: any, body2: any) => {
				const i1 = this._indexOfBodyId(body1?.GetID?.())
				const i2 = this._indexOfBodyId(body2?.GetID?.())
				if (i1 < 0 || i2 < 0) return
				const s = this.bodies[i1]?.props.isSensor ? i1 : this.bodies[i2]?.props.isSensor ? i2 : -1
				if (s < 0) return
				const o = s === i1 ? i2 : i1
				const set = this.sensorContacts.get(this.bodyIds[s].uuid) || new Set<number>()
				set.add(o)
				this.sensorContacts.set(this.bodyIds[s].uuid, set)
			}
			const onRemove = () => {
				// SubShapeIDPair → BodyID via GetBody1ID? fall back to clearing lazily
				this._staleSensors = true
			}
			listener.OnContactValidate = () => 0 // ValidateResult_AcceptAllContactsForThisBodyPair
			listener.OnContactAdded = onAdd
			listener.OnContactPersisted = onAdd
			listener.OnContactRemoved = onRemove
			this.physicsSystem.SetContactListener(listener)
			this.contactListener = listener
		} catch (err) {
			console.warn('behemiron_jolt: contact listener unavailable', err)
		}
	}

	private _staleSensors = false

	// StateRecorder checkpoint (deterministic replay): save/restore within a session
	private checkpointRecorder: any = null

	/** Save (or overwrite) a physics state checkpoint. Returns false when unsupported. */
	saveCheckpoint(): boolean {
		if (!this.physicsSystem) return false
		try {
			const J = this.Jolt as Dyn
			if (!this.checkpointRecorder) {
				this.checkpointRecorder = this._new('StateRecorderImpl', () => new J.StateRecorderImpl())
			}
			this.checkpointRecorder.Clear()
			this.physicsSystem.SaveState(this.checkpointRecorder)
			return true
		} catch (err) {
			console.warn('behemiron_jolt: saveCheckpoint failed', err)
			return false
		}
	}

	/** Restore the checkpoint saved by saveCheckpoint. Returns false when none/unsupported. */
	restoreCheckpoint(): boolean {
		if (!this.physicsSystem || !this.checkpointRecorder) return false
		if (this.characters.length || this.vehicles.length || this.hairs.length) {
			// PhysicsSystem state covers bodies/constraints in the system only — controller state
			// (CharacterVirtual/VehicleConstraint/Hair) is NOT captured; replay diverges with them
			console.warn(
				'behemiron_jolt: checkpoint restore does not cover controllers (character/vehicle/hair)'
			)
		}
		try {
			this.checkpointRecorder.Rewind()
			this.physicsSystem.RestoreState(this.checkpointRecorder)
			for (const entry of this.bodyIds) entry.synced = false
			return true
		} catch (err) {
			console.warn('behemiron_jolt: restoreCheckpoint failed', err)
			return false
		}
	}

	hasCheckpoint(): boolean {
		return !!this.checkpointRecorder
	}

	/** The underlying recorder (e.g. for IsEqual determinism comparisons). */
	getCheckpointRecorder(): any {
		return this.checkpointRecorder
	}

	/** Placeholder: byte export needs StateRecorderJS wiring; checkpoint replay works today. */
	exportCheckpointBytes(): null {
		return null
	}

	/** Placeholder: byte import needs StateRecorderJS wiring; checkpoint replay works today. */
	importCheckpointBytes(_bytes: Uint8Array): boolean {
		return false
	}

	private _indexOfBodyId(id: any): number {
		if (!id) return -1
		const key = id.GetIndexAndSequenceNumber()
		return this.bodyIds.findIndex(e => e.id.GetIndexAndSequenceNumber() === key)
	}

	/** [{uuid, contacts}] for sensor bodies; counts refreshed on Persisted/Added, lazily revalidated. */
	getSensorStates(): { uuid: string; contacts: number }[] {
		if (this._staleSensors) {
			// Removed callbacks don't reliably map to our index space; revalidate by clearing.
			// Persisted events rebuild the sets within one physics step.
			this.sensorContacts.clear()
			this._staleSensors = false
		}
		const out: { uuid: string; contacts: number }[] = []
		for (const [uuid, set] of this.sensorContacts) {
			out.push({ uuid, contacts: set.size })
		}
		return out
	}

	stop(): void {
		const J = this.Jolt as Dyn
		if (!this.jolt) return
		for (const entry of this.hairs) {
			try {
				this._destroy(entry.hair, 'Hair')
			} catch {
				/* already gone */
			}
		}
		this.hairs = []
		if (this.hairCompute) {
			try {
				this._destroy(this.hairCompute.shaders, 'HairShaders')
			} catch {
				/* ignore */
			}
			this.hairCompute = null // compute system is session-lifetime by design (AddRef'd in glue)
		}
		if (this.contactListener) {
			try {
				this.physicsSystem.SetContactListener(null)
			} catch {
				/* ignore */
			}
			try {
				J.destroy(this.contactListener)
			} catch {
				/* released */
			}
			diag.trackFree('ContactListenerJS')
			this.contactListener = null
		}
		this.sensorContacts.clear()
		for (const ptr of this.constraintPtrs) {
			try {
				this.physicsSystem.RemoveConstraint(ptr)
			} catch {
				/* already gone */
			}
			try {
				J.destroy(ptr)
			} catch {
				/* released */
			}
			diag.trackFree('Constraint')
		}
		this.constraintPtrs = []
		for (const entry of this.bodyIds) {
			try {
				this.bodyInterface.RemoveBody(entry.id)
			} catch {
				/* already gone */
			}
			try {
				this.bodyInterface.DestroyBody(entry.id)
			} catch {
				/* already gone */
			}
		}
		if (this.groundBodyId !== undefined) {
			try {
				this.bodyInterface.RemoveBody(this.groundBodyId)
			} catch {
				/* ignore */
			}
			try {
				this.bodyInterface.DestroyBody(this.groundBodyId)
			} catch {
				/* ignore */
			}
			this.groundBodyId = undefined
		}
		this.bodyIds = []
		this._destroy(this.jolt, 'JoltInterface')
		this.jolt = null
	}
}
