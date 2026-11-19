# Idam Jagath: next steps (resume guide)

> Written 2026-11-18 to resume in a fresh session. Full history: [PROJECT.md](PROJECT.md).
> Architecture: [ARCHITECTURE.md](ARCHITECTURE.md) · Porting: [docs/PORTING.md](docs/PORTING.md) · Level pipeline: [docs/LEVEL_PIPELINE.md](docs/LEVEL_PIPELINE.md)

## How to resume
```bash
cd ~/Desktop/StartUpIdeas/idam-jagath
git status            # see section 1: there may be uncommitted work from the polish agents
npm run dev           # → http://localhost:5173  (?explore = no monsters, ?zoo = frozen monsters)
npm test              # 27 core unit tests
```
Then tell Claude: *"Resume Idam Jagath from NEXT_STEPS.md."*

Last committed state: `cc92c03` (stuck-in-corners fix). Approved visual baseline tag: `baseline-2026-11-10`.

## 1. ~~In-flight work~~ DONE (integrated 2026-11-18; see PROJECT.md). Remaining open items from it are in section 3.
Three polish agents were running when this was written. Their work is on disk but **not committed**.

| Workstream | Files it touched | Status when written |
|---|---|---|
| **Baked lighting** (Blender Cycles GI bake into the level's UV1 lightmap atlas) | `tools/blender/build_level.py` / `bake_level.py`, `public/models/level/*`, `public/textures/lightmaps/*`, `src/game/Level.ts`, `Beauty.ts`, `Environment.ts` | Bake works on the GPU (2K, 64 samples, about 87 s); game hookup and light rebalancing in progress. A/B flag: `?nolightmap` |
| **Menus and UI** | `index.html`, `src/style.css`, `src/main.ts`, `src/ui/*`, `HUD.ts`, `InputDevice.ts`, `Audio.ts` (volume buses), `Graphics.ts`, small `Game.ts` hooks | Main menu, loading screen with progress, pause menu, settings (localStorage), controls, end screens, HUD tweens. Final flow tests were running |
| **Asset compression** | `tools/assets/*`, `public/models/*` (not level), `public/textures/*`, `public/hdri/*`, `Props.ts`, `monsterModels.ts` (decoders), `data/assets.json`, `docs/ASSETS.md` | meshopt + KTX2/WebP, local decoders; final visual checks were running. Backup of the original public files is in a git-ignored folder |

**To integrate** (in this order):
1. `git status` / `git diff --stat` to see what landed. If a workstream is half-done, either finish it or `git checkout -- <its files>` to drop it.
2. `npx tsc --noEmit && npm test && npm run build`.
3. Scripted regression with `tools/dev/cdp.mjs`: no console errors, collisions, the mission reaches MISSION COMPLETE. Plus the **stuck test**:
   `OUT=/tmp node tools/dev/cdp.mjs "http://localhost:5173/?explore" "$(cat tools/dev/stuck_test.js); __game.ready.then(()=>new Promise(r=>setTimeout(r,3500))).then(()=>stuckTest(250,7))"`. Expect 0 stuck.
4. Playtest in the browser, commit, update PROJECT.md.

## 2. Next polish round (from player feedback)
Run as parallel agents, each with separate file ownership.

### A. ~~Mature gun and combat audio~~ DONE 2026-11-19 (owner to judge the mix). Open: player footsteps, ambience, alarm, stair-shaft reverb.
- `FREESOUND_API_KEY` is set in `.env.local` (git-ignored; verified working). Use **CC0** first; **CC BY** only if clearly better, and add it to `data/assets.json` and the credits.
- Layered gunshots: crack, body thump and tail, with the tail varying by space (narrow lane vs open plaza). Mechanical reload sounds (mag out/in, bolt), shells on stone, distant echo.
- Impacts on flesh and stone, a heavier kill-confirm, monster vocals (growls, screams, death cries), Warden footsteps and roar.
- Pipeline: search → download previews (HQ ogg/mp3) → trim and normalise → AAC in `public/audio/` → update `public/audio/manifest.json`. Audio.ts already plays files with fallback to the synth.

### B. ~~Mature kill and death presentation~~ DONE 2026-11-19 (`Corpses.ts`). Bodies now rest ~2.5 s, then fade in place (gone ~4.5 s after the kill; no more dipping through the roof slab). Tuning: `CORPSE` in Corpses.ts.
- Remove the purple death "puff". Monsters stagger, then **collapse with momentum** in the shot direction (ragdoll-like), twitch, and **alien ichor** pools under them. Corpses stay about 5–10 s, then sink and fade.
- Trishul knockback on kill; headshot/weak-spot kills show a distinct reaction; subtle hit-stop/camera punch on kills.
- Hit reactions depend on where the monster is hit.

### C. ~~Monster polish~~ DONE 2026-11-19 (Warden = Cyclops Rig brute). Open: death clips, crawler eye weak spot on the GLB, maybe a full-animation spitter (+3 MB).
- Find better rigged creatures on Sketchfab (CC0/CC BY; reject ripped franchise models). Priority: a **rigged brute for the Warden** (still procedural).
- Animation sets: idle, walk, run, attack, hit and death where available; blended procedural motion otherwise.
- Presence: glowing eyes, breathing, positional footsteps and growls; wet organic materials with a subtle red alien emissive.
- Keep AI, stats, tells and counters in `src/core` and `data/gameplay/enemies.json`; only the views (`src/engine/babylon/EnemyViews.ts`, `monsterModels.ts`) change.

### D. ~~Bigger, climbable Charminar~~ DONE 2026-11-18 (pylon on the roof). Next: playtest the look of the door, shaft and roof.
- 2026-11-19: stair widened (to the shaft wall, slimmer newel) and 6.4 turns instead of 7.5; spiders no longer clip through the walls (visual wall clearance, `clearance.ts`).
- **Scale up** toward real proportions (real: about 20 m square, about 56 m minarets; ours is about 30 m tall). Adjust plaza colliders and placements.
- **Climbable:** a doorway in one or more legs; a **spiral staircase inside** (visible steps plus an invisible smooth ramp collider, the industry-standard approach); a walkable roof terrace and upper gallery with railing colliders. The legs must be rebuilt hollow in Blender (the Sketchfab model's legs are solid).
- Update the collisions, the lightmap bake, `data/level/level1.json` anchors and the stuck test.
- **⚠️ Decision needed from the owner: what's on top?** (a) a sniper vantage point for the Warden fight, (b) a mission objective (a pylon or the captives), or (c) the secret.

### E. Round 3 (2026-11-19) DONE: Warden pathfinding + smaller Warden + door gate; captives as people; first-person arms; short-lived corpses. See PROJECT.md.
Suggested next (proposed to the owner, not yet approved):
- **Mutated-human monsters** (fits the story: aliens convert people). Sketchfab has almost nothing usable (franchise-styled or broken), so generate with Meshy (text→3D + rig + animate): needs `MESHY_API_KEY` in `.env.local` (owner to provide). Start with the Spitter (the "green monster"): swollen hunched human with a glowing growth as the weak spot; then the Crawler (backward-bent human on all fours). Same gameplay, model swap only.
- **Sound atmosphere:** player footsteps (stone/metal), city ambience, the ambush alarm, stair-shaft reverb.
- **World storytelling:** half-converted humans in pods near the cage, conversion goo.
- Load time (11 MB bundle), crawler eye weak spot + death clips, lightmap polish, difficulty levels, restart without reload.
- Arms: hands are static during reload (could animate the left hand to the mag); other monsters could use the nav grid (crawlers in corners).

## 3. Other backlog
- **Unreproduced (owner, 2026-11-19): a crawler froze mid-attack.** In the left lane near the pylon closest to the start (crawler spawns around (-28, 22) / (-33, 26)), it stopped while attacking the player: glowing (a tell) but doing nothing. Seen once. Suspects: the Crawler state machine stuck in windup/lunge/recover (e.g. a lunge blocked by a wall or pocket filler, or a `canReach` false loop), the depenetration pushing it back every step, or B's hurt reaction / C's windup crouch pose holding while the core moves on. If it repeats: note where, the weapon used and whether it was hit; then log `state`, `tell`, `pos` of the stuck enemy via `__game.enemies`.
- Lightmap: dark line at the lane start (z≈0); facades lack UV1 (not lightmapped); a 4K final bake; review light balance with `?nolightmap`.
- UI: restart/quit reload the page; key rebinding; head-bob setter in core.
- **JS bundle is about 11 MB** (all of Babylon imported). Switch to tree-shakeable deep imports (`@babylonjs/core/...`) or chunking to shrink it.
- Gallery/minaret window openings are sealed niches in the Charminar model (would need hand modelling). This could be combined with D.
- Replace the remaining runtime-drawn sprites in `fx.ts` / `Fleet.ts` with the exported PNGs (copies exist in `public/textures/generated/`).
- Before any leaderboards: the core is already deterministic (fixed 60 Hz, seeded RNG, `world.stateHash()`), so add input recording and server-side replay verification.
- Mobile touch controls (later). Steam build via an Electron/Tauri wrapper (later).
- Level 2 (suggested: Mumbai CST station + a local train) once Level 1 is polished.

## 4. Conventions to keep
- **Data-driven:** tuning goes in `data/gameplay/*.json`, layout/props in `data/level/level1.json`, assets and licenses in `data/assets.json`. Credits on the start screen are generated from the manifest.
- **Core vs engine:** `src/core/` has no Babylon/DOM imports, uses fixed dt and the seeded RNG; only `src/engine/babylon/` touches Babylon.
- **Assets:** prefer Poly Haven/ambientCG (CC0) → Sketchfab (CC0/CC BY, license verified via API) → Meshy/fal (AI) → Blender scripts. No NC/ND/editorial or ripped models.
- **Testing:** headless checks via `tools/dev/cdp.mjs` (it deletes its own Chrome profile). Take screenshots only when needed to verify, and delete them afterwards. Re-run `stuck_test.js` after any collision or level change.
- **Commits:** commit after each verified step; the owner playtests before big moves.
