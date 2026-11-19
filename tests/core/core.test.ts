import { describe, expect, it } from "vitest";
import { Vec3 } from "../../src/core/math";
import { FixedStep } from "../../src/core/time";
import { Rng } from "../../src/core/rng";
import { Crawler, Warden } from "../../src/core/entities/enemies";
import { GAMEPLAY } from "../../src/data/gameplay";
import { LEVEL, input, makeWorld, run } from "./fakes";

const DT = 1 / 60;

describe("FixedStep", () => {
  it("runs whole steps and returns the interpolation remainder", () => {
    const c = new FixedStep(DT);
    let n = 0;
    const alpha = c.advance(0.04, () => n++);
    expect(n).toBe(2);
    expect(alpha).toBeCloseTo(0.4, 5);
  });
  it("accumulates small frames", () => {
    const c = new FixedStep(DT);
    let n = 0;
    c.advance(0.01, () => n++);
    expect(n).toBe(0);
    c.advance(0.01, () => n++);
    expect(n).toBe(1);
  });
  it("caps catch-up steps after a stall", () => {
    const c = new FixedStep(DT, 5);
    let n = 0;
    c.advance(1.0, () => n++);
    expect(n).toBe(5);
    n = 0;
    c.advance(0, () => n++);
    expect(n).toBe(0); // backlog dropped
  });
});

describe("Rng", () => {
  it("is reproducible per seed", () => {
    const a = new Rng(42), b = new Rng(42), c = new Rng(43);
    const sa = [a.next(), a.next(), a.next()], sb = [b.next(), b.next(), b.next()];
    expect(sa).toEqual(sb);
    expect(c.next()).not.toBe(sa[0]);
    for (const v of sa) { expect(v).toBeGreaterThanOrEqual(0); expect(v).toBeLessThan(1); }
  });
});

describe("determinism", () => {
  const script = (i: number) => input({
    forward: i < 240 || (i > 400 && i < 520),
    right: i > 100 && i < 160,
    sprint: i > 300 && i < 360,
    fire: i > 180 && i < 260 || i > 600,
    lookDX: i % 50 < 10 ? 4 : 0,
    lookDY: i % 70 < 5 ? -2 : 0,
    jumpPressed: i === 130,
    crouchPressed: i === 340,
  });
  it("same seed + same inputs ⇒ identical state", () => {
    const a = makeWorld({ seed: 7 }).world, b = makeWorld({ seed: 7 }).world;
    for (let i = 0; i < 720; i++) {
      a.step(DT, script(i));
      b.step(DT, script(i));
      if (i % 120 === 0) expect(a.stateHash()).toBe(b.stateHash());
    }
    expect(a.stateHash()).toBe(b.stateHash());
    expect(a.enemies.length).toBeGreaterThan(0);
  });
  it("different seed ⇒ different game", () => {
    const a = makeWorld({ seed: 7 }).world, b = makeWorld({ seed: 8 }).world;
    for (let i = 0; i < 720; i++) { a.step(DT, script(i)); b.step(DT, script(i)); }
    expect(a.stateHash()).not.toBe(b.stateHash());
  });
});

describe("player movement", () => {
  it("stays grounded every step while walking (no grounded flicker)", () => {
    const { world } = makeWorld({ explore: true });
    run(world, 0.5); // land
    const flags: boolean[] = [];
    run(world, 2, (i) => { if (i) flags.push(world.player.grounded); return input({ forward: true }); });
    expect(flags.every(Boolean)).toBe(true);
    expect(world.player.speed).toBeCloseTo(GAMEPLAY.player.walkSpeed, 1);
  });
  it("jumps, lands and emits a landing event", () => {
    const { world } = makeWorld({ explore: true });
    run(world, 0.5);
    let landed = 0;
    world.events.on("land", () => landed++);
    world.step(DT, input({ jumpPressed: true }));
    run(world, 0.2);
    expect(world.player.grounded).toBe(false);
    expect(world.player.pos.y).toBeGreaterThan(1.5);
    run(world, 0.8);
    expect(world.player.grounded).toBe(true);
    expect(landed).toBe(1);
  });
  it("coyote time keeps the player grounded through brief missed contacts", () => {
    const { world, physics } = makeWorld({ explore: true });
    run(world, 0.5);
    physics.noGround = true;
    run(world, 3 / 60);
    expect(world.player.grounded).toBe(true); // within 0.12 s grace
    run(world, 10 / 60);
    expect(world.player.grounded).toBe(false);
    physics.noGround = false;
  });
  it("takes no damage from a jump but hurts on a long fall (roof ≈ 21 m)", () => {
    const { world } = makeWorld({ explore: true });
    run(world, 0.5);
    const hp = world.player.health;
    world.step(DT, input({ jumpPressed: true }));
    run(world, 1.2);
    expect(world.player.health).toBe(hp); // normal jump: no fall damage
    world.player.pos.y += 21;             // drop from the Charminar roof height
    run(world, 2.5);
    const lost = hp - world.player.health;
    expect(lost).toBeGreaterThan(60);
    expect(lost).toBeLessThan(100);       // painful, but survivable at full health
  });
});

