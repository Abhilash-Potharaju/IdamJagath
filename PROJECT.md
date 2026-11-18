# IDAM JAGATH – The Invasion · Project Tracker

> The single place to check the objective, decisions and progress. Updated as work happens.
> Original pitch: [CONCEPT.md](CONCEPT.md)

## Objective
Build **Level 1** of a browser-first, retro-inspired 3D FPS, end to end, as a solo AI-assisted project:
a polished **5-minute mission** that people can play from a link with no install and no login.

**How we judge success:** Do players finish the mission, play it again, and share it? If yes → submit to Poki/CrazyGames → consider a Steam page later.

## Key decisions
| Decision | Choice | Why |
|---|---|---|
| Platform | **Desktop browser first**; mobile touch later as a separate effort | Mobile-browser FPS is the hardest target (no pointer lock, iOS limits) |
| Distribution | Share links → web portals (Poki, CrazyGames) → maybe Steam (Electron wrapper) | Portals are where browser players are; Steam is where retro-FPS buyers are |
| Engine | **Babylon.js 9 + TypeScript + Vite** | Code-only setup suits AI-assisted work; built-in collisions, glow, glTF |
| Look | "Recognisable, not photoreal" low-poly + fog + half-resolution pixelated render | Fast on weak machines, hides AI-asset flaws, retro feel |
| Level 1 location | **Charminar + Laad Bazaar, Hyderabad** (default; user can change) | Dense lanes and rooftops play well; iconic outline |
| Monster design | Every monster has a **tell** (warning sign) and a **counter** | The core "observe, understand, counter" pillar |
| Multiplayer | Not until solo PvE proves fun | Netcode/servers/anti-cheat would swamp a solo dev |
| 3D models | Blender (via MCP) + AI generators (Meshy etc.) only when needed; pay for one month in the asset phase | Free plans can't use the API; models need cleanup anyway |
| Landmarks to avoid | Taj Mahal **Palace hotel** (registered trademark), real brand billboards, scenes of desecrating religious sites | Legal and cultural risk |

## Phases
| # | Phase | Status |
|---|---|---|
| 0 | Setup: project, Blender, MCP tools | ✅ Done (the Blender MCP is usable after a Claude Code restart) |
| 1 | **Gray box**: blocky level, 1 weapon, 2 enemy types + special monster, rescue objective, win/lose | 🟢 First playable built — **needs your playtest** |
| 1b | **Animated monsters + sound** (code-driven) | ✅ Done 2026-11-05 |
| 2 | Art style test: one finished street corner (textures, lighting, alien growth) | 🟡 First Blender models in the level; textures/lighting pass still to do |
| 3 | Assets: Charminar, bazaar props, 3 monsters, weapon | 🟡 Charminar, stall, rickshaws, street props, pylon done. Monster/weapon models still primitives |
| 4 | Full mission with final art, sound, menus | 🟡 Sound done |
| 5 | Polish: performance, load size < ~20 MB, bugs | ⚪ |

## Level 1 design (as built in the gray box)
**Mission:** Destroy 3 conversion pylons → the cage opens → free the captives → return to extraction.

```
 z112 ┌──────────── PLAZA ─────────────┐
      │  P3     [cage + captives]       │
      │       ╔═ CHARMINAR ═╗           │   ← Warden ambush when you enter
      │       ╚═════════════╝      P2   │
 z60  └─────────┐ LANE  ┌───────────────┘
 courtyard─alley│(bazaar)│▒ secret room (breakable wall)
  (P1)          │ stalls │
 z0             └─START──┘ extraction pad (green beam)
```

| Element | Details |
|---|---|
| Weapon 1: **VAJRA** | Pulse rifle: automatic, accurate, 30-round magazine, 20 damage per shot |
| Weapon 2: **TRISHUL** | Scatter cannon: 9 pellets × 11 damage, 6 shells, slow (0.75 s). One-shots a Crawler up close; ideal against a stunned Warden |
| Switching | Keys 1/2, mouse wheel, or Q (previous weapon). About 0.36 s to swap; swapping cancels a reload |
| Objective marker | A ◆ marker with the distance always points to the next goal (nearest pylon → cage → extraction) and sits at the screen edge when the goal is behind you |
| **Crawler** | Fast and low, zig-zags toward you. **Tell:** crouches and glows orange. **Counter:** strafe sideways to dodge the lunge |
| **Spitter** | Keeps its distance and lobs slow acid globs. **Tell:** its sac swells. **Counter:** sidestep; shoot the sac for 2× damage |
| **Warden** (special) | Shielded brute; its front shield absorbs all fire. **Tell:** glows red. **Counter:** dodge its charge so it slams into a wall → stunned, shield down, 2× damage. It turns slowly, so you can flank it |
| Surprise encounter | Entering the plaza: red alarm, the Warden drops in, Crawlers flank you |
| Secret | A cracked wall in the lane (east side, about 15–21 m north of the start). Shoot it to find "Ancestor's Blessing" (+100 overcharge health) |
| Escape | Freeing the captives sends a new enemy wave into the lane |
| Pickups | 3 health packs (+25 each) |

## How to run
```bash
cd idam-jagath
npm install        # first time only
npm run dev        # → http://localhost:5173
```
- Controls: WASD or arrow keys move · mouse aim · click shoot · right-click (hold) zoom · 1/2, mouse wheel or Q switch weapon · R reload · Space jump · Shift sprint · Esc pause
- `?hd` → full-resolution rendering (no pixelation)
- Test hook: `?shot=x,z,yawDeg,pitchDeg&sim=seconds` skips the menu, places the camera, and fast-forwards the game logic (used for headless screenshot checks)

