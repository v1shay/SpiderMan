export const PERFORMANCE_CHANNELS = ['frame', 'physics', 'collision', 'anchor', 'animation', 'streaming', 'render'] as const;
export type PerformanceChannel = typeof PERFORMANCE_CHANNELS[number];
export type RenderCounters = { drawCalls: number; triangles: number; textures: number; geometries: number };

/** Fixed memory cost. Percentiles are sorted only when a diagnostic snapshot is requested. */
export class TraversalTelemetry {
  private samples: Record<PerformanceChannel, Float64Array>;
  private counts = Object.fromEntries(PERFORMANCE_CHANNELS.map(key => [key, 0])) as Record<PerformanceChannel, number>;
  private cursors = { ...this.counts };
  private counters: RenderCounters = { drawCalls: 0, triangles: 0, textures: 0, geometries: 0 };
  readonly capacity: number;

  constructor(capacity = 600) {
    this.capacity = Number.isFinite(capacity) ? Math.max(30, Math.min(3600, Math.floor(capacity))) : 600;
    this.samples = Object.fromEntries(PERFORMANCE_CHANNELS.map(key => [key, new Float64Array(this.capacity)])) as Record<PerformanceChannel, Float64Array>;
  }

  record(channel: PerformanceChannel, milliseconds: number) {
    if (!Number.isFinite(milliseconds) || milliseconds < 0) return;
    this.samples[channel][this.cursors[channel]] = milliseconds;
    this.cursors[channel] = (this.cursors[channel] + 1) % this.capacity;
    this.counts[channel] = Math.min(this.capacity, this.counts[channel] + 1);
  }

  setRenderCounters(counters: RenderCounters) {
    for (const key of Object.keys(this.counters) as (keyof RenderCounters)[]) {
      const value = counters[key];
      if (Number.isFinite(value) && value >= 0) this.counters[key] = value;
    }
  }

  snapshot() {
    const timings = Object.fromEntries(PERFORMANCE_CHANNELS.map(channel => {
      const sorted = Array.from(this.samples[channel].subarray(0, this.counts[channel])).sort((a, b) => a - b);
      const quantile = (fraction: number) => sorted.length ? sorted[Math.max(0, Math.ceil(sorted.length * fraction) - 1)] : null;
      return [channel, { count: sorted.length, meanMs: sorted.length ? sorted.reduce((sum, v) => sum + v, 0) / sorted.length : null,
        p50Ms: quantile(.5), p95Ms: quantile(.95), p99Ms: quantile(.99), maxMs: sorted.at(-1) ?? null }];
    }));
    return { windowCapacity: this.capacity, timings, renderer: { ...this.counters }, note: 'CPU timings; render excludes asynchronous GPU completion.' };
  }
}
