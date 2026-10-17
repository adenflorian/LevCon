import { test } from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSessions, audioSessionProvider } from '../src/services/audio-session-provider.ts';
const app = (id, name, time) => ({ id, displayName: name, processName: name + '.exe', volume: 50, muted: false, active: true, lastAudibleAt: time });
test('alternating activity never swaps apps, and priority/output still win', () => {
  const a = app('a', 'Alpha', 1), b = app('b', 'Beta', 10);
  assert.deepEqual(normalizeSessions([b, a]).map(s => s.id), ['a', 'b']);
  a.lastAudibleAt = 20; b.lastAudibleAt = 0; b.active = false;
  assert.deepEqual(normalizeSessions([a, b]).map(s => s.id), ['a', 'b']);
  audioSessionProvider.setPriorityMatchers(['beta']);
  const output = { ...app('output', 'Output', 0), isOutputVolume: true };
  assert.deepEqual(normalizeSessions([a, output, b]).map(s => s.id), ['output', 'b', 'a']);
  audioSessionProvider.setPriorityMatchers([]);
  const duplicate = { ...a, id: 'a2', processId: 20 };
  a.processId = 10;
  assert.deepEqual(normalizeSessions([duplicate, a]).map(s => s.id), ['a', 'a2']);
  assert.deepEqual(normalizeSessions([a, duplicate]).map(s => s.id), ['a', 'a2']);
});
