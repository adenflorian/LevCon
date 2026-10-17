import { test } from 'node:test';
import assert from 'node:assert/strict';
import { AudioSessionProvider, normalizeSessions, audioSessionProvider } from '../src/services/audio-session-provider.ts';

const app = (id, name, time = 0, recentlyActive = false) => ({
  id, displayName: name, processName: name + '.exe', volume: 50,
  muted: false, active: true, lastAudibleAt: time, recentlyActive,
});
const ids = sessions => sessions.map(session => session.id);

test('recently audible apps lead idle apps without timestamp races between concurrent apps', () => {
  const a = app('a', 'Alpha', 100, true), b = app('b', 'Beta', 200, true);
  const idle = app('idle', 'Aardvark', 50);
  assert.deepEqual(ids(normalizeSessions([b, idle, a])), ['a', 'b', 'idle']);
  for (let tick = 0; tick < 20; tick++) {
    a.lastAudibleAt = tick % 2 ? 300 + tick : 100;
    b.lastAudibleAt = tick % 2 ? 200 : 300 + tick;
    assert.deepEqual(ids(normalizeSessions([b, idle, a])), ['a', 'b', 'idle']);
  }
  a.recentlyActive = false;
  assert.deepEqual(ids(normalizeSessions([idle, a, b])), ['b', 'a', 'idle']);
});

test('activity grace period survives alternating audio peaks and expires after silence', async t => {
  const provider = new AudioSessionProvider();
  let now = 10_000;
  let aPeak = 0, bPeak = 0.1;
  t.mock.method(Date, 'now', () => now);
  // Stub the helper boundary; exercise activity tracking through public session reads.
  provider.runHelper = async () => ({
    endpoint: { ...app('output', 'Output'), isOutputVolume: true },
    sessions: [{ ...app('a', 'Alpha'), peakValue: aPeak }, { ...app('b', 'Beta'), peakValue: bPeak }],
  });
  async function read() {
    provider.setPriorityMatchers([]); // Invalidate the snapshot to await a fresh helper read.
    return (await provider.listSessions()).filter(session => !session.isOutputVolume);
  }
  assert.deepEqual(ids(await read()), ['b', 'a']);
  now = 10_500; aPeak = 0.1; bPeak = 0;
  assert.deepEqual(ids(await read()), ['a', 'b']);
  for (let tick = 1; tick <= 6; tick++) {
    now += 500; aPeak = tick % 2 ? 0 : 0.1; bPeak = tick % 2 ? 0.1 : 0;
    assert.deepEqual(ids(await read()), ['a', 'b']);
  }
  aPeak = 0; bPeak = 0.1;
  now = 18_499;
  assert.deepEqual(ids(await read()), ['a', 'b']);
  now = 18_500;
  assert.deepEqual(ids(await read()), ['b', 'a']);
  bPeak = 0; now = 24_000;
  const idle = await read();
  assert.ok(idle.every(session => session.recentlyActive === false));
  assert.deepEqual(ids(idle), ['b', 'a']);
});

test('explicit priorities, output pinning, and duplicate identities remain stable', () => {
  const a = app('a', 'Alpha', 100, true), b = app('b', 'Beta');
  audioSessionProvider.setPriorityMatchers(['beta']);
  try {
    const output = { ...app('output', 'Output'), isOutputVolume: true };
    assert.deepEqual(ids(normalizeSessions([a, output, b])), ['output', 'b', 'a']);
  } finally {
    audioSessionProvider.setPriorityMatchers([]);
  }
  const duplicate = { ...a, id: 'a2', processId: 20 };
  a.processId = 10;
  assert.deepEqual(ids(normalizeSessions([duplicate, a])), ['a', 'a2']);
  assert.deepEqual(ids(normalizeSessions([a, duplicate])), ['a', 'a2']);
});
