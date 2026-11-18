# Idam Jagath — Architecture

The game is split into **portable data**, a **portable deterministic core**, and a **thin engine adapter**.
Porting to another engine means rewriting the adapter (and the level presentation); data, assets and core logic carry over.

```
data/                     engine-neutral JSON (gameplay tuning, mission, level layout, asset manifest)
public/                   assets: glTF models, PNG textures, HDRI, audio files
src/data/                 typed loaders + validation for data/ (pure TS, no engine)
src/core/                 PORTABLE CORE — game rules, deterministic, no engine/DOM imports
  math.ts                   Vec3 + helpers (yaw/forward/right conventions, springs)
  rng.ts                    seeded PRNG (all gameplay randomness)
  time.ts                   FixedStep accumulator (SIM_DT = 1/60 s)
  events.ts                 typed EventBus + GameEvents (what presentation can react to)
  ports.ts                  IPhysics, InputSnapshot, LevelAnchors (the only outward interfaces)
  context.ts                CoreContext (services entities share)
  entities/player.ts        movement, crouch/slide/jump, grounded + coyote time, health, recoil, shake, view
  entities/weapons.ts       Arsenal: fire rate, ammo, reload, switching, spread, pellet raycasts, damage
  entities/enemies.ts       Crawler / Spitter / Warden AI state machines
  mission.ts                objectives (pylons → cage → escape → won / dead), triggers, pickups, secret wall
  world.ts                  GameWorld: owns everything, step(dt, input), damageTarget, stateHash
src/engine/babylon/       ENGINE ADAPTER — Babylon.js implementation of ports + all presentation
  BabylonPhysics.ts         IPhysics: moveWithCollisions bodies, pickWithRay raycasts, line of sight
  InputDevice.ts            keyboard/mouse/pointer-lock → InputSnapshot (key bindings live here)
  CameraRig.ts              first-person camera from the core view (interpolated)
  WeaponView.ts             gun meshes/models, sway/bob/recoil animation, flash, shells, tracers, impacts, ammo HUD
  EnemyViews.ts             procedural rigs + animation, tells (glow), death poses; model skinning via monsterModels.ts
  MissionView.ts            pylons, pickups, secret wall, captives, cage door, beacon, globs, alarm, objective marker
  HUD.ts, Audio.ts, fx.ts   DOM HUD, sound playback (files + synth fallback), particles/decals
  convert.ts                Vec3 ↔ Vector3, setTarget (tags meshes as shootable targets)
src/game/                 composition root + level presentation (Babylon)
  Game.ts                   builds engine/scene/level/adapter/world, runs the loop, exposes window.__game for tests
  Level.ts, Dressing.ts, WarDressing.ts, Beauty.ts, Props.ts, Environment.ts, Fleet.ts, Graphics.ts
                            level geometry + set dressing + sky/lighting/post (data-driven from data/level/)
tests/core/               Vitest unit tests for the core (run without a browser, fake IPhysics)
```

## Data flow per frame

```
render frame (display rate, e.g. 120 Hz)
 ├─ FixedStep.advance(frameDt)          → N fixed steps (usually 0–2), capped at 5
 │    each step:
 │     ├─ input = InputDevice.consume()     held state + edges/look deltas since the previous step
 │     ├─ enemyViews.snap()                 body meshes exactly at core positions (raycasts test true positions)
 │     ├─ world.step(1/60, input)           player → weapons → enemies → crowd separation → globs → pickups
 │     │     │                              → triggers → hurt sound → death check
 │     │     └─ emits events ─────────────► views/HUD/audio react synchronously (sounds, particles, messages…)
 │     └─ enemyViews.record()               keep previous/current state for interpolation
 ├─ views.render(alpha)                 camera, enemies, globs interpolated by alpha; weapon/HUD/waypoint animate
 └─ scene.render()
```

