import { renderCredits } from "../credits";
import { getSettings, resetSettings, updateSettings, type QualityPreset, type Settings } from "./settings";

/**
 * Front-end screens: main menu, loading (real progress + tips + briefing), pause, settings, controls, credits and
 * end-of-mission. Pure DOM; talks to the game only through the small `MenuHost` interface (so it ports with the UI).
 */
export interface MenuHost {
  /** Asset jobs settled / total. */
  loadProgress(): { done: number; total: number };
  /** Resolves when models/textures are loaded. */
  ready: Promise<void>;
  /** Decoded audio files so far (audio starts loading after the first click). */
  audioLoaded(): number;
  unlockAudio(): void;
  /** Hide menus and enter play (needs a user gesture for pointer lock). */
  play(): void;
  quality(): QualityPreset;
}

export interface EndStats {
  won: boolean;
  time: number;
  kills: number;
  shots: number;
  hits: number;
  secrets: number;
  secretsTotal: number;
  health: number;
}

export const VERSION = "v0.5 · Level 1 prototype";

const TIPS = [
  "Crawlers flash orange just before they lunge: strafe sideways.",
  "Spitters' sacs swell before they fire. Shoot the glowing sac for double damage.",
  "The Warden's shield absorbs everything. Bait its red charge into a wall, then unload while it's stunned.",
  "The Trishul shreds anything up close. The Vajra is better at range.",
  "Right-click to aim: tighter spread, slower movement.",
  "Slide: crouch (C / Left Ctrl) while sprinting.",
  "One wall in the bazaar lane looks different from the rest…",
  "Follow the ◆ marker if you lose your way.",
  "Health packs glow green. Overcharge can push you past 100.",
];

const BRIEFING = "Hyderabad has fallen. Alien conversion pylons in the old city are turning captives into monsters. " +
  "Destroy the three pylons, free the captives held at the Charminar, and get back to the extraction point.";

const CONTROLS: [string, string][] = [
  ["W A S D  /  Arrow keys", "Move"], ["Mouse", "Look / aim"], ["Left click", "Fire"], ["Right click (hold)", "Zoom / aim down sights"],
  ["1  /  2  /  Wheel  /  Q", "Switch weapon (Q = last used)"], ["R", "Reload"], ["Shift", "Sprint"], ["Space", "Jump"],
  ["C  /  Left Ctrl", "Crouch · while sprinting: slide"], ["M", "Mute"], ["F", "FPS counter"], ["Esc", "Pause"],
];

