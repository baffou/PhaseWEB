import test from 'node:test';
import assert from 'node:assert/strict';
import { fft2, integrate, demo, crop, reconstruct, validate } from '../public/js/core.mjs';
import { readTiff } from '../public/js/images.mjs';

const rmsError = (a, b) => Math.sqrt(a.reduce((s, v, i) => s + (v - b[i]) ** 2, 0) / a.length);
test('Rectangular complex FFT: round trip', () => {
  const re = Float64Array.from({ length: 128 }, (_, i) => Math.sin(i * .7));
  const im = Float64Array.from(re, (_, i) => Math.cos(i * .31));
  const restored = fft2(fft2({ re, im }, 16, 8), 16, 8, true);
  assert.ok(rmsError(restored.re, re) < 1e-12); assert.ok(rmsError(restored.im, im) < 1e-12);
});
test('Analytical integration: nm units, axes and tilt removal', () => {
  const w = 64, h = 32, pitch = 5000, truth = new Float64Array(w * h), gx = truth.slice(), gy = truth.slice();
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const i = y * w + x, a = 4 * Math.PI * x / w, b = 2 * Math.PI * y / h;
    truth[i] = 37 * Math.cos(a) + 19 * Math.sin(b);
    gx[i] = -37 * 4 * Math.PI / w / pitch * Math.sin(a) + .02;
    gy[i] = 19 * 2 * Math.PI / h / pitch * Math.cos(b) - .03;
  }
  assert.ok(rmsError(integrate(gx, gy, w, h, pitch), truth) < 1e-10);
});
test('Full reconstruction: known OPD and 0.8 transmittance', () => {
  const d = demo(), r = reconstruct(crop(d.sample), crop(d.reference), d.config);
  assert.ok(rmsError(r.opd, d.truth) < 1e-8);
  assert.ok(r.transmittance.every(v => Math.abs(v - .8) < 1e-10));
  assert.equal(r.samplePitchUm, 6.5 / 60);
  assert.ok(r.phase.every((v, i) => Math.abs(v - 2 * Math.PI * r.opd[i] / 550) < 1e-12));
  const scaled = reconstruct(crop(d.sample), crop(d.reference), { ...d.config, alpha: d.config.alpha * 2, magnification: 30 });
  assert.ok(rmsError(scaled.opd, Float64Array.from(d.truth, v => v * 2)) < 1e-8);
  assert.equal(scaled.samplePitchUm, 6.5 / 30);
});
test('Identical sample and reference: zero OPD and unit transmittance', () => {
  const d = demo(), s = crop(d.sample), r = reconstruct(s, s, d.config);
  assert.ok(r.opd.every(v => Math.abs(v) < 1e-12)); assert.ok(r.transmittance.every(v => Math.abs(v - 1) < 1e-12));
});
test('No reference: warning and intensity in camera units', () => {
  const d = demo(), r = reconstruct(crop(d.sample), null, d.config);
  assert.equal(r.transmittance, null); assert.ok(r.warnings.some(s => s.includes('No reference')));
});
test('Order, unit and dimension validation', () => {
  const d = demo();
  for (const bad of [{ alpha: 0 }, { radius: .3 }, { fx1: NaN }, { fx2: d.config.fx1, fy2: d.config.fy1 }, { fx2: -d.config.fx2, fy2: -d.config.fy2 }]) assert.throws(() => validate({ ...d.config, ...bad }));
  const ref = crop({ width: 257, height: 256, data: new Float64Array(257 * 256) });
  assert.throws(() => reconstruct(crop(d.sample), ref, d.config), /dimensions/);
});
test('Centered crop without resampling', () => {
  const data = Float64Array.from({ length: 300 * 180 }, (_, i) => i), c = crop({ data, width: 300, height: 180 });
  assert.deepEqual([c.width, c.height, c.x0, c.y0], [256, 128, 22, 26]);
  assert.equal(c.data[0], data[26 * 300 + 22]); assert.equal(c.data.at(-1), data[(26 + 127) * 300 + 22 + 255]);
});

function tiffFixture(le, bits, format, values, compression = 1) {
  const entries = [[256, 4, values.length], [257, 4, 1], [258, 3, bits], [259, 3, compression], [262, 3, 1], [273, 4, 0], [277, 3, 1], [278, 4, 1], [279, 4, values.length * bits / 8], [339, 3, format]];
  const offset = 8 + 2 + entries.length * 12 + 4, buffer = new ArrayBuffer(offset + values.length * bits / 8), d = new DataView(buffer);
  d.setUint16(0, le ? 0x4949 : 0x4d4d); d.setUint16(2, 42, le); d.setUint32(4, 8, le); d.setUint16(8, entries.length, le);
  entries[5][2] = offset;
  entries.forEach(([tag, type, value], i) => { const p = 10 + i * 12; d.setUint16(p, tag, le); d.setUint16(p + 2, type, le); d.setUint32(p + 4, 1, le); type === 3 ? d.setUint16(p + 8, value, le) : d.setUint32(p + 8, value, le); });
  values.forEach((v, i) => { const p = offset + i * bits / 8; if (format === 3) d.setFloat32(p, v, le); else if (bits === 16) d.setUint16(p, v, le); else d.setUint8(p, v); });
  return buffer;
}
test('TIFF: preserves uint16 and float32 in both byte orders', () => {
  for (const le of [true, false]) for (const [bits, format, values] of [[16, 1, [0, 40000, 65535]], [32, 3, [-12.5, 0, 1234.25]], [8, 1, [0, 127, 255]]]) assert.deepEqual(Array.from(readTiff(tiffFixture(le, bits, format, values)).data), values);
});
test('TIFF: rejects compression and truncated files', () => {
  assert.throws(() => readTiff(tiffFixture(true, 16, 1, [1, 2], 5)), /Compressed/);
  assert.throws(() => readTiff(tiffFixture(true, 16, 1, [1, 2]).slice(0, 40)));
});
