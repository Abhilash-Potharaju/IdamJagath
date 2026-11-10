/** Keyboard + mouse state, with pointer lock for FPS mouse-look. */
export class Input {
  readonly keys = new Set<string>();
  mouseDown = false;
  /** Right mouse button held (zoom / aim down sights). */
  aimDown = false;
  mouseDX = 0;
  mouseDY = 0;
  locked = false;
  /** Mouse-wheel notches this frame: +1 = scrolled down, -1 = up. */
  wheel = 0;
  private pressed = new Set<string>();
  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    window.addEventListener("keydown", (e) => {
      if (!this.keys.has(e.code)) this.pressed.add(e.code);
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
    });
    document.addEventListener("pointerlockchange", () => {
      this.locked = document.pointerLockElement === this.canvas;
      if (!this.locked) { this.mouseDown = false; this.aimDown = false; this.keys.clear(); }
    });
  }

  lock(): void {
    this.canvas.requestPointerLock();
  }

  /** True only on the frame the key went down. */
  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** Call at the end of every frame. */
  endFrame(): void {
    this.mouseDX = 0;
    this.mouseDY = 0;
    this.wheel = 0;
    this.pressed.clear();
  }
}
