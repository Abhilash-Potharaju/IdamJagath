# Porting Idam Jagath to another engine

See `ARCHITECTURE.md` for the layers. In short: **data and assets carry over as-is, the core carries over as-is
(TS/JS targets) or 1:1 (C#/GDScript/C++), and only the engine adapter + level presentation are rewritten.**

## Carries over unchanged

| What | Where | Notes |
|---|---|---|
| Gameplay tuning, mission, level layout, asset manifest | `data/` | Plain JSON, SI units, +Y up, yaw about +Y (radians). |
| 3D models | `public/models/**.glb` | glTF 2.0 — imported natively by Unity (glTFast), Godot, Unreal (glTF importer). Rigs + animation clips included. |
| Textures, HDRI, UI art | `public/textures/`, `public/hdri/`, `public/ui/` | PBR maps: colour / OpenGL normal / ARM (AO, roughness, metal). Unreal and Unity use DirectX-style normals for some pipelines: flip the green channel if needed. |
| Audio | `public/audio/*.m4a` + `manifest.json` | Re-encode to the target's preferred format (WAV/OGG) if required. |
| Credits / licenses | `data/assets.json`, `art/CREDITS.md` | Keep the in-game credits screen (CC BY). |
| Blender sources and build scripts | `tools/blender/`, `art/library/` | Re-export at higher/lower quality per platform. |

## The core (`src/core/`)

No engine dependencies, deterministic, ~1.3k lines.

- **TS/JS targets** (another web engine such as PlayCanvas or three.js, Electron/Tauri desktop, a Node game server): use
  `src/core` as-is.
- **Unity (C#) / Godot (GDScript or C#) / Unreal (C++)**: port file-by-file. It's plain classes and arithmetic:
  `math.ts` → engine vector types (watch handedness: core is left-handed +Y up like Unity; Godot and Unreal need an
  axis swap at the adapter boundary), `rng.ts` (keep mulberry32 for identical replays), `time.ts` (or use the engine's
  fixed update at 60 Hz), `events.ts` (C# events/signals/delegates), `entities/*`, `mission.ts`, `world.ts`.
- Keep the unit tests (`tests/core/`) and port them alongside; they define the expected behaviour.

## Rewrite per engine (the adapter)

| Current file (Babylon) | Responsibility | Unity | Godot | Unreal |
|---|---|---|---|---|
| `src/engine/babylon/BabylonPhysics.ts` | `IPhysics`: bodies, move with collisions, raycast, line of sight | `CharacterController.Move`, `Physics.Raycast`, `Physics.Linecast` | `CharacterBody3D.move_and_collide`, `PhysicsRayQueryParameters3D` | `UCharacterMovementComponent` / `SweepSingleByChannel`, `LineTraceSingleByChannel` |
| `src/engine/babylon/InputDevice.ts` | devices → `InputSnapshot` | Input System actions | `InputMap` actions | Enhanced Input |
| `src/engine/babylon/CameraRig.ts` | camera from `player.view` (interpolated) | Camera transform in `LateUpdate` | `Camera3D` | `UCameraComponent` |
| `src/engine/babylon/WeaponView.ts` | gun model, sway/bob/recoil animation, flash, shells, tracers, impacts | prefab + script / Animator | scene + script | Blueprint/actor |
| `src/engine/babylon/EnemyViews.ts`, `monsterModels.ts` | enemy models, animation from core state, tells, death | Animator driven by core state | AnimationTree | Anim Blueprint |
| `src/engine/babylon/MissionView.ts` | pylons, pickups, captives, beacon, globs, alarm, waypoint | prefabs + UI | scenes + UI | actors + UMG |
| `src/engine/babylon/fx.ts` | particles, decals, shells | VFX Graph / Particle System, Decal Projector | GPUParticles3D, Decal | Niagara, Decals |
| `src/engine/babylon/HUD.ts` (+ `index.html`, `src/style.css`) | HUD + menus | UI Toolkit / uGUI | Control nodes | UMG |
| `src/engine/babylon/Audio.ts` | play sound files, 3D panning/falloff, voice limits | AudioSource | AudioStreamPlayer3D | Sound Cues / MetaSounds |
| `src/game/Game.ts` | composition root + loop | a bootstrap MonoBehaviour (`FixedUpdate` = core step) | main scene script (`_physics_process`) | GameMode / Tick |
| `src/game/Level.ts`, `Dressing.ts`, `WarDressing.ts`, `Beauty.ts`, `Props.ts` | level geometry + set dressing from `data/level/level1.json` | import the planned Blender level scene + place props from JSON (editor script) | same | same |
| `src/game/Environment.ts`, `Fleet.ts`, `Graphics.ts` | sky, fog, lights, post, shadows, saucer fleet | URP/HDRP volume + skybox | WorldEnvironment | Post Process Volume + Sky Atmosphere |

## Adapter checklist

1. Implement `IPhysics` (4 methods) and tag shootable colliders with `{ kind, id, mul }` hit targets.
2. Map devices to `InputSnapshot` once per fixed step (accumulate look deltas; edges since the previous step).
3. Each fixed tick: `world.step(1/60, input)`; each render frame: read `world.player.view`, `world.enemies`,
   `world.globs`, `world.arsenal`, `world.mission` and interpolate transforms.
4. Subscribe to `world.events` for sounds, particles, HUD messages, hints, hit markers, shield toggles, deaths, mission end.
5. Port the view behaviours (weapon motion, enemy rigs/animations) using the target engine's animation tools.
6. Run the core unit tests in the target language; verify determinism with a recorded input replay (`stateHash`).
