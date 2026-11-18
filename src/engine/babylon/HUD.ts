const $ = (id: string) => document.getElementById(id) as HTMLElement;

function el(css: string, parent: HTMLElement): HTMLElement {
  const d = document.createElement("div");
  d.style.cssText = css;
  parent.appendChild(d);
  return d;
}

/** Thin wrapper over the DOM HUD defined in index.html. */
export class HUD {
  private root = $("hud");
  private objective = $("objective");
  private health = $("health");
  private healthVal = $("health-val");
  private ammoVal = $("ammo-val");
  private toast = $("toast");
  private hit = $("hitmarker");
  private dmg = $("damage");
  private weapons = $("weapons");
  private waypoint = $("waypoint");
  private waypointDist = $("waypoint-dist");
  private toastTimer = 0;
  private hitTimer = 0;
  private dmgTimer = 0;
  // modern feedback elements (created here so index.html/style.css stay untouched)
  private arcs: HTMLElement[] = [];
  private arcI = 0;
  private lowHp: HTMLElement;
  private lastBeat = 0;
  /** Called on each low-health heartbeat (wired to audio). */
  onHeartbeat: () => void = () => {};

  constructor() {
    // Damage direction arcs around the crosshair
    for (let i = 0; i < 4; i++) {
      const a = el("position:absolute;left:50%;top:50%;width:220px;height:220px;margin:-110px 0 0 -110px;border-radius:50%;" +
        "border:6px solid transparent;border-top-color:rgba(255,40,30,.9);filter:drop-shadow(0 0 6px rgba(255,0,0,.8));" +
        "opacity:0;transition:opacity .6s ease-out;pointer-events:none;", this.root);
      this.arcs.push(a);
    }
    // Low-health pulse vignette
    this.lowHp = el("position:absolute;inset:0;pointer-events:none;opacity:0;" +
      "box-shadow:inset 0 0 220px 70px rgba(150,0,0,.85);", this.root);
  }

  /** Damage-direction arc toward the attacker (core "hurt" event). */
  onHurt(e: { amount: number; from?: { x: number; z: number }; playerPos: { x: number; z: number }; yaw: number }): void {
    if (!e.from) return;
    {
      const dx = e.from.x - e.playerPos.x, dz = e.from.z - e.playerPos.z;
      const ang = Math.atan2(dx, dz) - e.yaw; // 0 = in front, + = to the right
      const a = this.arcs[this.arcI++ % this.arcs.length];
      a.style.transition = "none";
      a.style.transform = `rotate(${ang}rad)`;
      a.style.opacity = String(Math.min(1, 0.45 + e.amount / 30));
      void a.offsetWidth; // restart the fade
      a.style.transition = "opacity .9s ease-out";
      a.style.opacity = "0";
    }
  }

  show(on: boolean): void {
    this.root.classList.toggle("hidden", !on);
  }

  setObjective(text: string): void {
    this.objective.textContent = text;
  }

  setHealth(hp: number): void {
    this.healthVal.textContent = String(Math.max(0, Math.ceil(hp)));
    this.health.classList.toggle("low", hp <= 30);
    // Low health: pulsing red vignette + heartbeat
    const now = performance.now() / 1000;
    if (hp > 0 && hp <= 30) {
      const beat = 0.85;
      this.lowHp.style.opacity = String(0.35 + 0.35 * Math.max(0, Math.sin(((now % beat) / beat) * Math.PI * 2)));
      if (now - this.lastBeat > beat) { this.lastBeat = now; this.onHeartbeat(); }
    } else {
      this.lowHp.style.opacity = "0";
    }
  }

  setAmmo(text: string): void {
    this.ammoVal.textContent = text;
  }

  setWeapon(active: number, names: string[]): void {
    this.weapons.innerHTML = names
      .map((n, i) => `<span class="${i === active ? "on" : ""}">${i + 1} ${n}</span>`)
      .join("");
  }

  /** Place the objective marker at screen position (x, y) in CSS pixels, or hide it with null. */
  setWaypoint(pos: { x: number; y: number } | null, metres = 0): void {
    if (!pos) { this.waypoint.style.display = "none"; return; }
    this.waypoint.style.display = "block";
    this.waypoint.style.left = `${pos.x}px`;
    this.waypoint.style.top = `${pos.y}px`;
    this.waypointDist.textContent = `${Math.round(metres)} m`;
  }

  message(text: string, seconds = 2.5): void {
    this.toast.textContent = text;
    this.toast.classList.add("on");
    window.clearTimeout(this.toastTimer);
    this.toastTimer = window.setTimeout(() => this.toast.classList.remove("on"), seconds * 1000);
  }

  /** Hit marker; `kill` shows a bigger red X that lingers. */
  hitMarker(kill = false): void {
    this.hit.classList.add("on");
    this.hit.style.borderColor = kill ? "#ff2a2a" : "";
    this.hit.style.width = this.hit.style.height = kill ? "34px" : "";
    this.hit.style.boxShadow = kill ? "0 0 10px #ff2a2a" : "";
    window.clearTimeout(this.hitTimer);
    this.hitTimer = window.setTimeout(() => this.hit.classList.remove("on"), kill ? 260 : 70);
  }

  damageFlash(): void {
    this.dmg.classList.add("on");
    window.clearTimeout(this.dmgTimer);
    this.dmgTimer = window.setTimeout(() => this.dmg.classList.remove("on"), 90);
  }
}
