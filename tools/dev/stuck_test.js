// Stuck-in-geometry stress test (run in the page via tools/dev/cdp.mjs). Seeded, so results are comparable run to run.
// For many random starts in walkable areas: walk/sprint toward a random direction for 1.5 s (into walls/props/corners),
// then try to walk out in 8 directions. A spot is "stuck" if no direction moves the player >= 0.5 m in 0.4 s.
window.stuckTest = (trials = 300, seed = 7) => {
  const g = window.__game, P = g.player, K = g.input.keys;
  let s = seed >>> 0; const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
  const areas = [[-3.5, 3.5, 0.5, 59.5], [-25.5, 25.5, 60.5, 111.5], [-10.5, 10.5, -15.5, -0.5], [-23.5, -4.5, 26.5, 31.5], [-35.5, -24.5, 18.5, 39.5]];
  const walk = (deg, sec, sprint) => { P.yaw = deg * Math.PI / 180; K.add("KeyW"); if (sprint) K.add("ShiftLeft"); g.simulate(sec); K.delete("KeyW"); K.delete("ShiftLeft"); };
  const escape = () => {
    const ex = P.body.position.x, ey = P.body.position.y, ez = P.body.position.z; let best = 0;
    for (const d of [0, 45, 90, 135, 180, 225, 270, 315]) {
      P.body.position.set(ex, ey, ez); walk(d, 0.4, false);
      best = Math.max(best, Math.hypot(P.body.position.x - ex, P.body.position.z - ez));
    }
    P.body.position.set(ex, ey, ez); return best;
  };
  const stuck = []; let valid = 0;
  for (let i = 0; i < trials; i++) {
    const a = areas[Math.floor(rnd() * areas.length)];
    const x = a[0] + rnd() * (a[1] - a[0]), z = a[2] + rnd() * (a[3] - a[2]);
    P.body.position.set(x, 1, z); g.simulate(0.1);
    if (escape() < 0.5) continue; // start was inside something: not a valid trial
    valid++;
    walk(rnd() * 360, 1.5, rnd() < 0.5);
    const b = escape();
    if (b < 0.5) stuck.push([+P.body.position.x.toFixed(2), +P.body.position.z.toFixed(2), +b.toFixed(2)]);
  }
  return { valid, stuck: stuck.length, where: stuck.slice(0, 30) };
};