describe("guard posts", () => {
  it("an awake roof guard holds its post while the player is on another floor, and engages on the same floor", () => {
    const { world } = makeWorld({ explore: true });
    run(world, 0.5);
    const p = world.player.pos;
    const post = { x: p.x + 6, z: p.z };
    const g = world.spawn({ type: "crawler", at: [post.x, post.z], y: 6, guard: true }, true);
    run(world, 2, () => input({}));
    expect(Math.hypot(g.pos.x - post.x, g.pos.z - post.z)).toBeLessThan(0.7); // stayed put, didn't come overhead
    const c = world.spawn({ type: "crawler", at: [p.x + 6, p.z + 2], guard: true }, true); // same floor as the player
    const start = Math.hypot(c.pos.x - p.x, c.pos.z - p.z);
    run(world, 0.5, () => input({}));
    expect(Math.hypot(c.pos.x - p.x, c.pos.z - p.z)).toBeLessThan(start - 1); // chases
  });
});

describe("melee reach", () => {
  it("a crawler on a higher floor right above the player cannot bite", () => {
    const { world } = makeWorld({ explore: true });
    run(world, 0.5);
    const p = world.player.pos;
    const c = world.spawn({ type: "crawler", at: [p.x + 0.5, p.z], y: 6 }, true); // 6 m above, horizontally adjacent
    const hp = world.player.health;
    run(world, 3, () => input({}));
    expect(c.pos.y).toBeGreaterThan(5);
    expect(world.player.health).toBe(hp);
  });
});