## Tooling status
| Tool | Status | Notes |
|---|---|---|
| Node 26 / npm | ✅ | |
| Babylon.js 9.34, Vite 8, TypeScript 7 | ✅ | |
| Blender **5.2.3 LTS** | ✅ Installed via `brew install --cask blender` | |
| Official Blender Lab MCP (add-on + server) | ✅ Installed 2026-11-05 with the user's permission | Add-on `bl_ext.user_default.mcp` (auto-starts, port 9876). Server at `~/.local/bin/blender-mcp` (via `uv tool`). Registered in `.mcp.json` (project and the StartUpIdeas root). Tools appear after restarting Claude Code; open Blender for the live-session tools. Headless scripts (`blender --background --python …`) also work without it |
| Meshy (AI 3D) | ⚪ Not needed until Phase 3 | API needs a paid plan (Pro); free models are CC BY 4.0 |
| ElevenLabs (sound effects) | ⚪ Not needed until Phase 4 | Free tier probably enough |
| Headless Chrome screenshots | ✅ | Used for visual checks |

### Blender MCP: ✅ installed (notes kept for reinstalling)
The official Blender Lab MCP (projects.blender.org/lab/blender_mcp, v1.0.x, needs Blender 5.1+) has two parts:
1. **Blender add-on**, either:
   - download `mcp-1.0.3.zip` from https://www.blender.org/lab/mcp-server/ and drag it into Blender (twice: first to add the repository, then to install), or
   - approve Claude to build it from source with `blender --command extension build/install-file`.
2. **MCP server:** `uv tool install "git+https://projects.blender.org/lab/blender_mcp.git#subdirectory=mcp"` then `claude mcp add blender --scope project -- blender-mcp`. Restart Claude Code afterwards so the Blender tools appear.

⚠️ Blender's own warning: the MCP runs AI-generated Python inside Blender **with no sandbox**. Only use it on project files you don't mind being changed.

## Known issues / TODO
- [ ] **Confirm on a real GPU:** SSR + SSAO are back on by default (done 2026-11-09). Check there is no grainy pattern and FPS stays healthy; headless tests only run at ~5 FPS at reduced resolution, so they cannot confirm either.
- [ ] Bundle is about 6.3 MB (1.4 MB gzip) because Babylon is imported in full. Switch to deep imports later to shrink it.
- [ ] Enemies chase in straight lines (no pathfinding). Add a navigation mesh (Recast plugin) if they get stuck.
- [ ] Hint messages can overwrite each other when several fire at once; queue them.
- [x] ~~No sound yet~~ → synthesized sound effects added (not yet listened to by a human; tune by ear).
- [x] ~~Buildings are still plain blocks~~ → facades and shop signs added.
- [ ] Measure real-GPU FPS (headless numbers aren't meaningful); `?hd` mode may be heavy.
- [ ] Lamp lights don't light enemies (they're limited to meshes that exist at load time); fine for now.
- [ ] The ambush alarm red is very saturated under the new tone mapping; consider softening it.
- [ ] The Warden is mostly hidden behind its translucent shield from the front; consider a more opaque, patterned shield.
- [ ] The weapon's glowing core is very bright under the glow layer; tone it down or exclude it from glow.
- [ ] Balance: the ambush is harsh if you stand still. Tune after playtesting.
- [ ] Mobile touch controls (later).
- [ ] **Before any leaderboards:** make the simulation deterministic (fixed 60 Hz time step + seeded random numbers instead of `Math.random`) so runs can be verified by replaying the player's inputs on a server. Anti-cheat plan: plausibility checks → replay verification → server-run game only for public co-op/PvP.