const h = (html: string): HTMLElement => {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstElementChild as HTMLElement;
};
const fmtTime = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`;
const AUTOPLAY_KEY = "idam-jagath.autoplay";

export class Menus {
  private readonly overlay = document.getElementById("overlay") as HTMLElement;
  private readonly root = document.getElementById("menu-root") as HTMLElement;
  private readonly host: MenuHost;
  /** Where Back returns to from settings/controls/credits. */
  private backTo: () => void = () => this.showMain();
  private tipTimer = 0;
  private loadTimer = 0;
  private audioTotal = 0;
  private inGame = false;

  constructor(host: MenuHost) {
    this.host = host;
    (document.getElementById("build-tag") as HTMLElement).textContent = VERSION;
    // Slow parallax on the key art
    const bg = document.getElementById("menu-bg") as HTMLElement;
    window.addEventListener("mousemove", (e) => {
      if (this.overlay.classList.contains("hidden")) return;
      const x = (e.clientX / window.innerWidth - 0.5) * -14, y = (e.clientY / window.innerHeight - 0.5) * -10;
      bg.style.translate = `${x}px ${y}px`;
    });
    // Keyboard navigation: arrows move focus between buttons/controls of the active screen, Esc = back
    window.addEventListener("keydown", (e) => {
      if (this.overlay.classList.contains("hidden")) return;
      const items = [...this.root.querySelectorAll<HTMLElement>("[data-nav]")].filter((x) => !(x as HTMLButtonElement).disabled);
      if (!items.length) return;
      const i = items.indexOf(document.activeElement as HTMLElement);
      const isRange = (document.activeElement as HTMLInputElement | null)?.type === "range";
      if (e.code === "ArrowDown" || (e.code === "Tab" && !e.shiftKey)) { e.preventDefault(); items[(i + 1) % items.length].focus(); }
      else if (e.code === "ArrowUp" || (e.code === "Tab" && e.shiftKey)) { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
      else if (e.code === "Escape" && this.root.querySelector("[data-back]")) { e.preventDefault(); this.backTo(); }
      else if (!isRange && (e.code === "ArrowLeft" || e.code === "ArrowRight")) e.preventDefault();
    });
    // Track audio file count for the loading bar
    fetch(`${import.meta.env.BASE_URL}audio/manifest.json`).then((r) => (r.ok ? r.json() : null)).then((m) => {
      if (m) this.audioTotal = (m.sounds?.length ?? 0) + (m.ambience ? 1 : 0);
    }).catch(() => { /* synth fallback: no files to wait for */ });
    if (new URLSearchParams(location.search).has("synthaudio")) this.audioTotal = 0;
  }

  // ───────── flow ─────────

  /** True if the last session asked to restart straight into the mission (Retry / Restart). */
  static consumeAutoplay(): boolean {
    try {
      const v = sessionStorage.getItem(AUTOPLAY_KEY) === "1";
      sessionStorage.removeItem(AUTOPLAY_KEY);
      return v;
    } catch { return false; }
  }

  private static restart(autoplay: boolean): void {
    try { if (autoplay) sessionStorage.setItem(AUTOPLAY_KEY, "1"); } catch { /* reload into the menu instead */ }
    location.reload();
  }

  hide(): void {
    this.overlay.classList.add("hidden");
    window.clearInterval(this.tipTimer);
    window.clearInterval(this.loadTimer);
  }

  private mount(screen: HTMLElement, cls = ""): void {
    this.overlay.classList.remove("hidden");
    this.overlay.dataset.screen = cls;
    this.root.replaceChildren(screen);
    screen.classList.add("screen-in");
    const first = screen.querySelector<HTMLElement>("[data-autofocus]") ?? screen.querySelector<HTMLElement>("[data-nav]");
    first?.focus({ preventScroll: true });
  }

  showMain(): void {
    this.inGame = false;
    const s = h(`
      <section class="screen screen-main">
        <div class="title-block">
          <div class="kicker">Level 1 · Charminar, Hyderabad</div>
          <h1 class="game-title">IDAM JAGATH</h1>
          <div class="subtitle">The Invasion</div>
        </div>
        <nav class="menu-nav">
          <button class="menu-btn primary" data-nav data-autofocus id="start">Play</button>
          <button class="menu-btn" data-nav data-act="settings">Settings</button>
          <button class="menu-btn" data-nav data-act="controls">Controls</button>
          <button class="menu-btn" data-nav data-act="credits">Credits</button>
        </nav>
      </section>`);
    s.querySelector("#start")!.addEventListener("click", () => { this.host.unlockAudio(); this.showLoading(); });
    this.wireSub(s, () => this.showMain());
    this.mount(s, "main");
  }

  /** Loading: real progress (models + audio), rotating tips, the briefing; "Begin" appears when ready. */
  showLoading(waitAudio = true): void {
    const audioTotal = waitAudio ? this.audioTotal : 0; // audio only loads after a click; Retry skips waiting
    const s = h(`
      <section class="screen screen-loading">
        <div class="kicker">Mission briefing</div>
        <h2 class="screen-title">Liberate the Charminar</h2>
        <p class="briefing">${BRIEFING}</p>
        <div class="progress"><div class="progress-fill" id="load-fill"></div></div>
        <div class="progress-label"><span id="load-text">Loading assets…</span><span id="load-pct">0%</span></div>
        <p class="tip"><span class="tip-tag">TIP</span><span id="tip-text"></span></p>
        <button class="menu-btn primary hidden-btn" data-nav id="begin" disabled>Begin mission</button>
        <p class="hint-small">Click to capture the mouse · Esc to pause</p>
      </section>`);
    this.mount(s, "loading");
    const fill = s.querySelector("#load-fill") as HTMLElement, pct = s.querySelector("#load-pct") as HTMLElement;
    const text = s.querySelector("#load-text") as HTMLElement, begin = s.querySelector("#begin") as HTMLButtonElement;
    const tip = s.querySelector("#tip-text") as HTMLElement;
    let tipI = Math.floor(Math.random() * TIPS.length);
    const nextTip = () => { tip.textContent = TIPS[tipI++ % TIPS.length]; };
    nextTip();
    this.tipTimer = window.setInterval(nextTip, 4500);
    let modelsDone = false;
    this.host.ready.then(() => { modelsDone = true; });
    const t0 = performance.now();
    this.loadTimer = window.setInterval(() => {
      const m = this.host.loadProgress();
      const mFrac = modelsDone ? 1 : m.total ? m.done / m.total : 0;
      const aFrac = audioTotal ? Math.min(1, this.host.audioLoaded() / audioTotal) : 1;
      const audioGiveUp = performance.now() - t0 > 12000; // never block play on audio
      const frac = audioTotal ? 0.8 * mFrac + 0.2 * (audioGiveUp ? 1 : aFrac) : mFrac;
      fill.style.width = `${Math.round(frac * 100)}%`;
      pct.textContent = `${Math.round(frac * 100)}%`;
      text.textContent = mFrac < 1 ? `Loading models & textures… ${m.done}/${m.total}` : aFrac < 1 && !audioGiveUp ? "Loading audio…" : "Ready";
      if (modelsDone && (aFrac >= 1 || audioGiveUp) && begin.disabled) {
        begin.disabled = false;
        begin.classList.remove("hidden-btn");
        begin.focus();
      }
    }, 120);
    begin.addEventListener("click", () => { this.inGame = true; this.hide(); this.host.play(); });
  }

  showPause(note = ""): void {
    this.inGame = true;
    const s = h(`
      <section class="screen screen-pause">
        <h2 class="screen-title">Paused</h2>
        ${note ? `<p class="note">${note}</p>` : ""}
        <nav class="menu-nav">
          <button class="menu-btn primary" data-nav data-autofocus id="resume">Resume</button>
          <button class="menu-btn" data-nav data-act="settings">Settings</button>
          <button class="menu-btn" data-nav data-act="controls">Controls</button>
          <button class="menu-btn" data-nav id="restart">Restart mission</button>
          <button class="menu-btn subtle" data-nav id="quit">Quit to main menu</button>
        </nav>
      </section>`);
    s.querySelector("#resume")!.addEventListener("click", () => { this.hide(); this.host.play(); });
    s.querySelector("#restart")!.addEventListener("click", () => Menus.restart(true));
    s.querySelector("#quit")!.addEventListener("click", () => Menus.restart(false));
    this.wireSub(s, () => this.showPause());
    this.mount(s, "pause");
  }

  showEnd(st: EndStats): void {
    this.inGame = false;
    const acc = st.shots ? `${Math.round((100 * st.hits) / st.shots)}%` : "—";
    const s = h(`
      <section class="screen screen-end ${st.won ? "won" : "lost"}">
        <div class="kicker">${st.won ? "Charminar sector liberated" : "The occupation holds… for now"}</div>
        <h2 class="screen-title big" id="overlay-sub">${st.won ? "MISSION COMPLETE" : "MISSION FAILED"}</h2>
        <div class="stats" id="overlay-body">
          <div class="stat"><span class="v">${fmtTime(st.time)}</span><span class="k">Time</span></div>
          <div class="stat"><span class="v">${st.kills}</span><span class="k">Kills</span></div>
          <div class="stat"><span class="v">${acc}</span><span class="k">Accuracy</span></div>
          <div class="stat"><span class="v">${st.secrets}/${st.secretsTotal}</span><span class="k">Secrets</span></div>
          <div class="stat"><span class="v">${Math.max(0, Math.ceil(st.health))}</span><span class="k">Health</span></div>
        </div>
        <nav class="menu-nav row">
          <button class="menu-btn primary" data-nav data-autofocus id="retry">${st.won ? "Play again" : "Retry"}</button>
          <button class="menu-btn" data-nav id="tomenu">Main menu</button>
        </nav>
      </section>`);
    s.querySelector("#retry")!.addEventListener("click", () => Menus.restart(true));
    s.querySelector("#tomenu")!.addEventListener("click", () => Menus.restart(false));
    this.mount(s, "end");
  }

  // ───────── sub-screens (settings / controls / credits) ─────────

  private wireSub(screen: HTMLElement, back: () => void): void {
    screen.querySelectorAll<HTMLElement>("[data-act]").forEach((b) => b.addEventListener("click", () => {
      this.backTo = back;
      const act = b.dataset.act;
      if (act === "settings") this.showSettings();
      if (act === "controls") this.showControls();
      if (act === "credits") this.showCredits();
    }));
  }

  private backButton(): string {
    return `<button class="menu-btn subtle back" data-nav data-back id="back">← Back</button>`;
  }

  private showControls(): void {
    const s = h(`
      <section class="screen screen-controls">
        <h2 class="screen-title">Controls</h2>
        <div class="keymap">${CONTROLS.map(([k, a]) => `<div class="km-row"><span class="keys">${k.split("  /  ").map((x) => `<kbd>${x}</kbd>`).join('<i>/</i>')}</span><span class="act">${a}</span></div>`).join("")}</div>
        ${this.backButton()}
      </section>`);
    s.querySelector("#back")!.addEventListener("click", () => this.backTo());
    this.mount(s, "sub");
  }

  private showCredits(): void {
    const s = h(`
      <section class="screen screen-credits">
        <h2 class="screen-title">Credits</h2>
        <p class="credits-intro">A solo, AI-assisted game. Built with Babylon.js and Blender.<br/>
        Textures &amp; HDRI: Poly Haven (CC0). 3D models below are used under CC BY 4.0 (modified).</p>
        <ul id="credits-list" class="credits-list"></ul>
        ${this.backButton()}
      </section>`);
    renderCredits(s.querySelector("#credits-list") as HTMLElement);
    s.querySelector("#back")!.addEventListener("click", () => this.backTo());
    this.mount(s, "sub");
  }

  private showSettings(): void {
    const st = getSettings();
    const startQuality = this.host.quality();
    const slider = (key: keyof Settings, label: string, min: number, max: number, step: number, fmt: (v: number) => string) =>
      `<label class="set-row"><span class="set-label">${label}</span>
        <input data-nav type="range" data-key="${key}" min="${min}" max="${max}" step="${step}" value="${st[key] as number}">
        <span class="set-val" data-val="${key}">${fmt(st[key] as number)}</span></label>`;
    const toggle = (key: keyof Settings, label: string) =>
      `<label class="set-row"><span class="set-label">${label}</span>
        <input data-nav type="checkbox" class="toggle" data-key="${key}" ${st[key] ? "checked" : ""}><span class="set-val"></span></label>`;
    const pct = (v: number) => `${Math.round(v * 100)}%`;
    const mult = (v: number) => `${v.toFixed(2)}×`;
    const fmts: Partial<Record<keyof Settings, (v: number) => string>> = {
      sensitivity: mult, zoomSensitivity: mult, fov: (v) => `${Math.round(v)}°`, bob: pct, master: pct, sfx: pct, music: pct,
    };
    const s = h(`
      <section class="screen screen-settings">
        <h2 class="screen-title">Settings</h2>
        <div class="set-grid">
          <div class="set-group"><h3>Controls</h3>
            ${slider("sensitivity", "Mouse sensitivity", 0.2, 3, 0.05, mult)}
            ${slider("zoomSensitivity", "Zoom sensitivity", 0.3, 2, 0.05, mult)}
            ${toggle("invertY", "Invert Y axis")}
          </div>
          <div class="set-group"><h3>Video</h3>
            ${slider("fov", "Field of view", 55, 100, 1, (v) => `${Math.round(v)}°`)}
            ${slider("bob", "Head bob", 0, 1, 0.05, pct)}
            <label class="set-row"><span class="set-label">Graphics quality</span>
              <select data-nav data-key="quality">
                ${(["low", "medium", "high", "ultra"] as QualityPreset[]).map((q) => `<option value="${q}" ${st.quality === q ? "selected" : ""}>${q[0].toUpperCase() + q.slice(1)}</option>`).join("")}
              </select><span class="set-val"></span></label>
            <div class="set-note hidden" id="q-note">Quality applies after a reload${this.inGame ? " (restarts the mission)" : ""}.
              <button class="link-btn" data-nav id="q-apply">Reload now</button></div>
            ${toggle("showFps", "FPS counter (F)")}
          </div>
          <div class="set-group"><h3>Audio</h3>
            ${slider("master", "Master volume", 0, 1, 0.05, pct)}
            ${slider("sfx", "Effects volume", 0, 1, 0.05, pct)}
            ${slider("music", "Ambience volume", 0, 1, 0.05, pct)}
          </div>
          <div class="set-group"><h3>Gameplay</h3>
            ${toggle("showHints", "Show tutorial hints")}
          </div>
        </div>
        <div class="set-actions">
          ${this.backButton()}
          <button class="menu-btn subtle" data-nav id="reset">Reset to defaults</button>
        </div>
      </section>`);
    s.querySelectorAll<HTMLInputElement>("input[type=range]").forEach((inp) => inp.addEventListener("input", () => {
      const key = inp.dataset.key as keyof Settings;
      const v = Number(inp.value);
      updateSettings({ [key]: v } as Partial<Settings>);
      const out = s.querySelector(`[data-val="${key}"]`);
      if (out) out.textContent = (fmts[key] ?? String)(v) as string;
    }));
    s.querySelectorAll<HTMLInputElement>("input[type=checkbox]").forEach((inp) => inp.addEventListener("change", () => {
      updateSettings({ [inp.dataset.key as keyof Settings]: inp.checked } as Partial<Settings>);
    }));
    const sel = s.querySelector("select") as HTMLSelectElement, note = s.querySelector("#q-note") as HTMLElement;
    sel.addEventListener("change", () => {
      updateSettings({ quality: sel.value as QualityPreset });
      note.classList.toggle("hidden", sel.value === startQuality);
    });
    s.querySelector("#q-apply")!.addEventListener("click", () => Menus.restart(this.inGame));
    s.querySelector("#reset")!.addEventListener("click", () => { resetSettings(); this.showSettings(); });
    s.querySelector("#back")!.addEventListener("click", () => this.backTo());
    this.mount(s, "sub");
  }
}
