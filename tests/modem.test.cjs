const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const test = require('node:test');
const vm = require('node:vm');
const source = fs.readFileSync(path.join(__dirname, '../js/host.js'), 'utf8');

function setup({ sound = true } = {}) {
  let now = 0, id = 0, seed = 1234;
  const timers = new Map(), notes = [], output = [];
  const math = Object.create(Math);
  math.random = () => ((seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0) / 4294967296);
  const window = {
    Term: { fit: (s, w) => s.padEnd(w), strWidth: s => s.length, cw: () => 1 },
    ATDT_DATA: { posts: [], boards: [] },
  };
  vm.runInNewContext(source, {
    window, Math: math,
    Audio() { throw new Error('Must not load recorded audio'); },
    fetch() { throw new Error('Must not download audio'); },
    setTimeout(fn, ms) { const key = ++id; timers.set(key, { fn, at: now + ms }); return key; },
    clearTimeout(key) { timers.delete(key); },
  });
  const term = { send: s => output.push(s), queue: '', inputPos: {} };
  const modem = new window.Host.Modem(term, { soundOn: () => sound });
  modem.sound.ensure = () => ({});
  for (const kind of ['tone', 'noise']) modem.sound[kind] = (...args) => {
    const note = { kind, args, stopped: false };
    notes.push(note);
    modem.sound.nodes.push({ stop() { note.stopped = true; } });
  };
  const advance = ms => {
    const end = now + ms;
    for (;;) {
      const next = [...timers].filter(([, t]) => t.at <= end).sort((a, b) => a[1].at - b[1].at)[0];
      if (!next) break;
      const [key, t] = next; now = t.at; timers.delete(key); t.fn();
    }
    now = end;
  };
  return { modem, notes, output, timers, advance, Host: window.Host };
}

test('synthesized call connects at 7.5 seconds with only the 2-second swell', () => {
  const { modem, notes, output, timers, advance } = setup();
  modem.dial('5551996', false);
  const noises = notes.filter(n => n.kind === 'noise');
  assert.equal(noises.length, 1);
  const [swell] = noises;
  assert.equal(swell.args[1], 2);
  assert.equal(swell.args[3], true);
  for (const { kind, args } of notes) {
    const [start, duration] = kind === 'tone' ? args.slice(1) : args;
    assert.ok(start >= 0 && duration > 0 && start + duration <= 7.5);
  }
  advance(7499);
  assert.equal(modem.state, 'dialing');
  assert.ok(!output.join('').includes('CONNECT '));
  advance(1);
  assert.equal(modem.state, 'online');
  assert.ok(notes.every(n => n.stopped));
  assert.equal(timers.size, 0);
  advance(60000);
  assert.equal(output.join('').match(/CONNECT /g).length, 1);
});

test('muted call waits 7.5 seconds without creating sounds', () => {
  const { modem, notes, advance } = setup({ sound: false });
  modem.dial('5551996', false);
  advance(7499);
  assert.equal(modem.state, 'dialing');
  assert.equal(notes.length, 0);
  advance(1);
  assert.equal(modem.state, 'online');
});

test('cancel stops the sounds and old timer cannot finish a new call', () => {
  const { modem, notes, output, timers, advance } = setup();
  modem.dial('5551996', false);
  advance(2000);
  modem.cancelDial();
  assert.ok(notes.every(n => n.stopped));
  assert.equal(modem.sound.nodes.length, 0);
  assert.equal(timers.size, 0);
  modem.dial('5551996', false);
  advance(5500);
  assert.equal(modem.state, 'dialing');
  advance(2000);
  assert.equal(modem.state, 'online');
  assert.equal(output.join('').match(/CONNECT /g).length, 1);
});

test('no audio support does not prevent connection', () => {
  const { modem, notes, advance } = setup();
  modem.sound.ensure = () => null;
  modem.dial('5551996', false);
  advance(7500);
  assert.equal(modem.state, 'online');
  assert.equal(notes.length, 0);
});

test('failed numbers retain their failure response and do not play handshake noise', () => {
  for (const [number, result] of [['01421', 'BUSY'], ['9999', 'NO CARRIER']]) {
    const { modem, notes, output, advance } = setup();
    modem.dial(number, false);
    advance(10000);
    assert.equal(modem.state, 'cmd');
    assert.ok(notes.every(n => n.kind === 'tone'));
    assert.ok(output.join('').includes(result));
  }
});

test('direct post links skip the sound and dial timer', () => {
  const { modem, notes, timers, Host } = setup();
  modem.bbs.goto = () => true;
  modem.connectDirect(Host.PHONEBOOK[0], 'WHI');
  assert.equal(modem.state, 'online');
  assert.equal(notes.length, 0);
  assert.equal(timers.size, 0);
});

test('noise synthesis produces bounded, non-silent samples with faded edges at common sample rates', () => {
  for (const sampleRate of [44100, 48000]) {
    for (const swell of [false, true]) {
      const { Host } = setup();
      const sound = new Host.Sound();
      let samples;
      const param = () => ({ setValueAtTime() {}, linearRampToValueAtTime() {} });
      const node = () => ({ connect() {}, stop() {}, start() {}, frequency: param(), Q: {}, gain: param() });
      sound.ctx = {
        sampleRate, currentTime: 0, destination: {},
        createBuffer(channels, length) { samples = new Float32Array(length); return { getChannelData: () => samples }; },
        createBufferSource: node, createBiquadFilter: node, createGain: node,
      };
      sound.noise(0, 2, 0.05, swell);
      assert.equal(samples.length, sampleRate * 2);
      let sum = 0, energy = 0;
      for (const x of samples) { assert.ok(Number.isFinite(x) && Math.abs(x) < 1); sum += x; energy += x * x; }
      assert.ok(Math.abs(sum / samples.length) < 0.01);
      assert.ok(Math.sqrt(energy / samples.length) > 0.05);
      assert.equal(samples[0], 0);
      assert.ok(Math.abs(samples.at(-1)) < 0.01);
    }
  }
});
