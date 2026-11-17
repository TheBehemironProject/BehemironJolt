# Jolt Physics `.bbmodel` Format Contract

> This document is the authoritative contract between the BlockBench plugin
> (`BehemironJolt`) and the engine-side consumer (jolt-jni). The plugin persists
> physics annotations under the top-level `.bbmodel` key **`jolt_physics`**.
> Where this document and the code disagree, the code is wrong — file a bug.

## 1. File layout

```jsonc
{
  "jolt_physics": {
    "version": 1,                       // FORMAT_VERSION; consumers reject != 1
    "elements": { "<element-uuid>": { "shape": "auto", "density": 1000 } },
    "bodies":   { "<outliner-uuid>": { /* BodyProps, §3 */ } },
    "constraints": [ { /* ConstraintData, §4 */ } ],
    "settings": { "unitsPerMeter": 16, "gravity": [0, -9.81, 0], "groundEnabled": true },
    "states":   { "<state-name>": { /* PhysicsStateDef, §5 */ } }   // optional
  }
}
```

All keys are optional on read: missing sections mean "none". Unknown keys are
ignored by readers (forward compatibility). `elements`/`bodies` are keyed by
BlockBench outliner/element UUIDs; a **body's shape aggregates the shapes of the
elements in its subtree** (§6).

Units in the **storage form** are BlockBench units (16 per meter by default,
see `settings.unitsPerMeter`) and **degrees** for angle fields. The engine
applies the export conversion itself (§4.3).

## 2. ElementProps

| key     | type                     | default | range        |
| ------- | ------------------------ | ------- | ------------ |
| shape   | enum, see below          | `auto`  | —            |
| density | number (kg/m³)           | 1000    | [1e-6, 1e12] |

`shape` ∈ `auto | box | sphere | capsule | tapered_capsule | cylinder |
tapered_cylinder | convex_hull | mesh | none`. `auto` resolves per element
kind: cube → `box`, mesh → `convex_hull`.

## 3. BodyProps

| key                    | type    | default                  | range        |
| ---------------------- | ------- | ------------------------ | ------------ |
| motionType             | enum    | `Dynamic`                | Static / Kinematic / Dynamic |
| objectLayer            | int     | 1                        | [0, 65535]   |
| friction               | number  | 0.2                      | [0, 1]       |
| restitution            | number  | 0                        | [0, 1]       |
| linearDamping          | number  | 0.05                     | [0, 100]     |
| angularDamping         | number  | 0.05                     | [0, 100]     |
| gravityFactor          | number  | 1                        | [-100, 100]  |
| isSensor               | bool    | false                    | —            |
| allowSleeping          | bool    | true                     | —            |
| motionQuality          | enum    | `Discrete`               | Discrete / LinearCast |
| overrideMassProperties | enum    | `CalculateMassAndInertia`| + `CalculateInertia`, `MassAndInertiaProvided` |
| mass                   | number  | 1                        | [1e-6, 1e12] |
| inertiaMultiplier      | number  | 1                        | [1e-6, 1e6]  |
| animationDriven        | bool    | false                    | B3: kinematic body follows the Blockbench animation while simulating |
| controller             | enum    | `none`                   | none / character / vehicle / softbody / hair |
| controllerParams       | record  | {}                       | per-controller defaults merged at use time (§7) |
| collisionGroup         | int     | 0                        | [0, 65535]; same-group bodies never collide with each other |
| selfCollide            | bool    | false                    | true = collides with other bodies of the same model instance |

## 4. Constraints

### 4.1 Storage form

Common keys: `id`, `type`, `bodyA`, `bodyB` (outliner uuids), `space`
(`WorldSpace`; `Path` has no space), and the common optional
**`breakImpulse`** (N·s; the engine removes the constraint when the constraint
impulse exceeds it; `null`/absent/≤0 = never breaks).

Type-specific fields and defaults are declared in `src/core/constraints.ts`
(`CONSTRAINT_TYPES`). Field kinds and their sanitize semantics:

| kind         | storage           | sanitize                                   |
| ------------ | ----------------- | ------------------------------------------ |
| vec3/point3/pos3 | [x,y,z] BB units | must be 3 finite numbers, else default   |
| quat         | [x,y,z,w]         | 4 finite numbers, else default             |
| vec6         | 6 × (number\|null)| entries null/''/non-finite → null; translation slots then ×scale, rotation slots ×DEG2RAD on export |
| float        | number            | non-finite → default, then clamped [min,max] |
| floatOrNull  | number \| null    | null/''/non-finite → null, else clamped min |
| bool         | bool              | strict boolean                             |
| enum         | string            | must be in options, else default           |
| pathPoints   | [[x,y,z],…]       | only 3-finite points kept                  |

The 12 types: `Fixed, Distance, Hinge, Slider, Point, Cone, SwingTwist,
SixDOF, Pulley, Gear, RackAndPinion, Path`.

### 4.2 Authoring-time anchors

`makeConstraint` seeds point fields from the bodies' centers of mass (BB
units): point1-family = comA, point2-family = comB, `fixedPoint*` = com ± 8
units up, `pathPoints` = [comA, comB]. `Distance` seeds `maxDistance` to the
com distance. Engines must not depend on these seeds (explicitly authored
values always win after sanitize).

