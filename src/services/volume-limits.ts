import type { MixerSession } from '../types/mixer';

export type VolumeLimit = { matcher: string; min: number; max: number };

export function resolveVolumeLimits(session: MixerSession | undefined, rules: VolumeLimit[]): { min: number; max: number } {
  const rule = rules.find(rule => typeof rule?.matcher === 'string' && rule.matcher.trim() &&
    [session?.displayName, session?.processName].some(name => name?.toLowerCase().includes(rule.matcher.trim().toLowerCase())));
  const min = typeof rule?.min === 'number' && Number.isFinite(rule.min) ? Math.max(0, Math.min(100, Math.round(rule.min))) : 0;
  const max = typeof rule?.max === 'number' && Number.isFinite(rule.max) ? Math.max(min, Math.min(100, Math.round(rule.max))) : 100;
  return { min, max };
}