## Progress log
### 2026-11-05
- Evaluated the idea (market, browser vs. Steam, landmarks, AI-asset pipeline). See the chat notes summarised above.
- Installed **Blender 5.2.3 LTS** via Homebrew.
- Researched the Blender MCP options: the **official Blender Lab MCP** (chosen) and the community "MCP for Blender" (ahujasid), which adds Poly Haven, Sketchfab and AI generators.
- Created the `idam-jagath/` project (Vite + TypeScript + Babylon.js).
- Built the **Phase 1 gray box**: level layout, player controller, weapon, 3 monster types with tells and counters, pylons, secret wall, captives, ambush, escape wave, pickups, HUD, win/lose/pause screens.
- `npm run build` passes. Headless screenshots checked: lane, courtyard pylon, plaza, ambush (Warden charge, Spitter globs and hints all working).
- First playtest by the user: "it is good". Feedback: add arrow-key movement → **done** (arrow keys work alongside WASD).
- User: "it's great". Discussed client vs. server computation and anti-cheat (added to TODO).
- Added **right-click zoom** (hold): about 2.3× zoom, slower mouse-look while zoomed, tighter spread, gun moves to the centre, slower movement and no sprint while zoomed.
- User feedback: "the level is not ending". An automated end-to-end run (headless Chrome driven over the DevTools protocol) showed the mission logic **does** complete: pylons → cage → extraction → MISSION COMPLETE. Likely cause: unclear objectives (the courtyard pylon is hidden down a side alley; you must *walk into* the cage). Fixes: a **◆ waypoint marker** with distance, and clearer objective text.
- Added a **second weapon (TRISHUL scatter cannon)** and weapon switching (1/2, mouse wheel, Q). Weapon selector shown in the HUD. Tested automatically: all three switch methods work, the Trishul one-shots a Crawler, the Vajra damages a Spitter.
- Fixed the test-only fast-forward (`?sim=`) so collisions behave the same as in real play.
- ✅ **User completed the level.** Bug report: after taking one health pack, the others turned grey (picking one up also deleted the material they all shared). **Fixed** and checked automatically.
- **Step A + first art, run as 3 parallel agents** (each owning separate files):
  - **Monsters** (`enemies.ts`): multi-part, code-animated. Crawler = 6-legged walking gait, mandibles, flips on death. Spitter = swaying 4-segment neck, wriggling tendrils, rears back to spit. Warden = stomping legs, swinging arms, horns, slumps when stunned, falls on death. All have hit flinches and ~0.5 s death animations. Stats, AI, tells and counters unchanged.
  - **Sound** (`Audio.ts`): 29 effects synthesized at runtime with Web Audio (no files, no keys), positional (pan + falloff), an ambient alien drone, **M = mute**. Hooked into weapons, enemies, pylons, pickups, mission events.
  - **Blender** (`tools/blender/`, `public/models/`): models generated by Python scripts in headless Blender 5.2.3: `charminar.glb` (with toggleable, pulsing alien growth), `rickshaw.glb`, `rickshaw_wrecked.glb`, `bazaar_stall.glb`, `street_props.glb` (lamp post, signboard, water drum, crystal pylon, electric pole with sagging wires). 728 KB total. Regenerate with the commands in `tools/blender/README.md`.
