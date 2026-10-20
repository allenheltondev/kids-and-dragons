/** A gentle six-second breath around the figure's fixed ground anchor. */
export function idleBreath(seconds: number, phase: number, still = false): number {
  return still ? 0 : (1 - Math.cos(seconds * Math.PI / 3 + phase)) * 0.004;
}
