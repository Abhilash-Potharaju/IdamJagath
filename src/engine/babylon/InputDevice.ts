import type { InputSnapshot } from "../../core/ports";
import { getBindings, type Action } from "./bindings";

/**
 * Keyboard + mouse (pointer lock) → core InputSnapshot actions. Two clocks:
 *  - per simulation step: `consume()` returns held state + edges/deltas accumulated since the previous step;
 *  - per render frame: `frameDX/frameDY` (weapon sway) and `framePressed()` (UI keys like M), cleared by endFrame().
 * Key bindings live here, so a port only remaps devices; the core sees actions.
 */
export class InputDevice {
  readonly keys = new Set<string>();
  mouseDown = false;
  /** Right mouse button held (zoom / aim down sights). */
  aimDown = false;
  /** Look deltas accumulated since the last simulation step. */
  mouseDX = 0;
  mouseDY = 0;
  /** Look deltas accumulated since the last render frame. */
  frameDX = 0;
  frameDY = 0;
  locked = false;
  /** Mouse-wheel notches since the last step: +1 = scrolled down. */
  wheel = 0;
  private stepPressed = new Set<string>();
  private framePressedSet = new Set<string>();
  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    window.addEventListener("keydown", (e) => {
      if (!this.keys.has(e.code)) { this.stepPressed.add(e.code); this.framePressedSet.add(e.code); }
      this.keys.add(e.code);
      // Stop Space/arrow keys from scrolling the page
      if (e.code === "Space" || e.code.startsWith("Arrow")) e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.keys.delete(e.code));
    // Mouse buttons are tracked like keys ("Mouse0".."Mouse4") so any action can be bound to any button.
    window.addEventListener("mousedown", (e) => {
      if (!this.locked) return;
      const code = `Mouse${e.button}`;
      if (!this.keys.has(code)) { this.stepPressed.add(code); this.framePressedSet.add(code); }
      this.keys.add(code);
      if (e.button >= 3) e.preventDefault(); // side buttons: don't navigate back/forward
    });
    window.addEventListener("mouseup", (e) => {
      this.keys.delete(`Mouse${e.button}`);
      if (e.button >= 3) e.preventDefault();
    });
    // Chrome navigates on the side buttons' auxclick/mouseup; block it while playing
    window.addEventListener("auxclick", (e) => { if (e.button >= 3) e.preventDefault(); });
    window.addEventListener("wheel", (e) => {
      if (this.locked && e.deltaY !== 0) this.wheel += Math.sign(e.deltaY);
    }, { passive: true });
    // Right click is used for zoom, so suppress the browser's context menu
    window.addEventListener("contextmenu", (e) => e.preventDefault());
    window.addEventListener("mousemove", (e) => {
      if (!this.locked) return;
      this.mouseDX += e.movementX;
      this.mouseDY += e.movementY;
      this.frameDX += e.movementX;
      this.frameDY += e.movementY;
    });
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.mouseDown = false; this.aimDown = false; this.keys.clear(); }
    });
  }

  lock(): void {
    // Newer browsers return a promise that rejects when lock is refused (e.g. re-locking right after Esc).
    // The "pointerlockerror" event still fires, and the UI handles it, so just swallow the rejection.
    const p = this.canvas.requestPointerLock() as unknown as Promise<void> | undefined;
    if (p && typeof p.catch === "function") p.catch(() => { /* handled via pointerlockerror */ });
  }

  /** Snapshot for one simulation step; resets the per-step edges and deltas. */
  /** Is an action held (any of its bindings)? */
  held(a: Action): boolean {
    const [b0, b1] = getBindings()[a];
    return (!!b0 && this.keys.has(b0)) || (!!b1 && this.keys.has(b1));
  }

  private pressedIn(set: Set<string>, a: Action): boolean {
    const [b0, b1] = getBindings()[a];
    return (!!b0 && set.has(b0)) || (!!b1 && set.has(b1));
  }

  /** Did an action go down since the last render frame (UI-level actions such as mute)? */
  frameAction(a: Action): boolean { return this.pressedIn(this.framePressedSet, a); }

  consume(): InputSnapshot {
    const p = this.stepPressed;
    // mouseDown/aimDown remain as test/automation overrides (scripted tests set them directly)
    const snap: InputSnapshot = {
      forward: this.held("forward"),
      back: this.held("back"),
      left: this.held("left"),
      right: this.held("right"),
      sprint: this.held("sprint"),
      crouch: this.held("crouch"),
      crouchPressed: this.pressedIn(p, "crouch"),
      jumpPressed: this.pressedIn(p, "jump"),
      fire: this.mouseDown || this.held("fire"),
      aim: this.aimDown || this.held("aim"),
      reloadPressed: this.pressedIn(p, "reload"),
      weapon1Pressed: this.pressedIn(p, "weapon1"),
      weapon2Pressed: this.pressedIn(p, "weapon2"),
      weaponLastPressed: this.pressedIn(p, "weaponLast"),
      wheel: this.wheel,
      lookDX: this.mouseDX,
      lookDY: this.mouseDY,
    };
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    p.clear();
    return snap;
  }

  /** True if the key went down since the last render frame (UI-level keys). */
  framePressed(code: string): boolean {
    return this.framePressedSet.has(code);
  }

  /** Call at the end of every render frame. */
  endFrame(): void {
    this.frameDX = 0;
    this.frameDY = 0;
    this.framePressedSet.clear();
  }
}
