import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveVolumeLimits } from '../src/services/volume-limits.ts';
test('defaults, matching, first rule precedence, and invalid saved settings', () => {
  const session = { displayName: 'Spotify', processName: 'spotify.exe' };
  assert.deepEqual(resolveVolumeLimits(session, []), { min: 0, max: 100 });
  assert.deepEqual(resolveVolumeLimits(session, [{ matcher: 'SPOTIFY', min: 1, max: 80 }, { matcher: 'spot', min: 5, max: 50 }]), { min: 1, max: 80 });
  assert.deepEqual(resolveVolumeLimits(session, [{ matcher: 'other', min: 1, max: 80 }]), { min: 0, max: 100 });
  assert.deepEqual(resolveVolumeLimits(session, [{ matcher: 'spotify.exe', min: -10, max: 200 }]), { min: 0, max: 100 });
  assert.deepEqual(resolveVolumeLimits(session, [{ matcher: 'spotify', min: 40, max: 10 }]), { min: 40, max: 40 });
  assert.deepEqual(resolveVolumeLimits(session, [null, { matcher: ' ', min: 30, max: 50 }]), { min: 0, max: 100 });
});
