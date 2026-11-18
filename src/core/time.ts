/**
 * Fixed-timestep accumulator ("Fix Your Timestep"): the simulation always advances in exact `dt` steps (60 Hz),
 * independent of the display frame rate; the renderer interpolates between the last two states with `alpha`.
 */
export const SIM_DT = 1 / 60;

export class FixedStep {
  readonly dt: number;
  readonly maxSteps: number;
  private acc = 0;

  constructor(dt = SIM_DT, maxSteps = 5) {
    this.dt = dt;
    this.maxSteps = maxSteps;
  }

  /**
   * Add real elapsed time and run as many fixed steps as fit (at most `maxSteps`, so a long stall can't spiral).
   * Returns the interpolation factor in [0, 1) between the previous and current simulation state.
   */
  advance(realDt: number, step: (dt: number) => void): number {
    this.acc += Math.max(0, realDt);
    let n = 0;
    while (this.acc >= this.dt - 1e-9 && n < this.maxSteps) {
      step(this.dt);
      this.acc -= this.dt;
      n++;
    }
    if (n === this.maxSteps && this.acc > this.dt) this.acc = 0; // drop backlog after a stall
    if (this.acc < 0) this.acc = 0;
    return this.acc / this.dt;
  }

  reset(): void {
    this.acc = 0;
  }
}