### 4.3 Export conversion (engine contract form: meters, radians)

Applied by the engine when reading the storage form; `s = 1 / unitsPerMeter`:

- `point3`/`pos3` × s; `vec3`/`quat` unchanged; `pathPoints` × s.
- `floatOrNull`/`float` with `unit: 'm'` × s; with `unit: 'deg'` × π/180.
- `vec6`: slots 0–2 (translation) × s, slots 3–5 (rotation) × π/180.
- `null` limits stay null. `space: 'WorldSpace'` unless `hasSpace === false`.

## 5. PhysicsStateDef (runtime state presets)

```jsonc
"states": {
  "ragdoll": {
    "name": "ragdoll",
    "bodies": { "<outliner-uuid>": { "motionType": "Dynamic" } },  // per-key overrides
    "breakConstraints": ["<constraint-id>", …]                     // removed on enter
  }
}
```

Overrides are validated per key (same ranges as BodyProps) but **only listed
keys replace the base body's values** — unlisted keys keep the base body's
configuration. The engine activates a state by applying the overrides (with
continuity: current pose seeds the physics state) and removing the listed
constraints. Authoring UIs are a plugin-side follow-up; the data contract is
final.

## 6. Shape pipeline (deterministic mirror contract)

The engine mirrors `src/core/shapes.ts` exactly. With `s = 1/unitsPerMeter`
(meters per BB unit) and body-local input geometry:

- **Degenerate rules**: volumetric shapes (everything except `convex_hull`/
  `mesh`) are skipped if **any** bbox half-extent ≤ 1e-9; hulls/meshes only if
  **all** are ≤ 1e-9.
- **box**: `halfExtents = bbox half-extents × s`, `convexRadius = 0.05`.
- **sphere**: `radius = ‖halfExtents‖ × s` (3D hypot).
- **capsule/cylinder family**: axis = longest bbox axis (ties: Y wins, then Z);
  `axisFixRotation` = quat rotating +Y onto that axis (identity for Y); end
  radii measured at the 25%/75% quartiles (each point attributed to the nearer
  quartile, max perpendicular distance); `radius = max(avg(bottom, top), 1e-6)`,
  `halfHeight = max(he[axis]·s − radius, 1e-6)`. Tapered variants keep separate
  top/bottom radii; cylinders carry `convexRadius = 0.05`.
- **convex_hull**: vertices welded with `WELD_EPS = 1e-4` (key =
  `round(v/eps)` per component); **fewer than 4 welded points → box fallback**
  (same frame math as box); points × s.
- **mesh**: welded vertices + remapped indices; missing index buffer → hull
  fallback.
- **Aggregation** (`buildBodyShape`): one centered child → the bare shape; one
  offset child → `RotatedTranslated(position, rotation, inner)`; multiple →
  `StaticCompound(children)`. Child `position = center × s` (components
  < 1e-12 → 0), `rotation` snap (< 1e-9 → 0, w → 1).
- Shape node names map 1:1 to jolt-jni `${type}ShapeSettings`.

## 7. Controller params

Defaults/sanitization in `src/core/controllers.ts`; keys follow Jolt settings
class field names. Current in-scope sets:

- **softbody**: `edgeCompliance 1e-6`, `bendType 'Distance'`, `bendCompliance
  1e-5`, `volumeCompliance 1e-6`, `useVolumeConstraints true`,
  `linearDamping 0.05`, `pressure 0`, `vertexMass 0.1`.
- **hair** (procedural — engine and plugin MUST generate identical strands):
  `strandCount 16` (1..4096), `segmentsPerStrand 8` (2..64), `strandLength
  0.4 m`, `rootRadius 0.15 m`, `rootInvMass 0`, `iterationsPerSecond 360`
  (60..1200), `bendCompliance 2e-5`, `friction 0.5`, `linearDamping 2`,
  `angularDamping 2`, `enableLRA true`, `enableCollision true`,
  `gravityFactorMin 0.1`, `gravityFactorMax 1.0`. Strand roots distribute on
  the XZ plane by the golden angle `2.39996322972865332 rad`, strands hang
  straight down −Y (body-local, meters, +Y up); root vertex invMass =
  `rootInvMass`, all others 1.

**Soft body voxels** (`src/core/softbody.ts`): each cube → 5-tet standard
decomposition; corners welded across cubes (`WELD_EPS 1e-4`) so shared faces
merge; surface faces (owned by exactly one cube) emitted for
collision/rendering; near-zero-volume tets are kept but flagged so callers can
skip volume constraints.

## 8. Determinism & test vectors

The pure functions above are engine-contractual: identical inputs MUST produce
identical outputs in the plugin (TypeScript) and the engine (Kotlin).
Reference vectors live in `fixtures/*.json`, generated by
`scripts/export_fixtures.mjs`; `test/fixtures.test.js` fails when they drift
from the code. The engine's JVM tests consume the same files.

## 9. Version policy

`version` is bumped only for breaking changes (removed fields, changed
defaults, changed units). Additive optional fields (like `states`,
`breakImpulse`, `collisionGroup`, `selfCollide`) do not bump the version —
readers ignore what they don't know.