- **Integrated the models** (`Props.ts` loader + `Level.decorate()`): the gray boxes they replace become invisible colliders (collisions and line of sight unchanged), and the models are visual and catch bullets. Pylons are now the crystal model and stay shootable. The Start button shows "Loading…" until the models load (falls back to gray boxes if a model fails).
- Installed the **Blender MCP** with the user's permission (see Tooling status).
- Regression test passed: models load, the crystal pylon is destroyed by rifle fire, the full mission reaches MISSION COMPLETE, no console errors, and `npm run build` passes.
- User feedback: "still looks lifeless: no colour, no sky". **Atmosphere pass + set dressing** (2 parallel agents, then lead integration):
  - `Environment.ts`: a shader sky (sunset glow, aurora bands, stars, clouds, a big moon), fog matched to the horizon, a cool moon against warm lamp and fire lights (point lights limited to meshes in range), post-processing (ACES tone mapping, contrast/saturation, bloom, vignette, slight chromatic aberration; grain off for performance), canvas-generated surface textures (pastel plaster facades with windows, cobbles, sandstone), particles (embers, smoke, alien spores, dust), and the **mothership** in the sky.
  - Blender: `facades.glb` (6 old-city building fronts + pilasters: balconies, shutters, AC units, laundry, lit windows, shop-sign bands), `mothership.glb`, `debris.glb` (burning car, rubble, crashed alien pod, sandbags, barricade).
  - `Dressing.ts`: tiles the facades along every lane and plaza wall, adds **lit shop signs in Telugu / Hindi / Urdu / English** (generic text, no brands), and places debris with invisible colliders. The burning car has a flickering fire light.
  - Bugs fixed during integration: the facades were inset behind the now-visible walls (made flush), and the sign text was upside down (the panel's V axis is flipped; verified with a Latin test string).
  - The extraction pad stays dim until the escape phase.
  - Regression test passes. Models total 1.4 MB. Headless software rendering runs at about 13–50 FPS (not representative; check on a real GPU).
- Decided: **no Meshy or image generator needed for the environment**. Revisit an image generator (concept art) + Meshy (image → rigged model) for the monster models in Phase 3. Midjourney has no official API; good alternatives are OpenAI/Gemini/Flux (fal.ai, Replicate).
- **Next ideas:** add shop-sign text in Telugu/Hindi/Urdu, warm lamp lighting, building facades for the plain blocks (balconies, shutters, signage), Blender-made monster and weapon models, and deterministic simulation before any leaderboards. Dev server stopped. To resume: `npm run dev` in this folder.
- **Next:** you playtest at http://localhost:5173 and give feedback on how it feels. Approve the Blender MCP install so Phase 2 can start.

### 2026-11-06
- **Sketchfab Charminar integrated**: "Charminar, Hyderabad" by Dolores (https://skfb.ly/YqOB), CC BY 4.0. It was supplied by the user as GLB and .blend; the .blend had no embedded scripts and was opened with auto-run scripts disabled.
  - `tools/blender/import_charminar_skfb.py` (reproducible): drops the display plinth → scales to the level footprint (17.6 m, about 30 m tall, arch openings about 6.6 m, wider than the 6 m collider gap) → decimates from about 113k to 39k triangles → UV-unwraps → **bakes ambient occlusion** (Cycles, 384 samples) into a 2K limestone texture → `public/models/charminar_skfb.glb` (2.8 MB).
  - In game: replaces the scripted Charminar (`?oldcharminar` compares). Collision boxes unchanged. The old model's minaret vines don't fit the new minarets, so only the arch growth is kept for now. **TODO: regenerate an alien-growth layer fitted to the new geometry.**
  - Credits: `art/CREDITS.md` + a line in the start-screen footer (CC BY requirement).
- Added policy: accept CC0 / CC BY; avoid NC / ND / editorial / ripped models (see `art/CREDITS.md`).
- Saved ChatGPT key art as a style reference: `art/concepts/keyart/charminar-occupied-chatgpt.png` (suggests a red alien palette, stormy sky, wet streets, a saucer fleet, banners; pending the user's decision on red vs purple).
- fal.ai researched: an official hosted MCP (OAuth, `https://mcp.fal.ai/mcp-relay`) with image and 3D models (Hunyuan3D, Rodin, Tripo…), pay-per-use. Not yet connected.
- **Asset standard adopted** (`art/library/README.md`): realistic PBR everywhere. Sourcing order: Poly Haven/ambientCG (CC0) → Sketchfab (CC0/CC BY, license-filtered) → Meshy/fal (AI) → Blender scripts.
  - **Poly Haven library fetched** (`tools/assets/polyhaven_fetch.py`, md5-verified, manifest): 20 PBR materials (weathered plasters, brick, cobblestone, painted/peeling wood, rusty shutters, corrugated iron), 3 night HDRIs (incl. `cobblestone_street_night`), 33 props (hidden-alley kit: electricity poles/cables, AC units, roller shutters, street lamps, manhole, utility box; brass pots/diya lantern, crates, covered car…). About 260 MB of sources in `art/library/polyhaven/`. Contact sheets in `art/library/previews/`.
  - **Sketchfab MCP installed** (AliRezaBeigy/sketchfab-mcp-server, reviewed at commit c4c5ab6, installed to `~/.local/share/mcp-servers/sketchfab`, deps with `--ignore-scripts`). The token is read from `idam-jagath/.env.local` (git-ignored) by `run.sh`; registered in `.mcp.json`. **The user must put a real token in `.env.local` and restart Claude Code.**
  - Next: build the **"beauty block"** (one stretch of the bazaar lane) in Blender with these materials + props + baked lighting, as the quality benchmark.
- **Beauty pass v1 (lane + yard), approved by the user ("look good for now")**: `src/game/Beauty.ts` (`?classic` = old look).
  - Poly Haven PBR materials (1K, `public/textures/`): cobblestone street, stone ground, 6 weathered plaster wall variants, worn brick yard/court walls. HDRI image-based lighting (`public/hdri/cobblestone_street_night_2k.hdr`).
  - Props optimized by `tools/blender/optimize_props.py` (real scale, decimated, ≤1K/512 textures, about 10 MB total, `public/models/props/`): bhel-puri cart, 2 thela stalls, 3 auto-rickshaws, cycle rickshaw, paan kiosk, 6 AC units, crates + brass ware, boxes, barrel, bins, tyre, plants, utility box, manholes.
  - Kirana shopfront held back (real-looking brand). **TODO:** repaint the bhel-puri cart signage ("Kailash"); tone down the green extraction pad under PBR lighting; extend to the plaza and facades; Blender light-baking.
- **Charminar v2 look** (user: vines primitive, texture needs work):
  - **Purple alien vines removed** entirely (`?oldcharminar` still shows the old scripted model with them).
  - New surface: tiling photo-scanned lime plaster over stone (Poly Haven `plaster_stone_wall_01`, CC0) on a second world-scale UV set, multiplied by a baked **weathering map** (AO contact shadows × procedural grime + vertical rain streaks) on the first UV set. `tools/blender/import_charminar_skfb.py` now outputs both UV sets + `public/textures/charminar/charminar_weathering_2k.jpg`. Material in `Beauty.ts` → `charminarMaterial()`.
  - Reads golden-sand under the warm night grade (close to the real monument under floodlights). Tune the tint by eye if needed.
  - Occupation visuals for the Charminar to be redone properly later (e.g. red beams from the mothership), not vines.
- **User feedback on Charminar v2: "messed up".** Revisit next session. Options: revert to the plain limestone × AO look (v1), or rework the material with the user's direction (reference photos of the real Charminar). The GLB's built-in fallback material (limestone × weathering) shows with `?classic`.
- **Paused here (2026-11-07).** Dev server stopped. Resume: `npm run dev` in idam-jagath.
### 2026-11-09
- User: Charminar output "better". Bug: could walk through autos and other props → **fixed** with `makeSolid()` in `Props.ts` (an invisible collision box fitted to each model in its own rotated space, blocks movement and line of sight; bullets still hit the visible model). Applied to all solid beauty props + lamp posts + water drums (26 colliders). Verified by scripted walk tests (no screenshots).
- **No more screenshots** (user request: disk space). Freed about 970 MB of test screenshots and Chrome test profiles from the scratchpad. Verify with scripted checks only, and delete test browser profiles after runs.
- Free image→3D options noted: Hugging Face demo Spaces (TRELLIS v1 MIT, Hunyuan3D, Stable Fast 3D, TripoSG; quotas, mixed licenses), Meshy free plan (CC BY outputs), Tripo free tier. **TRELLIS.2 can't run on this Mac** (M5, 16 GB; official needs NVIDIA 24 GB+, the Mac port needs 24 GB+ unified memory). Cheapest paid route if needed: TRELLIS.2 via API (~$0.10–0.35/model, e.g. fal).
- **Sketchfab round 2 (CC BY)** downloaded to `art/library/sketchfab/`: guns AR-H470 + RL0N-25 (Frostoise, matched set); monsters Spiderthing (2 anims), alien quadruped (1 anim), Insectoid (Prowl anim), Ravager (no rig); Alien Eggs. Credits recorded.
- **Real gun models in game**: `tools/blender/optimize_weapons.py` (auto muzzle detection, real length, ≤1K textures) → `public/models/weapons/ar_h470.glb` (Vajra), `rl0n_25.glb` (Trishul). They load into the existing first-person roots (recoil/reload/zoom/switch unchanged); the procedural gun is the fallback. If a gun shows backwards, set FLIP in the script.
- **Credits screen**: start screen "Credits" dropdown listing all CC BY models in game (`src/credits.ts`), plus a Poly Haven CC0 note.
- **Next:** animated monster models (Spiderthing → Crawler, quadruped → Spitter; Warden stays code-animated until it's rigged).
- **Animated monster models in game** (`src/game/monsterModels.ts`, `tools/blender/optimize_monsters.py` keeps rigs/anims, textures ≤1K):
  - **Crawler = "Spiderthing take 3"** (Rasmus82), **Spitter = "alien monster"** (victory_), both CC BY and credited on the start screen.
  - Each model is parented to the existing enemy (AI, colliders, HP, tells unchanged), auto-scaled and grounded, and its walk animation's speed follows actual movement. Hits register on the model; tell/flash glow is mirrored onto its materials; on death it freezes and topples. The Spitter keeps its glowing **sac** (×2 weak spot + swell tell) re-seated on the model's back.
  - **Warden** stays procedural (the Ravager model has no rig yet).
  - New URL modes: **`?zoo`** (monsters spawn frozen, no damage, no ambush; for viewing models), **`?classicmonsters`** (old procedural monsters).
  - Regression passed: hits via model meshes reduce HP, all 11 enemies die, full mission → MISSION COMPLETE, no errors, build OK. Check images were deleted after use.
- **"Modern FPS" pass** (user: "feels like a 1970s game"; decided: drop the retro *look*, keep the retro *design*). Two parallel agents + lead integration:
  - **Rendering** (`Graphics.ts`, Environment/Game setup, `style.css`, `index.html`): full resolution (DPR-aware, cap 2, adaptive resolution), MSAA4 + FXAA + sharpen, **cascaded shadows** from the moon (casters swept as models/enemies load), **SSAO2** contact shadows, **SSR** wet-street reflections, damp cobble roughness, chromatic aberration off. Presets `?quality=low|medium|high` (default high); `?retro` = old pixel look. Modern HUD/menu (Rajdhani + Inter, key-art menu background `public/ui/keyart.jpg`).
  - **Game feel** (`Weapon.ts`, `Player.ts`, `fx.ts`, `feel.ts`, `HUD.ts`, `Audio.ts`): spring recoil + camera kick, sway/bob/breathing, sprint pose (no fire), smooth ADS, reload/switch/landing animations; muzzle-flash sprites + smoke, pooled shells (30), tracers (12), bullet holes (60), sparks/dust, alien ichor + splats (24), kill-confirm marker; acceleration, **crouch (C / Left Ctrl)**, **slide (crouch while sprinting)**, landing dip, sprint FOV, `?bob=0..1`, trauma camera shake, damage-direction arcs, low-HP vignette + heartbeat, footsteps.
  - **Lead:** merged each facade module into one mesh per vertex layout (**scene meshes 1,734 → 697**) for draw-call and shadow performance. Integration test: tsc + build OK, no errors, full mission → MISSION COMPLETE.
  - **Needs a real-GPU check:** headless software rendering can't measure FPS meaningfully. If it's slow, use `?quality=medium` or `low`.
- **Fix:** user saw a "mask pattern" over the view and gun after-images. The cause was SSAO2 (grainy screen pattern) + SSR (temporal smear/ghost trails). Both are now **opt-in via `?quality=ultra`**; default high = shadows + MSAA + FXAA only (crisp). Verified the default is clean, no errors.
- **Key-art mood pass** (target: `art/concepts/keyart/charminar-occupied-chatgpt.png`; alien colour switched **purple → blood red**). Two parallel agents:
  - **Mood** (`Environment.ts`, `Fleet.ts`, `tools/blender/saucer.py`, Game.ts colours + one fleet line): stormy charcoal sky with rolling clouds lit red from below, lightning every 8–20 s, red-grey fog, cooler hemi + red bounce, key-art grade; red pylons/beams/glows (incl. mothership `ShipGlow`); **5 saucers** (`saucer.glb`, 2.4k tris) orbiting with pulsing red tractor beams + mothership beam; 6 skyline smoke plumes with fire glow; ember/ash particles.
  - **Set dressing** (`WarDressing.ts`, called from Dressing.ts): 4 burnt cars (2 smouldering with light/smoke), 7 rubble piles, all solid; **9 red alien propaganda banners** (original emblem, swaying; none on the Charminar); **3 glowing alien billboards** (scanlines/flicker); bullet/scorch decals; 13 puddles + wetter ground roughness. 6 new Sketchfab CC BY assets credited (16 credits on the start screen). About 87k tris added.
  - Integration: tsc + build OK, no errors, full mission → MISSION COMPLETE. 1,128 meshes.
  - Polish backlog: the **captive cage** is still gray-box slabs with a purple tint, so make real red-lit alien bars; the pre-existing wrecked-rickshaw collider at (0,33.75) sits mid-lane (passable around).
  - Paid tools that would help further: fal.ai credits (custom 3D/textures), Blockade Labs Skybox AI (key-art 360° sky), Meshy Pro (rigged Warden), ElevenLabs (SFX).
- Fixes (user feedback: gun after-image while walking/swaying; screen goes white when firing):
  - **White-out:** muzzle point light 7/4 → 1.6/0.9, range 12 → 7, moved 1.9 m forward; smaller, 80%-alpha flash sprite; bloom threshold 0.72 → 0.88, weight 0.45 → 0.3.
  - **Ghosting (likely low FPS strobing at 2× DPR + MSAA4 + 3 cascades):** default high is now DPR cap 1.5, MSAA 2, 2 shadow cascades (DPR 2 / MSAA 4 / 3 cascades on `?quality=ultra`). Added an **FPS counter** (top-right, F to toggle, `?nofps` hides) to diagnose on real hardware.
- **Real cause of the gun "after-image" found and fixed:** `Player.grounded` flickered every other frame while walking (the tiny per-frame gravity step sometimes missed the floor), so the weapon bob (and head-bob) switched on/off each frame and the gun alternated between two positions (37 direction flips in 40 frames → 0 after the fix). Fix in `Player.ts`: a stick-to-ground probe (min −3 m/s down while grounded) + 0.12 s coyote-time ground timer. Jump/landing verified; collisions + mission regression OK.
- **Paused here (2026-11-09).** Dev server stopped. Resume: `npm run dev` in idam-jagath. First task: the TODO to re-enable SSR/SSAO.
- **Resumed.** SSR + SSAO re-enabled by default on high/ultra (SSAO also on medium). Tuned: SSAO full-res with 24 samples; SSR `roughnessFactor` 0 (no per-pixel jitter), threshold 0.03. `?ssao=0|1`, `?ssr=0|1` override the preset. Checked alone and together in the lane + plaza: building fronts intact, no errors.
- **White wash when firing, real cause found by measuring:** muzzle smoke, not the flash. Pale particles growing near the camera fogged the view during sustained fire (mean screen brightness climbed 0.223 → 0.258; now flat at 0.239 with SSAO/SSR off, same test setup). Smoke is now darker, fainter, smaller, shorter-lived and starts 0.7 m ahead of the muzzle (1 particle per rifle shot, 3 per shotgun). Flash sprite no longer doubles diffuse + emissive (emissive level 0.65, alpha 0.75).
- Testing notes: drive headless runs with the render loop running (a stopped loop gave false "missing building" and black images because shaders hadn't compiled). Seen once: a fully black frame readback at very low FPS, possibly adaptive resolution resizing the canvas; not investigated.
- **Paused here (2026-11-09).** Dev server stopped. Resume: `npm run dev` in idam-jagath. Waiting on user feedback: is the grainy pattern gone with SSR + SSAO on, and what is the FPS now? Also confirm the muzzle smoke/flash fix by eye.
- 2026-11-10: user saw a "grey messy pattern on the HUD": `backdrop-filter: blur()` on the objective/health/ammo panels was blurring the busy 3D scene behind them. Removed from the in-game HUD panels (solid, darker backgrounds instead); the menu/pause panel keeps its glass blur.
- **Grey maze pattern (user screenshot at the start-yard pad) found and fixed:** it only appeared with **SSAO + SSR together** (each alone is clean, A/B tested). SSAO is now off by default (opt-in only on `?quality=ultra&ssr=0`); SSR stays on. Also the extraction pad's green emissive was bleeding through the GlowLayer over the whole view and the gun, so the pad is now excluded from glow. Verified at the same viewpoint: clean ground, solid gun, no errors.
- **BASELINE SET (2026-11-10)**, user: "looking excellent now… set this as baseline". Project is now a git repo; commit `b4fa2ff`, tag **`baseline-2026-11-10`**. Compare: `git diff baseline-2026-11-10`; roll back: `git checkout baseline-2026-11-10 -- .`. Raw asset sources (`art/library/**`, about 490 MB) are git-ignored but re-fetchable; their manifests are committed. `.env.local` (Sketchfab token) is ignored.
- **Charminar fix** (user screenshot: transparent patches under the gallery, ragged sheets, muddy blotchy colour):
  - `import_charminar_skfb.py`: **planar decimation** (DISSOLVE 1.5°, keeps flat architecture exact; the old 35% collapse decimation tore the arches/roof undersides) + triangulate + consistent normals → 71.7k tris, 5.1 MB GLB.
  - `charminarMaterial()`: smooth cream lime plaster (`painted_plaster_wall`, tint 0.98/0.90/0.76, subtler bump) instead of the stone-embedded texture (dark blotches); **double-sided** so one-sided source faces can't show through; weathering map kept (strength 0.7).
  - Verified from the user's viewpoint: arch solid, no holes or sheets, no errors.
- User: Charminar structure "looks perfect now". **Colour toward the real monument:** albedo tint → warm beige lime stucco (0.90/0.82/0.68), plus 4 warm **floodlights** (`charminarFloodlights()` in Beauty.ts: SpotLights #ffcf8a at the base aiming up at each face, lighting only the monument meshes), like its real night lighting. Verified from the plaza corner; no errors.
- Charminar per user: **floodlights removed**; **dark weathering** ("black touch-ups"): grime ramps darkened (0.62 → 0.22, 0.78 → 0.50), AO curve deepened (near-black crevices), material weathering strength 0.95 / light impact 0.85.
- **"Make the holes passthrough": attempted and reverted.** A silhouette render showed the gallery/minaret window openings are **sealed niches** in the source model (only the main arches are open; the model is hollow inside). Rule-based deletion of niche back walls was tried twice, but the planar-decimated walls are long sliver triangles, so niche vs wall couldn't be separated (it removed whole wall bands / left jagged tears). **Options:** (a) hand-model the gallery arcade openings in Blender (cut arched openings with booleans at the measured niche positions, about 0.6 m deep, z 10–16 m), (b) find/buy a Charminar model with open arcades, (c) keep sealed niches with dark interiors (current).
- **Polish pass (user: minaret weathering, entrance auto, burning auto, floating stones):**
  - **Entrance auto** looked smeared/dark: Sketchfab models came in as ALPHABLEND although opaque (broken depth sorting/shadows). `place()` now switches such materials to alpha-test, which fixes all props.
  - **Burning auto** mid-lane: replaced the blocky scripted wreck with the real auto model, charred (soot albedo, matte, faint ember emissive) and slumped; fire reworked (tapered flame tongues with colour/size gradients, a small hot core, billowing smoke) and toned down so the auto still reads through the flames.
  - **Floating stones** (old scripted `Rubble_Pile` blocks) replaced by grounded photoscanned rubble (concrete chunks/piles/debris) with colliders.
  - **Minaret weathering:** bake now uses tight UV packing + a 4K weathering map (2K with wide margins left only a few pixels per wall), adds a minaret-zone mask with long dark rain/soot streaks, and the map is applied as a **shadow-map lightmap** (multiplies all lighting, so it's visible under the red lights) with a brightness remap so clean stone stays light. Charminar GLB is now about 8.4 MB.
  - Dev test driver moved into the project: `tools/dev/cdp.mjs` (auto-deletes its Chrome profile).
  - Regression: burning auto and lane rubble block movement, mission → MISSION COMPLETE, no errors, build OK.
- User: "charminar is looking very good now". Fixes from screenshots: the thin ragged "concrete_debris" slabs (read as floating sheets in the courtyard and plaza) replaced everywhere with solid rubble piles/chunks; burning auto keeps its real yellow-green paint darkened by soot (albedo 0.42, no orange emissive); fire light moved above the roof and flames confined to the cabin so the body reads. Mission regression OK.
- Photoscan "rubble_pile" (Sketchfab) was shredded by decimation into ragged, see-through scraps: all 7 uses replaced with "concrete_chunks". Thin "concrete_debris" was already removed. No photoscan rubble remains.
- **PORTABILITY REFACTOR, Phase 1 done** (data extraction; game looks and plays identically):
  - Gameplay data: `data/gameplay/{weapons,enemies,player,mission}.json`, validated by `src/data/schemas.ts` (no engine imports).
  - Level data: `data/level/level1.json` (anchors, 60 blocks, 73 props, facade runs, lights, banners, billboards, decals, puddles), loaded by `src/data/level.ts`.
  - Generated textures → 31 PNGs in `public/textures/generated/` (generators kept in `tools/textures/`). Synthesized audio → 38 AAC files in `public/audio/` (715 KB; exporter in `tools/dev/export_audio.mjs`; `?synthaudio` = live synth).
  - `data/assets.json`: manifest of 105 assets (path, source, author, license); start-screen credits generated from it.
  - Lead integration: removed hard-coded lamp/fire positions and the no-op beauty call from Game.ts.
  - Regression: meshes/holders/lights/enemies/credits as before, collisions, damage (40→20), full mission → MISSION COMPLETE, no errors, build OK.
  - Left in code for Phase 3: fx/Fleet runtime-drawn sprites (PNG copies exist), billboard animation, some feel/animation constants, classic-look surface rules.
  - **Next: Phase 2** (level shell rebuilt as a Blender scene) and **Phase 3** (core/engine split, fixed timestep, seeded RNG, unit tests).
- **User playtested Phase 1: "everything works perfectly".** Paused here (2026-11-10). Dev server stopped. Resume: `npm run dev`. Next: refactor Phase 2 (level shell as a Blender scene) + Phase 3 (core/engine split, fixed timestep, seeded RNG, unit tests).
### 2026-11-18
- **PORTABILITY REFACTOR, Phases 2 + 3 done** (two parallel agents + lead integration):
  - **Phase 2, level shell is a portable asset:** `tools/blender/build_level.py` builds `data/level/level1.json` → `tools/blender/src/level1.blend` → `public/models/level/level1.glb` (202 KB; 60 render blocks + 60 `COL_*` colliders; per-colour material slots; UV0 world-tiling + UV1 lightmap). `Level.ts` loads the GLB (fallback to code-built boxes on missing/stale file or `?codelevel`). All 64 world meshes match within 1 cm; screenshots pixel-identical. Docs: `docs/LEVEL_PIPELINE.md`.
  - **Phase 3, portable core + engine adapter:** `src/core/` (≈1,350 lines, no Babylon/DOM): fixed 60 Hz timestep, seeded RNG, typed event bus, ports (`IPhysics`, `InputSnapshot`, `LevelAnchors`), entities (player, weapons, enemies), mission, `GameWorld` with `stateHash()`. `src/engine/babylon/`: physics, input, camera rig, weapon/enemy/mission views, HUD, audio, fx, monster models. `src/game/Game.ts` is the composition root. **21 Vitest unit tests** (`npm test`, no browser). Docs: `ARCHITECTURE.md`, `docs/PORTING.md`.
  - Integration regression: tsc + 21 tests + build OK; level from GLB; collisions; mission pylons → cage → escape → won; no errors.
  - Needs a real-GPU check: the fixed-timestep sim caps catch-up at 5 steps/frame (fine at normal FPS).
- **Fix: player getting stuck in corners** (user report + screenshot; existed before the refactor). Two causes, found with a new seeded stress test `tools/dev/stuck_test.js` (random starts, walk/sprint into geometry, then try to escape in 8 directions):
  1. **Corner penetration:** the single combined move (with the ground-stick push) let the ellipsoid slip into convex box corners (plaza arcade, Charminar pillar). Fix in `BabylonPhysics.move`: horizontal and vertical moves in two passes, plus a **depenetration safety net** that pushes a body out of any solid level box to the nearest face.
  2. **Pockets:** props placed less than a player-width from walls (e.g. lamp posts 0.58 m off the lane wall) let you wedge in. Fix: `fillCollisionPockets()` (Props.ts) adds invisible fillers (23) across sub-player gaps, extended 0.3 m to avoid notches, tagged as world.
  - Result: baseline 3 stuck spots in 240 trials → **0 in 748 trials** (3 seeds). Regression: 21 unit tests, walls/autos/pillars block, jump 0.92 → 2.17 → lands, gun bob 0 flips, mission → won, no errors, build OK.
- **Polish round 1 integrated** (3 parallel agents):
  - **Baked lighting:** `tools/blender/bake_level.py` (Cycles GPU, 2K, about 100 s) → `public/textures/lightmaps/level1_lightmap.jpg` (1 MB) on the level's UV1; applied in `Level.applyLightmap()`; `?nolightmap` for A/B. Open: thin dark line at the lane start (z≈0), facades not lightmapped (no UV1), a 4K final bake, light rebalancing not reviewed.
  - **Menus/UI:** main menu (key art), loading screen with real progress + tips + briefing, pause (Esc), settings in localStorage (sensitivity, invert Y, FOV, zoom sens, head-bob, master/SFX/ambience volume, quality, FPS counter, hints), controls, credits, end screens with stats; HUD tweens, reload ring, low-ammo warning. Files: `src/ui/*`. Open: restart/quit reload the page; no key rebinding; head-bob setter should move into core.
  - **Asset compression:** load size 49 → 21 MB (meshopt + WebP via glTF-Transform, HDRI 1K); local meshopt decoder; originals in `art/_public_backup/` (git-ignored); `npm run assets:optimize`. Open: the JS bundle is 11 MB (Babylon imported in full).
  - Lead fix: in `?shot` test mode, pointer-lock refusal no longer pauses the sim (headless can't lock).
  - Regression: tsc, 21 tests, build; stuck test 0/150 (explore); mission → MISSION COMPLETE end screen; no errors.
- **Scope (ADS) view** (user: "bullets are going through the zoomed lens"): as zoom completes, the gun fades out and a DOM scope overlay fades in (round lens, dark tube, crosshair posts, red dot; HUD stays on top; crosshair hidden). While scoped: no muzzle-flash sprite, no smoke, tracers start 3 m out along the line of sight. Code: `WeaponView.updateScope()/buildScope()`.
- User noted no visible change in gun sound: expected, recorded audio is the next round (Freesound key set). The lightmap is subtle; a stronger bake + facade lightmapping are pending.
- **Bigger, climbable Charminar** (player feedback): scaled 1.4× (≈26.4 m incl. minarets, 42.6 m tall), roof terrace at 20.58 m with a 1 m parapet. Door and hollow shaft in the **south-east leg** (x 6.97, z 79.03) with a spiral stair (`charminar_stairs.glb`, 114 steps, `tools/blender/build_charminar_stairs.py`); collision is an invisible smooth helical ramp + ring wall + hatch rail; 2 torch lights. **Pylon 2 is on the roof**; the waypoint points to the stair door (`climbEntry` anchor) until you're up. Colliders, level GLB and lightmap rebuilt; overlapping plaza props moved.
  - Verified (lead): climb 8.6 s up / 7.9 s down (`tools/dev/climb_test.js`), stuck test 0/150, roof pylon destroyed by actually shooting it from the terrace, mission → won, no errors. Tip: call `__game.engine.stopRenderLoop()` in headless tests; the bigger scene renders very slowly in software Chrome.
  - Unreviewed by eye: the look of the door, shaft and roof (no screenshots taken). Owner to playtest.
- Also added: **rebindable controls incl. mouse side buttons** (Controls screen, `src/engine/babylon/bindings.ts`).
- **Roof guards + fall damage** (user playtest: "awesome"; asked for enemies on top and fall damage):
  - Spawns support an optional floor height `y` (`Spawn.y`, mission.json); enemies keep that height. Roof terrace guards: 1 Spitter (−5.5, 82) + 2 Crawlers (−4, 90) (4.5, 91) at y 20.58. Total initial enemies 14.
  - Fall damage in core (`player.json` `fallDamage`: none below 12 m/s impact ≈ 3 m, then 4.5 HP per extra m/s). The roof jump in game took 100 → 6 HP. New unit test (22 total).
  - Regression: mission → won, no errors.

