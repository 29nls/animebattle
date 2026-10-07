// Fixture: target impor relatif yang sah di dalam zona engine.
export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}
