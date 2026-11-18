// Charminar climb test: walk in through the SW-leg door, follow the spiral stair (steering along its tangent),
// reach the roof terrace, walk to the roof pylon, then walk back down. Returns the trace summary.
window.climbTest = () => {
  const g = window.__game, P = g.player, K = g.input.keys;
  const CX = 6.97, CZ = 79.03, ROOF = 20.58; // SE leg; Blender x = -game x
  const yawTo = (dx, dz) => Math.atan2(dx, dz);
  const out = {};
  P.body.position.set(6.97, 1, 74.6); P.yaw = 0; g.simulate(0.1);
  K.add("KeyW"); g.simulate(1.2);
  out.inside = [+P.body.position.x.toFixed(2), +P.body.position.y.toFixed(2), +P.body.position.z.toFixed(2)];
  let maxY = 0, t = 0;
  for (; t < 30 && P.body.position.y < ROOF + 0.3; t += 1 / 60) {
    const bx = -(P.body.position.x - CX), by = (86 - P.body.position.z) - (86 - CZ); // Blender-space offsets
    const a = Math.atan2(by, bx), r = Math.hypot(bx, by);
    // tangent (counter-clockwise in Blender top view) + pull toward the walking radius 1.05
    let tx = -Math.sin(a), ty = Math.cos(a);
    const pull = (1.05 - r) * 0.8; tx += Math.cos(a) * pull; ty += Math.sin(a) * pull;
    P.yaw = yawTo(-tx, -ty); // Blender +x = game -x, Blender +y = game -z
    g.simulate(1 / 60); maxY = Math.max(maxY, P.body.position.y);
  }
  out.climbSeconds = +t.toFixed(1); out.maxY = +maxY.toFixed(2);
  out.top = [+P.body.position.x.toFixed(2), +P.body.position.y.toFixed(2), +P.body.position.z.toFixed(2)];
  // keep walking forward out of the hatch, then head to the roof centre
  g.simulate(0.6);
  for (let i = 0; i < 300; i++) {
    const dx = 0 - P.body.position.x, dz = 84 - P.body.position.z;
    if (Math.hypot(dx, dz) < 0.8) break;
    P.yaw = yawTo(dx, dz); g.simulate(1 / 60);
  }
  out.atRoofCentre = [+P.body.position.x.toFixed(2), +P.body.position.y.toFixed(2), +P.body.position.z.toFixed(2)];
  K.delete("KeyW");
  return out;
};
// Descent: from the roof centre walk back to the hatch exit, follow the spiral down (clockwise), out of the door.
window.descendTest = () => {
  const g = window.__game, P = g.player, K = g.input.keys;
  const CX = 6.97, CZ = 79.03, yawTo = (dx, dz) => Math.atan2(dx, dz), out = {};
  const endA = (90 + 7.483 * 360) * Math.PI / 180;               // ramp top angle (Blender space)
  const bpt = (r, a) => [CX - r * Math.cos(a), CZ - r * Math.sin(a)]; // Blender (x, y) offset -> game (x, z)
  K.add("KeyW");
  const goto = (x, z, maxS) => { for (let t = 0; t < maxS; t += 1 / 60) { const dx = x - P.body.position.x, dz = z - P.body.position.z; if (Math.hypot(dx, dz) < 0.35) return true; P.yaw = yawTo(dx, dz); g.simulate(1 / 60); } return false; };
  const [ax, az] = bpt(2.8, endA + 0.5); out.toGap = goto(ax, az, 8);
  const [bx, bz] = bpt(1.05, endA - 0.15); out.toTop = goto(bx, bz, 4);
  let t = 0;
  for (; t < 30 && P.body.position.y > 1.3; t += 1 / 60) {
    const rx = -(P.body.position.x - CX), ry = (86 - P.body.position.z) - (86 - CZ);
    const a = Math.atan2(ry, rx), r = Math.hypot(rx, ry);
    let tx = Math.sin(a), ty = -Math.cos(a);                       // clockwise = downhill
    const pull = (1.05 - r) * 0.8; tx += Math.cos(a) * pull; ty += Math.sin(a) * pull;
    P.yaw = yawTo(-tx, -ty); g.simulate(1 / 60);
  }
  out.downSeconds = +t.toFixed(1); out.bottomY = +P.body.position.y.toFixed(2);
  out.outDoor = goto(6.97, 77.6, 4) && goto(6.97, 73.5, 4);
  out.final = [+P.body.position.x.toFixed(2), +P.body.position.y.toFixed(2), +P.body.position.z.toFixed(2)];
  K.delete("KeyW");
  return out;
};