The core never reads the clock or the screen: same seed + same InputSnapshots ⇒ the same game
(`GameWorld.stateHash()`), which enables replays, server-side score verification and reproducible tests.

## Ports (the core ⇄ engine contract)

| Port | Used for | Babylon implementation |
|---|---|---|
| `IPhysics.createBody / releaseBody` | collision bodies for player and enemies | invisible mesh with a collision ellipsoid |
| `IPhysics.move(id, from, disp)` | player and enemy movement with sliding collisions | `moveWithCollisions` |
| `IPhysics.raycast(origin, dir, range)` | hitscan weapons → `{point, normal, target?}` | `scene.pickWithRay`; meshes tagged with `metadata.target` |
| `IPhysics.lineOfSight(a, b)` | enemy sight, glob collision | pick against meshes marked as world |
| `InputSnapshot` | one step of player actions | `InputDevice.consume()` |
| `EventBus` (`GameEvents`) | everything presentation reacts to | subscriptions in `Game.ts` and the views |

Hit targets: a shootable mesh carries `{ kind: "enemy" | "shield" | "pylon" | "secretWall", id, mul }` (mul = weak-spot
multiplier). The core applies `damage × mul` via `GameWorld.damageTarget`.

## Conventions

- SI units: metres, seconds, m/s, radians. Left-handed, **+Y up, +Z north/forward**.
- Yaw = radians about +Y, 0 faces +Z: `forward = (sin yaw, 0, cos yaw)`, `right = (cos yaw, 0, −sin yaw)`. Pitch > 0 looks down.
- Entity positions are the centre of their collision ellipsoid; ground-plane data positions are `[x, z]`.
- Core rules: no `@babylonjs`, `window`, `document`, `Math.random`, `Date`, `performance` under `src/core/`.
  Presentation may use `Math.random` freely (it never affects gameplay).
- Gameplay numbers live in `data/gameplay/*.json`; visual-only constants may stay in views.

## How to add an enemy

1. Add its tuning block to `data/gameplay/enemies.json`, its type/validation to `src/data/schemas.ts`.
2. Core: subclass `Enemy` in `src/core/entities/enemies.ts` and implement `think(dt)` (use `move`, `face`,
   `seesPlayer`, `ctx.player.hurt`, `ctx.sound`, `ctx.hint`, set `tell` for its telegraph). Add it to `GameWorld.spawn`.
3. Adapter: subclass `EnemyView` in `EnemyViews.ts` (build parts with `part()` so they're shootable, implement
   `animate(dt)` from the core state, optionally `deathPose`); register it in `EnemyViews`' `enemySpawned` handler.
4. Spawn it from `data/gameplay/mission.json`. Add a unit test in `tests/core/`.

## How to add a weapon

1. Add an entry to `data/gameplay/weapons.json` (mag, fireInterval, reloadTime, damage, pellets, spread, range, kick,
   sound, model…). The core `Arsenal` picks it up automatically (switch with 1/2/wheel/Q — extend `InputSnapshot`
   with `weapon3Pressed` for more slots).
2. Adapter: add a procedural fallback mesh in `WeaponView.ts` (`PROCEDURAL_MESHES`) and a model in `public/models/weapons/`.

## Testing

- `npm test` — Vitest core tests (determinism, fixed timestep, movement/grounded/coyote, weapons, enemy tells,
  Warden stun, mission flow, pickups, secret wall). No browser needed.
- `node tools/dev/cdp.mjs <url> <js…>` — scripted browser checks against the dev server via `window.__game`
  (`player.body.position`, `enemies`, `simulate(seconds)`, `phase`, `stateHash()`…).
- URL modes: `?explore` (no monsters), `?zoo` (frozen monsters, invulnerable), `?seed=N`, `?bob=0..1`,
  `?classicmonsters`, `?quality=low|medium|high|ultra`, `?retro`, `?synthaudio`, `?shot=x,z,yaw[,pitch[,y]]&sim=seconds`.
