import type { InputSnapshot } from "../../core/ports";

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
    window.addEventListener("mousedown", (e) => {
      if (!this.locked) return;
      if (e.button === 0) this.mouseDown = true;
      if (e.button === 2) this.aimDown = true;
    });
    window.addEventListener("mouseup", (e) => {
      if (e.button === 0) this.mouseDown = false;
      if (e.button === 2) this.aimDown = false;
    });
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
    this.canvas.requestPointerLock();
  }

  /** Snapshot for one simulation step; resets the per-step edges and deltas. */
  consume(): InputSnapshot {
    const k = this.keys, p = this.stepPressed;
    const snap: InputSnapshot = {
      forward: k.has("KeyW") || k.has("ArrowUp"),
      back: k.has("KeyS") || k.has("ArrowDown"),
      left: k.has("KeyA") || k.has("ArrowLeft"),
      right: k.has("KeyD") || k.has("ArrowRight"),
      sprint: k.has("ShiftLeft") || k.has("ShiftRight"),
      crouch: k.has("KeyC") || k.has("ControlLeft"),
      crouchPressed: p.has("KeyC") || p.has("ControlLeft"),
      jumpPressed: p.has("Space"),
      fire: this.mouseDown,
      aim: this.aimDown,
      reloadPressed: p.has("KeyR"),
      weapon1Pressed: p.has("Digit1"),
      weapon2Pressed: p.has("Digit2"),
      weaponLastPressed: p.has("KeyQ"),
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