describe("weapons", () => {
  /** A frozen crawler straight ahead of the player (zoo freezes enemies). */
  function range(dist: number) {
    const { world } = makeWorld({ zoo: true });
    world.enemies.length = 0; // drop the level's initial spawns
    const p = world.player.pos;
    const c = world.spawn({ type: "crawler", at: [p.x, p.z + dist] }, false) as Crawler;
    run(world, 0.3); // settle on the ground
    world.player.pitch = Math.atan2(world.player.eye.y - c.pos.y, dist); // aim at the crawler's body centre
    return { world, c };
  }

  it("rifle: one hit takes a Crawler 40 → 20, uses one round", () => {
    const { world, c } = range(6);
    let shots = 0;
    world.events.on("shot", () => shots++);
    world.step(DT, input({ fire: true }));
    expect(shots).toBe(1);
    expect(c.hp).toBe(20);
    expect(world.arsenal.gun.ammo).toBe(GAMEPLAY.weapons[0].mag - 1);
  });

  it("rifle: respects fire interval and kills on the second hit", () => {
    const { world, c } = range(6);
    let killed = false;
    world.events.on("shotResult", (e) => { if (e.killed) killed = true; });
    world.step(DT, input({ fire: true }));
    world.step(DT, input({ fire: true })); // still cooling down
    expect(c.hp).toBe(20);
    run(world, GAMEPLAY.weapons[0].fireInterval);
    world.step(DT, input({ fire: true }));
    expect(c.alive).toBe(false);
    expect(killed).toBe(true);
    expect(world.kills).toBe(1);
  });

  it("reload refills the magazine after reloadTime; auto-reloads when empty", () => {
    const { world } = range(6);
    const g = world.arsenal.gun;
    g.ammo = 5;
    world.step(DT, input({ reloadPressed: true }));
    expect(g.reloading).toBeGreaterThan(0);
    run(world, g.spec.reloadTime + 0.05);
    expect(g.ammo).toBe(g.spec.mag);
    g.ammo = 0;
    world.step(DT, input());
    expect(g.reloading).toBeGreaterThan(0);
  });

  it("shotgun: switch takes SWITCH_TIME, 9 pellets kill a close Crawler, uses one shell", () => {
    const { world, c } = range(3);
    world.step(DT, input({ weapon2Pressed: true }));
    run(world, 0.45);
    expect(world.arsenal.current).toBe(1);
    world.step(DT, input({ fire: true }));
    expect(c.alive).toBe(false);
    expect(world.arsenal.gun.ammo).toBe(GAMEPLAY.weapons[1].mag - 1);
  });

  it("kill events carry the shot direction, weapon slot and weak-spot flag (presentation only, hash unchanged)", () => {
    const { world, c } = range(3);
    const kills: { dir: Vec3 | null; weapon: number; weak: boolean; hit: Vec3 }[] = [];
    world.events.on("enemyKilled", (e) => kills.push(e));
    world.step(DT, input({ weapon2Pressed: true }));
    run(world, 0.45);
    world.step(DT, input({ fire: true }));
    expect(c.alive).toBe(false);
    expect(kills.length).toBe(1);
    const k = kills[0];
    expect(k.weapon).toBe(1);
    expect(k.weak).toBe(false);
    expect(k.dir).not.toBeNull();
    expect(k.dir!.z).toBeGreaterThan(0.9); // the crawler is straight ahead (+z)
    expect(Math.abs(k.hit.z - c.pos.z)).toBeLessThan(1);
    // Weak-spot hit (part multiplier > 1) is flagged; scripted damage without a source has no direction
    const { world: w2, c: c2 } = range(6);
    const hurt: { weak: boolean; dir: Vec3 | null; weapon: number }[] = [];
    w2.events.on("enemyHurt", (e) => hurt.push(e));
    w2.damageTarget({ kind: "enemy", id: c2.id, mul: 1.5 }, 5, c2.pos, { dir: new Vec3(0, 0, 1), weapon: 0 });
    w2.damageTarget({ kind: "enemy", id: c2.id, mul: 1 }, 5, c2.pos);
    expect(hurt.map((h) => h.weak)).toEqual([true, false]);
    expect(hurt[1].dir).toBeNull();
    expect(hurt[1].weapon).toBe(-1);
    // The extra event data doesn't touch simulation state: same hash with and without a source
    const { world: a, c: ca } = range(6), { world: b, c: cb } = range(6);
    a.damageTarget({ kind: "enemy", id: ca.id, mul: 1 }, 50, ca.pos, { dir: new Vec3(0, 0, 1), weapon: 1 });
    b.damageTarget({ kind: "enemy", id: cb.id, mul: 1 }, 50, cb.pos);
    run(a, 0.5); run(b, 0.5);
    expect(a.stateHash()).toBe(b.stateHash());
  });

  it("can't fire while sprinting", () => {
    const { world, c } = range(8);
    run(world, 0.4, input({ forward: true, sprint: true }));
    world.step(DT, input({ forward: true, sprint: true, fire: true }));
    expect(c.hp).toBe(GAMEPLAY.enemies.crawler.hp);
  });
});

