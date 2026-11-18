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
  /** Called when the objective text changes (wired to a short UI sound cue). */
  onObjectiveCue: () => void = () => {};
  // Polish: tweened numbers, reload ring, low-ammo warning
  private hpShown = 100;
  private hpTarget = 100;
  private ammoShown = -1;
  private ammoTarget = -1;
  private ammoText = "";
  private ring = document.getElementById("reload-ring-fill") as SVGCircleElement | null;
  private ringWrap = document.getElementById("reload-ring");
  private ammoWarn = document.getElementById("ammo-warn");
  private ammoPanel = $("ammo");
  private lastTick = performance.now();

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
    const tick = () => { this.tickNumbers(); requestAnimationFrame(tick); };
    requestAnimationFrame(tick);
  }

  /** Smoothly count displayed numbers toward their targets (drops are fast, refills/heals count up). */
  private tickNumbers(): void {
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.lastTick) / 1000);
    this.lastTick = now;
    if (Math.abs(this.hpShown - this.hpTarget) > 0.01) {
      const rate = this.hpTarget < this.hpShown ? 14 : 5; // damage reads instantly-ish, healing ticks up
      this.hpShown += (this.hpTarget - this.hpShown) * Math.min(1, dt * rate);
      if (Math.abs(this.hpShown - this.hpTarget) < 0.5) this.hpShown = this.hpTarget;
      this.healthVal.textContent = String(Math.max(0, Math.ceil(this.hpShown)));
    }
    if (this.ammoTarget >= 0 && this.ammoShown !== this.ammoTarget) {
      if (this.ammoTarget < this.ammoShown || this.ammoShown < 0) this.ammoShown = this.ammoTarget; // shots: instant
      else this.ammoShown = Math.min(this.ammoTarget, this.ammoShown + Math.max(1, Math.round(dt * 60))); // refill: count up
      this.ammoVal.textContent = String(this.ammoShown);
    }
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
    if (text === this.objective.textContent) return;
    const changed = !!this.objective.textContent;
    this.objective.textContent = text;
    if (changed) {
      this.objective.classList.remove("objective-in");
      void this.objective.offsetWidth; // restart the slide-in animation
      this.objective.classList.add("objective-in");
      this.onObjectiveCue();
    }
  }

  setHealth(hp: number): void {
    this.hpTarget = Math.max(0, hp); // displayed value tweens toward this (tickNumbers)
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
    this.ammoText = text;
    const n = Number(text);
    if (text !== "" && Number.isFinite(n)) {
      this.ammoTarget = n;
      if (this.ammoShown < 0) { this.ammoShown = n; this.ammoVal.textContent = text; }
    } else {
      this.ammoTarget = -1;
      this.ammoShown = -1;
      this.ammoVal.textContent = text;
    }
  }

  /** Reload progress ring around the crosshair (0..1) and low-ammo warning. `reload` = null when not reloading. */
  setWeaponState(ammo: number, mag: number, reload: number | null): void {
    if (this.ring && this.ringWrap) {
      const on = reload !== null;
      this.ringWrap.classList.toggle("on", on);
      const C = 2 * Math.PI * 16; // r = 16 in the SVG
      this.ring.style.strokeDasharray = String(C);
      this.ring.style.strokeDashoffset = String(C * (1 - (on ? reload! : 0)));
    }
    const low = reload === null && mag > 1 && ammo <= Math.max(1, Math.ceil(mag * 0.25));
    this.ammoPanel.classList.toggle("low", low);
    this.ammoWarn?.classList.toggle("on", low);
    void this.ammoText;
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
