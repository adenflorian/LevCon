import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
test('settings round trip preserves other settings and validates user input', () => {
 const nodes = new Map();
 const messages = [];
 const context = vm.createContext({ window: {}, WebSocket: { OPEN: 1 }, document: { getElementById(id) {
   if (!nodes.has(id)) nodes.set(id, { value: '', addEventListener() {}, setCustomValidity(value) { this.error = value; }, reportValidity() {} });
   return nodes.get(id);
 } } });
 vm.runInContext(readFileSync(new URL('../com.david-valachovic.levcon.sdPlugin/ui/mixer-slot.js', import.meta.url), 'utf8'), context);
 context.messages = messages;
 vm.runInContext("websocket = { readyState: 1, send: value => messages.push(JSON.parse(value)) }; applyGlobalSettings({stepSize: 5, priorityMatchers: ['discord'], blacklistMatchers: [], showOutputVolume: false, futureSetting: 'keep', volumeCurve: 'logarithmic', volumeLimits: [{matcher:'spotify',min:1,max:80}]}); persistGlobalSettings();", context);
 assert.equal(messages.at(-1).payload.futureSetting, 'keep');
 assert.equal(messages.at(-1).payload.showOutputVolume, false);
 assert.equal(messages.at(-1).payload.volumeCurve, 'logarithmic');
 assert.equal(messages.at(-1).payload.volumeLimits[0].min, 1);
 nodes.get('volumeCurve').value = 'linear';
 vm.runInContext('persistGlobalSettings()', context);
 assert.equal(messages.at(-1).payload.volumeCurve, 'linear');
});
