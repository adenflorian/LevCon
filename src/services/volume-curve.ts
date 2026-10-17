/** Exponential dial response: fine adjustment near silence, larger steps at high volume. */
export function curvedVolumeDelta(volume: number, delta: number, curve: string | undefined): number {
  if (curve !== 'logarithmic' || delta === 0) return delta;
  const current = Math.max(0, Math.min(100, volume));
  const position = Math.log1p(current) / Math.log(101);
  const target = Math.round(Math.expm1(Math.max(0, Math.min(1, position + delta / 100)) * Math.log(101)));
  // Windows volumes are integer percentages here; every nonzero turn must move at least 1%.
  return (delta > 0 ? Math.min(100, Math.max(current + 1, target)) : Math.max(0, Math.min(current - 1, target))) - current;
}
