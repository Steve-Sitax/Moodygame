// The net under the sounds (fix 2026-09-26, "non-finite AudioParam value" at night): a bad AudioParam
// call is skipped and counted, never thrown into the frame. A stand-in AudioParam that throws as the
// browser does.
import test from 'node:test';
import assert from 'node:assert/strict';

class FakeParam {
  #v = 1;
  get value() { return this.#v; }
  set value(v) { if (!Number.isFinite(v)) throw new TypeError('The provided float value is non-finite.'); this.#v = v; }
  setValueAtTime(v, t) { if (!Number.isFinite(v) || !Number.isFinite(t)) throw new TypeError('non-finite'); this.#v = v; return this; }
  linearRampToValueAtTime(v, t) { if (!Number.isFinite(v) || !Number.isFinite(t)) throw new TypeError('non-finite'); this.#v = v; return this; }
  exponentialRampToValueAtTime(v, t) { if (v === 0) throw new RangeError('target 0'); this.#v = v; return this; }
  setTargetAtTime(v, t, c) { if (![v, t, c].every(Number.isFinite)) throw new TypeError('non-finite'); this.#v = v; return this; }
}
globalThis.AudioParam = FakeParam;
const { installSafeParams, paramSkips } = await import('../src/audio/safeParams.ts');
installSafeParams();
installSafeParams(); // (once only)

test('non-finite values and refused calls are skipped, not thrown', () => {
  const p = new FakeParam();
  p.value = 0.5;
  assert.doesNotThrow(() => (p.value = NaN));
  assert.equal(p.value, 0.5);
  assert.doesNotThrow(() => p.setValueAtTime(NaN, 1));
  assert.doesNotThrow(() => p.setValueAtTime(0.2, Infinity));
  assert.doesNotThrow(() => p.setTargetAtTime(0.3, 1, NaN));
  assert.doesNotThrow(() => p.exponentialRampToValueAtTime(0, 1));
  assert.equal(p.value, 0.5);
  assert.equal(paramSkips.n, 5);
});

test('good values still go through', () => {
  const p = new FakeParam();
  assert.equal(p.setValueAtTime(0.7, 0), p);
  assert.equal(p.value, 0.7);
  p.linearRampToValueAtTime(0.9, 1);
  p.value = 0.25;
  assert.equal(p.value, 0.25);
});
