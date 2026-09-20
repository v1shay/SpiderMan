export type RenderQualitySettings = {
  level: number;
  farDetail: number;
  weatherDensity: number;
  particleDensity: number;
  postprocessScale: number;
  secondaryAnimationHz: number;
  resolutionScale: number;
};

export function qualitySettings(level: number): RenderQualitySettings {
  const tier = Number.isFinite(level) ? Math.max(0, Math.min(6, Math.floor(level))) : 0;
  return { level: tier, farDetail: tier >= 1 ? .65 : 1, weatherDensity: tier >= 2 ? .5 : 1,
    particleDensity: tier >= 3 ? .5 : 1, postprocessScale: tier >= 4 ? .65 : .85,
    secondaryAnimationHz: tier >= 5 ? 20 : 60, resolutionScale: tier >= 6 ? .85 : 1 };
}

/** Changes one tier at a time, with a wider/longer recovery band to prevent oscillation. */
export class RenderQualityManager {
  private level = 0;
  private averageMs = 16.67;
  private slowSeconds = 0;
  private fastSeconds = 0;
  private cooldown = 2;
  get settings() { return qualitySettings(this.level); }
  get averageFrameMs() { return this.averageMs; }

  update(deltaSeconds: number, frameMs: number, active = true): boolean {
    if (!active || !Number.isFinite(deltaSeconds) || !Number.isFinite(frameMs) || deltaSeconds <= 0 || frameMs <= 0 || deltaSeconds > .5) {
      this.slowSeconds = this.fastSeconds = 0;
      return false;
    }
    const dt = Math.min(deltaSeconds, .1);
    this.averageMs += (frameMs - this.averageMs) * (1 - Math.exp(-dt * 2));
    this.cooldown = Math.max(0, this.cooldown - dt);
    if (this.cooldown > 0) return false;
    this.slowSeconds = this.averageMs > 23 ? this.slowSeconds + dt : 0;
    this.fastSeconds = this.averageMs < 18 ? this.fastSeconds + dt : 0;
    const next = this.slowSeconds >= 3 ? Math.min(6, this.level + 1)
      : this.fastSeconds >= 8 ? Math.max(0, this.level - 1) : this.level;
    if (next === this.level) return false;
    this.level = next;
    this.slowSeconds = this.fastSeconds = 0;
    this.cooldown = 2;
    return true;
  }
}
