import { test } from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { readFileSync } from 'node:fs';

test('phase sync interrupts an existing dialog and shows one election prompt without reloading', async () => {
  let dialog = null, created = 0;
  const app = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [], addEventListener() {} };
  const document = {
    hidden: false,
    querySelector: s => s === '#app' ? app : s === 'dialog' ? dialog : s === '#election-dialog' && dialog?.id === 'election-dialog' ? dialog : null,
    body: { classList: { toggle() {}, remove() {}, contains: () => false }, append: d => { dialog = d; } },
    addEventListener() {},
    createElement() {
      created++;
      const d = { dataset: {}, querySelectorAll: () => [], showModal() {}, close() { this.onclose?.(); }, remove() { if (dialog === this) dialog = null; } };
      return d;
    },
  };
  const room = { code: '1234', round: 1, self: { seat: 1, alive: true }, game: { step: 1,
    election: { id: 'election-1', status: 'signup', deadline: Date.now() + 10000, participants: [1] } } };
  const context = vm.createContext({ document, window: { addEventListener() {} }, localStorage: { getItem: () => null },
    setTimeout() {}, clearTimeout() {}, setInterval() {}, navigator: {}, console, AbortSignal,
    fetch: async () => ({ ok: true, json: async () => ({ room: structuredClone(room), serverTime: Date.now() }) }) });
  vm.runInContext(readFileSync('public/app.js', 'utf8'), context);
  vm.runInContext("page='room';room={code:'1234',round:1,self:{seat:1,alive:true},game:{step:0}}", context);
  let interrupted = false;
  dialog = { close() { interrupted = true; dialog = null; } };
  await vm.runInContext('refresh()', context);
  assert.equal(interrupted, true);
  assert.equal(dialog.id, 'election-dialog');
  assert.match(dialog.innerHTML, /是否上警/);
  const original = dialog;
  for (let i = 0; i < 5; i++) await vm.runInContext('refresh()', context);
  assert.equal(created, 1);
  assert.equal(dialog, original);
  room.game.election.ownChoice = true;
  await vm.runInContext('refresh()', context);
  assert.equal(dialog, null);
  vm.runInContext('syncElectionDialog()', context);
  assert.equal(created, 1);
});
