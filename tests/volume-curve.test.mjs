import { test } from 'node:test';
import assert from 'node:assert/strict';
import { curvedVolumeDelta } from '../src/services/volume-curve.ts';
test('linear remains the default', () => {
  for (const mode of [undefined, 'linear', 'invalid']) assert.equal(curvedVolumeDelta(50, 10, mode), 10);
});
test('logarithmic turns are bounded, monotonic, and never stall', () => {
  for (let volume = 0; volume <= 100; volume++) {
    for (const delta of [-500, -5, -1, 0, 1, 5, 500]) {
      const change = curvedVolumeDelta(volume, delta, 'logarithmic');
      assert.ok(volume + change >= 0 && volume + change <= 100);
      if (delta > 0 && volume < 100) assert.ok(change >= 1);
      if (delta < 0 && volume > 0) assert.ok(change <= -1);
      if (delta === 0) assert.equal(change, 0);
    }
  }
  assert.ok(curvedVolumeDelta(10, 5, 'logarithmic') < curvedVolumeDelta(70, 5, 'logarithmic'));
});