describe("enemies", () => {
  it("Crawler telegraphs (windup + tell) for exactly lunge.windup before lunging", () => {
    const { world } = makeWorld({ explore: true });
    run(world, 0.3);
    const p = world.player.pos;
    const c = world.spawn({ type: "crawler", at: [p.x, p.z + 6] }, true) as Crawler;
    Object.assign(c, { lungeCd: 0 });
    world.step(DT, input());
    expect(c.state).toBe("windup");
    expect(c.tell).toBe("lunge");
    let steps = 1;
    while (c.state === "windup" && steps < 200) { world.step(DT, input()); steps++; }
    expect(c.state).toBe("lunge");
    expect(steps / 60).toBeCloseTo(GAMEPLAY.enemies.crawler.lunge.windup, 1);
  });

  it("Warden is stunned (shield down, double damage) when its charge hits a wall", () => {
    const { world, physics } = makeWorld({ explore: true });
    run(world, 0.3);
    world.player.teleport(0, 0.9, 12);
    physics.walls.push({ min: new Vec3(-5, 0, 3), max: new Vec3(5, 4, 4) });
    const w = world.spawn({ type: "warden", at: [0, 0] }, true) as Warden;
    w.pos.y = GAMEPLAY.enemies.warden.halfHeight;
    w.state = "windup";
    w.t = 0.001;
    w.yaw = 0;
    const shieldEvents: boolean[] = [];
    world.events.on("shield", (e) => shieldEvents.push(e.up));
    run(world, 0.2);
    expect(w.state).toBe("stunned");
    expect(w.shieldUp).toBe(false);
    expect(w.tell).toBe("stunned");
    expect(shieldEvents).toEqual([false]);
    const hp = w.hp;
    w.takeDamage(10, w.pos);
    expect(w.hp).toBe(hp - 10 * GAMEPLAY.enemies.warden.stun.damageMultiplier);
    run(world, GAMEPLAY.enemies.warden.stun.duration + 0.1);
    expect(w.shieldUp).toBe(true);
  });
});

describe("mission", () => {
  it("pylons → cage → escape → extraction → won", () => {
    const { world } = makeWorld({ zoo: true });
    const phases: string[] = [];
    let ended: string | null = null;
    world.events.on("phase", (e) => phases.push(e.phase));
    world.events.on("missionEnd", (e) => { ended = e.title; });
    expect(world.enemies.length).toBe(GAMEPLAY.mission.initialSpawns.length);
    for (const p of world.mission.pylons) world.damageTarget({ kind: "pylon", id: p.index, mul: 1 }, 999, p.pos);
    expect(world.phase).toBe("cage");
    world.player.teleport(0, 0.9, 103);
    world.step(DT, input());
    expect(world.phase).toBe("escape");
    expect(world.enemies.length).toBe(GAMEPLAY.mission.initialSpawns.length + GAMEPLAY.mission.escapeWave.spawns.length);
    world.player.teleport(0, 0.9, -9);
    world.step(DT, input());
    expect(world.phase).toBe("won");
    expect(ended).toBe("MISSION COMPLETE");
    expect(phases).toEqual(["cage", "escape", "won"]);
  });

  it("entering the plaza triggers the ambush (Warden + crawlers)", () => {
    const { world } = makeWorld();
    const before = world.enemies.length;
    let ambush = 0;
    world.events.on("ambush", () => ambush++);
    world.player.teleport(0, 0.9, LEVEL.plazaEntryZ + 1);
    world.step(DT, input());
    expect(ambush).toBe(1);
    expect(world.enemies.length).toBe(before + GAMEPLAY.mission.ambush.spawns.length);
    expect(world.enemies.some((e) => e.type === "warden")).toBe(true);
  });

  it("death ends the mission", () => {
    const { world } = makeWorld({ explore: true });
    let result: string | null = null;
    world.events.on("missionEnd", (e) => { result = e.result; });
    world.player.health = 0;
    world.step(DT, input());
    expect(world.phase).toBe("dead");
    expect(result).toBe("dead");
  });

  it("health pickups heal up to max; the secret overcharges up to its cap", () => {
    const { world } = makeWorld({ explore: true });
    const PK = GAMEPLAY.mission.pickups;
    world.player.health = 50;
    const h = LEVEL.healthSpots[0];
    world.player.teleport(h.x, 0.9, h.z);
    world.step(DT, input());
    expect(world.player.health).toBe(50 + PK.health.amount);
    world.player.health = 150;
    world.player.teleport(LEVEL.secretPickup.x, 0.9, LEVEL.secretPickup.z);
    world.step(DT, input());
    expect(world.player.health).toBe(PK.secret.cap);
    expect(world.mission.secrets).toBe(1);
  });

  it("the secret wall breaks after its hp of damage", () => {
    const { world } = makeWorld({ explore: true });
    let broken = 0;
    world.events.on("secretWallBroken", () => broken++);
    world.damageTarget({ kind: "secretWall", id: 0, mul: 1 }, GAMEPLAY.mission.secretWall.hp - 1, new Vec3());
    expect(broken).toBe(0);
    world.damageTarget({ kind: "secretWall", id: 0, mul: 1 }, 1, new Vec3());
    expect(broken).toBe(1);
  });
});
